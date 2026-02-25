import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from 'prismarine-block';
import type { BotEventBus } from '../core/event-bus.js';
import type { AdaptiveTimings } from '../network/adaptive-timings.js';
import { ToolSelector } from '../inventory/tool-selector.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('AntiStuck');

const MAX_RECOVERY_LEVEL = 5;
const SAFE_POSITIONS_KEEP = 15;
const SAFE_SAVE_INTERVAL = 5000;

export class AntiStuck {
  private bot: Bot;
  private timings: AdaptiveTimings;
  private eventBus: BotEventBus;
  private toolSelector: ToolSelector;

  private active = false;
  private _recovering = false;
  private tickListener: (() => void) | null = null;
  private stallInterval: ReturnType<typeof setInterval> | null = null;

  // Physics
  private savedPlayerSpeed = 0;

  // Suffocation detection
  private lastTickPos: Vec3 | null = null;
  private stuckTicks = 0;

  // Stall detection
  private lastMovePos: Vec3 | null = null;
  private lastMoveTime = 0;

  // Loop detection
  private posHistory: { pos: Vec3; time: number }[] = [];
  private readonly POSITION_HISTORY_SIZE = 30;
  private readonly LOOP_RADIUS = 2.5;
  private readonly LOOP_COUNT = 4;

  // Safe positions
  private safePositions: Vec3[] = [];
  private lastSafeSave = 0;

  // Recovery escalation
  private recoveryLevel = 0;
  private lastRecoveryTime = 0;
  private consecutiveStucks = 0;

  // Blocking path tracking
  private blockClearAttempted = false;

  // Stats
  public stats = {
    totalRecoveries: 0,
    suffocations: 0,
    stalls: 0,
    rubberBands: 0,
    loops: 0,
  };

  constructor(bot: Bot, timings: AdaptiveTimings, eventBus: BotEventBus) {
    this.bot = bot;
    this.timings = timings;
    this.eventBus = eventBus;
    this.toolSelector = new ToolSelector(bot);
  }

  // ─── Public API ───

  enable(): void {
    if (this.active) return;
    this.active = true;

    this.slowDownPhysics();
    this.startTickMonitor();
    this.startStallMonitor();

    log.info('Protection system activated');
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;

    this.restorePhysics();
    this.stopTickMonitor();
    this.stopStallMonitor();

    this.recoveryLevel = 0;
    this.consecutiveStucks = 0;
    this.stuckTicks = 0;
    this.blockClearAttempted = false;
    this.posHistory = [];

    log.info('Protection system deactivated');
  }

  isEnabled(): boolean { return this.active; }
  isRecovering(): boolean { return this._recovering; }

  markSafePosition(): void {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position.clone();

    if (this.safePositions.length > 0) {
      const last = this.safePositions[this.safePositions.length - 1];
      if (pos.distanceTo(last) < 1) return;
    }

    this.safePositions.push(pos);
    if (this.safePositions.length > SAFE_POSITIONS_KEEP) {
      this.safePositions.shift();
    }
  }

  async clearOverlapping(): Promise<void> {
    const overlapping = this.getOverlappingBlocks();
    for (const b of overlapping) {
      if (!this.toolSelector.shouldMine(b)) continue;
      await this.safeDig(b);
      await this.waitTicks(2);
    }
  }

  async forceClearArea(): Promise<void> {
    await this.recoverLevel3_clearSpace();
  }

  getOverlappingBlocks(): Block[] {
    if (!this.bot.entity) return [];
    const pos = this.bot.entity.position;

    // Player hitbox: 0.6 x 1.8 x 0.6
    const minX = pos.x - 0.3;
    const maxX = pos.x + 0.3;
    const minY = pos.y;
    const maxY = pos.y + 1.8;
    const minZ = pos.z - 0.3;
    const maxZ = pos.z + 0.3;

    const blocks: Block[] = [];
    for (let bx = Math.floor(minX); bx <= Math.floor(maxX); bx++) {
      for (let by = Math.floor(minY); by <= Math.floor(maxY); by++) {
        for (let bz = Math.floor(minZ); bz <= Math.floor(maxZ); bz++) {
          const b = this.bot.blockAt(new Vec3(bx, by, bz));
          if (!b || b.boundingBox !== 'block' || b.name === 'bedrock') continue;

          const bMin = b.position;
          const bMax = b.position.offset(1, 1, 1);
          if (
            minX < bMax.x && maxX > bMin.x &&
            minY < bMax.y && maxY > bMin.y &&
            minZ < bMax.z && maxZ > bMin.z
          ) {
            blocks.push(b);
          }
        }
      }
    }
    return blocks;
  }

  /**
   * Get the direction the bot is trying to move (from pathfinder goal, velocity, or yaw).
   */
  private getMovementDirection(): Vec3 | null {
    if (!this.bot.entity) return null;

    // Try pathfinder goal direction
    try {
      const pf = this.bot.pathfinder as any;
      if (pf.goal) {
        const pos = this.bot.entity.position;
        const gx = pf.goal.x ?? pos.x;
        const gz = pf.goal.z ?? pos.z;
        const dx = gx - pos.x;
        const dz = gz - pos.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0.5) {
          return new Vec3(dx / len, 0, dz / len);
        }
      }
    } catch {}

    // Try velocity
    const vel = this.bot.entity.velocity;
    if (Math.abs(vel.x) > 0.01 || Math.abs(vel.z) > 0.01) {
      const len = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      return new Vec3(vel.x / len, 0, vel.z / len);
    }

    // Fallback: yaw direction
    const yaw = this.bot.entity.yaw;
    return new Vec3(-Math.sin(yaw), 0, Math.cos(yaw));
  }

  /**
   * Get blocks that are blocking the bot's movement path.
   * Handles diagonal movement by checking both cardinal neighbors + the diagonal block.
   */
  getBlockingBlocks(): Block[] {
    if (!this.bot.entity) return [];

    const dir = this.getMovementDirection();
    if (!dir) return [];

    const pos = this.bot.entity.position;
    const baseY = Math.floor(pos.y);
    const blocks: Block[] = [];
    const checked = new Set<string>();

    const tryAdd = (bx: number, by: number, bz: number) => {
      const key = `${bx},${by},${bz}`;
      if (checked.has(key)) return;
      checked.add(key);
      const b = this.bot.blockAt(new Vec3(bx, by, bz));
      if (b && b.boundingBox === 'block' && this.toolSelector.shouldMine(b)) {
        blocks.push(b);
      }
    };

    // Determine step direction: only count as moving in that axis if component > 0.3
    const sx = dir.x > 0.3 ? 1 : dir.x < -0.3 ? -1 : 0;
    const sz = dir.z > 0.3 ? 1 : dir.z < -0.3 ? -1 : 0;

    if (sx === 0 && sz === 0) return [];

    const botBlockX = Math.floor(pos.x);
    const botBlockZ = Math.floor(pos.z);

    // Check blocks at foot (dy=0) and head (dy=1) level
    for (const dy of [0, 1]) {
      const y = baseY + dy;

      // Cardinal direction blocks
      if (sx !== 0) {
        tryAdd(botBlockX + sx, y, botBlockZ);
      }
      if (sz !== 0) {
        tryAdd(botBlockX, y, botBlockZ + sz);
      }

      // Diagonal block — the corner that prevents diagonal passage
      if (sx !== 0 && sz !== 0) {
        tryAdd(botBlockX + sx, y, botBlockZ + sz);
      }
    }

    return blocks;
  }

  /**
   * Clear blocks that are blocking the bot's movement path.
   * Especially effective for diagonal stuck situations.
   */
  async clearBlockingPath(): Promise<boolean> {
    if (this._recovering) return false;

    const blocking = this.getBlockingBlocks();
    if (blocking.length === 0) return false;

    this._recovering = true;
    try {
      log.info(`Clearing ${blocking.length} blocking blocks in path`);
      for (const block of blocking) {
        await this.safeDig(block);
        await this.waitTicks(2);
      }
      return true;
    } catch {
      return false;
    } finally {
      this._recovering = false;
    }
  }

  reset(): void {
    this.recoveryLevel = 0;
    this.consecutiveStucks = 0;
    this.stuckTicks = 0;
    this.blockClearAttempted = false;
    this.posHistory = [];
    this.safePositions = [];
    this.lastMovePos = null;
    this.lastMoveTime = Date.now();
    this.stats = { totalRecoveries: 0, suffocations: 0, stalls: 0, rubberBands: 0, loops: 0 };
  }

  getStats() {
    return {
      ...this.stats,
      recoveryLevel: this.recoveryLevel,
      safePositions: this.safePositions.length,
    };
  }

  // ─── Physics ───

  private slowDownPhysics(): void {
    const physics = (this.bot as any).physics;
    this.savedPlayerSpeed = physics.playerSpeed;
    physics.playerSpeed = this.savedPlayerSpeed * this.timings.speedMultiplier;
  }

  private restorePhysics(): void {
    if (this.savedPlayerSpeed > 0) {
      (this.bot as any).physics.playerSpeed = this.savedPlayerSpeed;
      this.savedPlayerSpeed = 0;
    }
  }

  // ─── Tick Monitor (suffocation + rubber-band) ───

  private startTickMonitor(): void {
    if (this.tickListener) return;

    this.lastTickPos = this.bot.entity?.position.clone() ?? null;
    this.stuckTicks = 0;

    this.tickListener = () => {
      if (!this.bot.entity || this._recovering) return;

      const pos = this.bot.entity.position;

      // Rubber-band detection (adaptive threshold)
      if (this.lastTickPos) {
        const delta = pos.distanceTo(this.lastTickPos);
        if (delta > this.timings.rubberBandDistance && delta < 20) {
          this.stats.rubberBands++;
          log.warn(`Rubber-band: Δ${delta.toFixed(1)} blocks`);
          this.bot.clearControlStates();
        }
      }
      this.lastTickPos = pos.clone();

      // Suffocation detection (adaptive threshold)
      const overlapping = this.getOverlappingBlocks();
      if (overlapping.length > 0) {
        this.stuckTicks++;
        if (this.stuckTicks >= this.timings.stuckTicksThreshold && !this._recovering) {
          this.stats.suffocations++;
          log.warn(`Suffocation: ${overlapping.length} blocks — level ${this.recoveryLevel}`);
          this.triggerRecovery('suffocation');
        }
      } else {
        if (this.stuckTicks > 0) {
          this.recoveryLevel = Math.max(0, this.recoveryLevel - 1);
        }
        this.stuckTicks = 0;
      }

      // Auto-save safe position
      if (overlapping.length === 0 && this.bot.entity.onGround) {
        const now = Date.now();
        if (now - this.lastSafeSave > SAFE_SAVE_INTERVAL) {
          this.markSafePosition();
          this.lastSafeSave = now;
        }
      }
    };

    this.bot.on('physicTick', this.tickListener);
  }

  private stopTickMonitor(): void {
    if (this.tickListener) {
      this.bot.off('physicTick', this.tickListener);
      this.tickListener = null;
    }
  }

  // ─── Stall Monitor ───

  private startStallMonitor(): void {
    if (this.stallInterval) return;

    this.lastMovePos = this.bot.entity?.position.clone() ?? null;
    this.lastMoveTime = Date.now();

    this.stallInterval = setInterval(() => {
      if (!this.bot.entity || this._recovering) return;

      const pos = this.bot.entity.position;
      const now = Date.now();

      // Position history
      this.posHistory.push({ pos: pos.clone(), time: now });
      if (this.posHistory.length > this.POSITION_HISTORY_SIZE) {
        this.posHistory.shift();
      }

      // Stall detection (adaptive threshold)
      if (this.lastMovePos) {
        const moved = pos.distanceTo(this.lastMovePos);
        if (moved > 0.15) {
          this.lastMovePos = pos.clone();
          this.lastMoveTime = now;
          this.consecutiveStucks = 0;
          this.blockClearAttempted = false;
        } else if (now - this.lastMoveTime > this.timings.stallTimeThreshold) {
          if (this.isPathfinderActive() && !this._recovering) {
            // First attempt: try clearing blocking blocks (handles diagonal stuck)
            const blocking = this.getBlockingBlocks();
            if (blocking.length > 0 && !this.blockClearAttempted) {
              log.info(`Stall: ${blocking.length} blocking blocks detected, clearing path`);
              this.blockClearAttempted = true;
              this.clearBlockingPath();
              this.lastMoveTime = now; // give time after clearing
            } else {
              // Full recovery escalation
              this.stats.stalls++;
              this.blockClearAttempted = false;
              log.warn(`Stall: ${((now - this.lastMoveTime) / 1000).toFixed(1)}s without movement`);
              this.triggerRecovery('stall');
              this.lastMoveTime = now;
            }
          }
        }
      }

      // Loop detection
      this.checkForLoop();
    }, this.timings.stuckCheckInterval);
  }

  private stopStallMonitor(): void {
    if (this.stallInterval) {
      clearInterval(this.stallInterval);
      this.stallInterval = null;
    }
  }

  private isPathfinderActive(): boolean {
    try {
      return !!(this.bot.pathfinder as any).goal;
    } catch {
      return false;
    }
  }

  private checkForLoop(): void {
    if (this.posHistory.length < this.POSITION_HISTORY_SIZE * 0.5) return;

    const current = this.posHistory[this.posHistory.length - 1].pos;
    let returns = 0;
    let lastWasNear = true;

    for (const entry of this.posHistory) {
      const near = entry.pos.distanceTo(current) < this.LOOP_RADIUS;
      if (near && !lastWasNear) returns++;
      lastWasNear = near;
    }

    if (returns >= this.LOOP_COUNT) {
      this.stats.loops++;
      log.warn(`Loop detected: ${returns} returns to same zone`);
      this.posHistory = [];
      this.triggerRecovery('loop');
    }
  }

  // ─── Recovery Dispatcher ───

  private async triggerRecovery(reason: string): Promise<void> {
    if (this._recovering) return;

    const now = Date.now();
    if (now - this.lastRecoveryTime < this.timings.recoveryCooldown) return;

    this._recovering = true;
    this.lastRecoveryTime = now;
    this.stats.totalRecoveries++;
    this.consecutiveStucks++;

    // On high ping, skip useless low-level recoveries
    const minLevel = this.timings.minRecoveryLevel;
    if (this.recoveryLevel < minLevel) {
      this.recoveryLevel = minLevel;
    }

    try {
      log.info(`Recovery L${this.recoveryLevel} (reason: ${reason})`);
      this.eventBus.emit('safety:stuck', this.recoveryLevel, reason);

      switch (this.recoveryLevel) {
        case 0: await this.recoverLevel0_jump(); break;
        case 1: await this.recoverLevel1_jumpAndMove(); break;
        case 2: await this.recoverLevel2_digOverlapping(); break;
        case 3: await this.recoverLevel3_clearSpace(); break;
        case 4: await this.recoverLevel4_digUp(); break;
        default: await this.recoverLevel5_emergency(); break;
      }

      await this.sleep(300);
      const stillStuck = this.getOverlappingBlocks().length > 0 || this.getBlockingBlocks().length > 0;

      if (stillStuck) {
        this.recoveryLevel = Math.min(this.recoveryLevel + 1, MAX_RECOVERY_LEVEL);
      } else {
        this.recoveryLevel = Math.max(0, this.recoveryLevel - 1);
        this.stuckTicks = 0;
        this.eventBus.emit('safety:unstuck');
      }
    } catch (err: any) {
      log.error(`Recovery error: ${err.message}`);
      this.recoveryLevel = Math.min(this.recoveryLevel + 1, MAX_RECOVERY_LEVEL);
    } finally {
      this._recovering = false;
    }
  }

  // ─── Recovery Levels ───

  private async recoverLevel0_jump(): Promise<void> {
    // Clear blocking blocks in movement direction (handles diagonal stuck)
    const blocking = this.getBlockingBlocks();
    for (const block of blocking) {
      await this.safeDig(block);
    }

    this.bot.setControlState('jump', true);
    await this.sleep(300);
    this.bot.setControlState('jump', false);
  }

  private async recoverLevel1_jumpAndMove(): Promise<void> {
    if (!this.bot.entity) return;
    const botPos = this.bot.entity.position;

    // Dig all blocking blocks in movement path (including diagonal neighbors)
    const blocking = this.getBlockingBlocks();
    for (const block of blocking) {
      await this.safeDig(block);
      await this.waitTicks(1);
    }

    // Also dig overlapping blocks
    const overlapping = this.getOverlappingBlocks();
    for (const block of overlapping) {
      if (!this.toolSelector.shouldMine(block)) continue;
      await this.safeDig(block);
    }

    // Jump forward in movement direction
    this.bot.setControlState('forward', true);
    this.bot.setControlState('jump', true);
    await this.sleep(400);
    this.bot.clearControlStates();

    // Fallback: if still overlapping a block, escape away from it
    const stillOverlapping = this.getOverlappingBlocks();
    if (stillOverlapping.length > 0) {
      const blockCenter = stillOverlapping[0].position.offset(0.5, 0, 0.5);
      const escapeX = botPos.x - blockCenter.x;
      const escapeZ = botPos.z - blockCenter.z;
      const len = Math.sqrt(escapeX * escapeX + escapeZ * escapeZ);
      if (len > 0.01) {
        try {
          await this.bot.lookAt(
            botPos.offset((escapeX / len) * 5, 0, (escapeZ / len) * 5),
            true,
          );
        } catch {}
        this.bot.setControlState('jump', true);
        this.bot.setControlState('forward', true);
        await this.sleep(300);
        this.bot.clearControlStates();
      }
    }
  }

  private async recoverLevel2_digOverlapping(): Promise<void> {
    this.bot.setControlState('jump', true);
    await this.sleep(200);
    this.bot.setControlState('jump', false);

    const overlapping = this.getOverlappingBlocks();
    for (const block of overlapping) {
      if (!this.toolSelector.shouldMine(block)) continue;
      await this.safeDig(block);
    }
  }

  private async recoverLevel3_clearSpace(): Promise<void> {
    if (!this.bot.entity) return;
    const center = this.bot.entity.position.floored();

    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const pos = center.offset(dx, dy, dz);
          const block = this.bot.blockAt(pos);
          if (block && block.boundingBox === 'block' && this.toolSelector.shouldMine(block)) {
            await this.safeDig(block);
          }
        }
      }
    }

    this.bot.setControlState('jump', true);
    await this.sleep(300);
    this.bot.setControlState('jump', false);
  }

  private async recoverLevel4_digUp(): Promise<void> {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position.floored();

    await this.recoverLevel3_clearSpace();

    for (let dy = 2; dy <= 4; dy++) {
      const above = this.bot.blockAt(pos.offset(0, dy, 0));
      if (above && above.boundingBox === 'block' && this.toolSelector.shouldMine(above)) {
        await this.safeDig(above);
      }
    }

    this.bot.setControlState('jump', true);
    await this.sleep(500);
    this.bot.setControlState('jump', false);
  }

  private async recoverLevel5_emergency(): Promise<void> {
    log.error('EMERGENCY RECOVERY');
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position.floored();

    for (let dy = -1; dy <= 3; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0 && dy === -1) continue;
          const blockPos = pos.offset(dx, dy, dz);
          const block = this.bot.blockAt(blockPos);
          if (block && block.boundingBox === 'block' && block.name !== 'bedrock') {
            await this.safeDig(block);
          }
        }
      }
    }

    this.bot.setControlState('jump', true);
    await this.sleep(500);
    this.bot.clearControlStates();

    try { this.bot.pathfinder.stop(); } catch {}

    this.recoveryLevel = 0;
    this.consecutiveStucks = 0;
  }

  // ─── Utilities ───

  private async safeDig(block: Block): Promise<boolean> {
    try {
      await this.toolSelector.equipFor(block);
      return await new Promise<boolean>((resolve) => {
        let done = false;

        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          try { this.bot.stopDigging(); } catch {}
          resolve(false);
        }, this.timings.safedigTimeout);

        this.bot.dig(block)
          .then(() => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(true);
          })
          .catch(() => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(false);
          });
      });
    } catch {
      return false;
    }
  }

  private async waitTicks(ticks: number): Promise<void> {
    return new Promise((resolve) => {
      let count = 0;
      const handler = () => {
        count++;
        if (count >= ticks) {
          this.bot.off('physicTick', handler);
          resolve();
        }
      };
      this.bot.on('physicTick', handler);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
