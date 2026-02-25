import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Area, NormalizedArea, MiningState, MiningStatus } from '../types.js';
import type { BotEventBus } from '../core/event-bus.js';
import type { AdaptiveTimings } from '../network/adaptive-timings.js';
import type { PositionConfirmer } from '../network/position-confirmer.js';
import type { PingMonitor } from '../network/ping-monitor.js';
import type { Navigator } from './navigator.js';
import type { StateManager } from './state-manager.js';
import type { ToolSelector } from '../inventory/tool-selector.js';
import type { InventoryManager } from '../inventory/inventory-manager.js';
import type { FoodManager } from '../inventory/food-manager.js';
import type { AntiStuck } from '../safety/anti-stuck.js';
import type { AppConfig } from '../core/config.js';
import { generateZigzagPositions } from './zigzag-planner.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Miner');
const REACH_DISTANCE = 4.5;

export class MiningEngine {
  private bot: Bot;
  private eventBus: BotEventBus;
  private navigator: Navigator;
  private stateManager: StateManager;
  private toolSelector: ToolSelector;
  private inventoryManager: InventoryManager;
  private foodManager: FoodManager;
  private antiStuck: AntiStuck;
  private timings: AdaptiveTimings;
  private posConfirmer: PositionConfirmer;
  private pingMonitor: PingMonitor;
  private config: AppConfig;

  private state: MiningState;

  constructor(deps: {
    bot: Bot;
    eventBus: BotEventBus;
    navigator: Navigator;
    stateManager: StateManager;
    toolSelector: ToolSelector;
    inventoryManager: InventoryManager;
    foodManager: FoodManager;
    antiStuck: AntiStuck;
    timings: AdaptiveTimings;
    posConfirmer: PositionConfirmer;
    pingMonitor: PingMonitor;
    config: AppConfig;
  }) {
    this.bot = deps.bot;
    this.eventBus = deps.eventBus;
    this.navigator = deps.navigator;
    this.stateManager = deps.stateManager;
    this.toolSelector = deps.toolSelector;
    this.inventoryManager = deps.inventoryManager;
    this.foodManager = deps.foodManager;
    this.antiStuck = deps.antiStuck;
    this.timings = deps.timings;
    this.posConfirmer = deps.posConfirmer;
    this.pingMonitor = deps.pingMonitor;
    this.config = deps.config;

    this.state = {
      status: 'idle',
      area: null,
      totalBlocks: 0,
      minedBlocks: 0,
      currentTool: null,
      botPosition: null,
      error: null,
      health: 20,
      food: 20,
      ping: 0,
      tps: 20,
    };
  }

  // ─── Public API ───

  getState(): MiningState {
    const pos = this.bot.entity?.position;
    const pingData = this.pingMonitor.getData();
    return {
      ...this.state,
      botPosition: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
      health: this.bot.health ?? 20,
      food: this.bot.food ?? 20,
      ping: pingData.ping,
      tps: pingData.tps,
    };
  }

  async start(area: Area, startIndex = 0): Promise<void> {
    if (this.state.status === 'mining' && startIndex === 0) {
      throw new Error('Already mining');
    }

    const normalized = this.normalizeArea(area);
    this.state.status = 'mining';
    this.state.area = normalized;
    this.state.minedBlocks = startIndex;
    this.state.error = null;

    this.navigator.configureForMining();
    this.antiStuck.enable();

    this.eventBus.emit('mining:started', normalized);
    log.info(`Mining started: ${this.areaSize(normalized)} blocks`);

    try {
      await this.mineArea(normalized, startIndex);
      if (this.state.status === 'mining') {
        this.state.status = 'finished';
        this.stateManager.clear();
        this.eventBus.emit('mining:finished');
        log.success('Mining complete!');
      }
    } catch (err: any) {
      if ((this.state.status as string) !== 'idle') {
        this.state.status = 'error';
        this.state.error = err.message;
        this.eventBus.emit('mining:error', err.message);
        log.error(`Mining error: ${err.message}`);
      }
    } finally {
      this.antiStuck.disable();
    }
  }

  pause(): void {
    if (this.state.status === 'mining') {
      this.state.status = 'paused';
      this.stateManager.save(this.state.area!, this.state.minedBlocks);
      this.eventBus.emit('mining:paused', 'user');
      log.info('Mining paused');
    }
  }

  resume(): void {
    if (this.state.status === 'paused') {
      this.state.status = 'mining';
      this.eventBus.emit('mining:resumed');
      log.info('Mining resumed');
    }
  }

  stop(): void {
    this.state.status = 'idle';
    this.state.error = null;
    this.navigator.stop();
    this.antiStuck.disable();
    this.stateManager.clear();
    log.info('Mining stopped');
  }

  async resumeIfNeeded(): Promise<void> {
    const saved = this.stateManager.load();
    if (!saved) return;

    log.info('Found saved progress. Resuming...');
    const area: Area = {
      corner1: new Vec3(saved.area.min.x, saved.area.min.y, saved.area.min.z),
      corner2: new Vec3(saved.area.max.x, saved.area.max.y, saved.area.max.z),
    };
    await this.start(area, saved.minedBlocks);
  }

  async goToBase(): Promise<void> {
    const base = this.config.baseLocation;
    if (!base) throw new Error('Base coordinates not set in .env');
    if (this.state.status === 'mining' || this.state.status === 'traveling') {
      throw new Error('Bot is busy');
    }

    this.state.status = 'traveling';
    this.state.error = 'Navigating to base...';
    this.navigator.configureForTravel();
    this.antiStuck.enable();

    try {
      if (base.y === null) {
        await this.navigator.goToXZ(base.x, base.z);
      } else {
        await this.navigator.goTo(base.x, base.y, base.z, 2);
      }

      if (this.state.status === 'traveling') {
        this.state.status = 'idle';
        this.state.error = null;
        log.success('Reached base!');
      }
    } catch (err: any) {
      if ((this.state.status as string) !== 'idle') {
        this.state.status = 'error';
        this.state.error = `Navigation error: ${err.message}`;
        log.error(`Navigation error: ${err.message}`);
      }
    } finally {
      this.antiStuck.disable();
    }
  }

  // ─── Private ───

  private async mineArea(area: NormalizedArea, startIndex: number): Promise<void> {
    const positions = generateZigzagPositions(area);
    this.state.totalBlocks = positions.length;

    for (let i = startIndex; i < positions.length; i++) {
      if (this.state.status === 'idle') return;

      // Periodic save
      if (i % 50 === 0) {
        this.stateManager.save(area, this.state.minedBlocks);
        await this.sleep(10);
      }

      // Auto-pause on critical ping
      if (this.timings.shouldAutoPause && this.state.status === 'mining') {
        log.warn(`Auto-pausing: ping=${this.pingMonitor.currentPing}ms, TPS=${this.pingMonitor.tps}`);
        this.state.status = 'paused';
        this.state.error = 'Auto-paused: bad connection';
        this.eventBus.emit('mining:paused', 'high_ping');
        while (this.timings.shouldAutoPause && this.state.status === 'paused') {
          await this.sleep(2000);
        }
        if (this.state.status === 'paused') {
          this.state.status = 'mining';
          this.state.error = null;
        }
      }

      // Health check
      if (this.bot.health < 14) {
        const oldStatus = this.state.status;
        this.state.status = 'paused';
        this.state.error = 'Healing...';
        while (this.bot.health < this.config.healToThreshold) {
          await this.foodManager.eatIfNeeded();
          await this.sleep(2000);
          if ((this.state.status as string) === 'idle') return;
        }
        this.state.status = oldStatus === 'paused' ? 'paused' : 'mining';
        this.state.error = null;
      }

      // Pause handling
      while ((this.state.status as string) === 'paused') {
        await this.sleep(500);
        if ((this.state.status as string) === 'idle') return;
      }

      // Eat if needed
      await this.foodManager.eatIfNeeded(this.config.foodThreshold);

      const pos = positions[i];
      await this.mineBlock(pos, area);

      this.state.minedBlocks = i + 1;
      this.eventBus.emit('mining:progress', this.state.minedBlocks, this.state.totalBlocks);

      // Inter-block delay for laggy servers
      const delay = this.timings.interBlockDelay;
      if (delay > 0) await this.sleep(delay);
    }
  }

  private async mineBlock(pos: Vec3, area: NormalizedArea): Promise<void> {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      if ((this.state.status as string) === 'idle') return;

      // Clear overlapping blocks
      await this.antiStuck.clearOverlapping();

      const block = this.bot.blockAt(pos);
      if (!block || !this.toolSelector.shouldMine(block)) return;

      // Check inventory
      if (this.inventoryManager.isFull()) {
        this.state.error = 'Depositing items...';
        this.eventBus.emit('inventory:full');
        const freed = await this.inventoryManager.depositToChest(this.state.area);
        this.state.error = null;
        if (!freed) {
          this.state.status = 'paused';
          this.state.error = 'Inventory full, no chest found';
          this.stateManager.save(area, this.state.minedBlocks);
          while (this.state.status === 'paused') {
            await this.sleep(1000);
            if (!this.inventoryManager.isFull()) {
              this.state.status = 'mining';
              this.state.error = null;
              break;
            }
          }
          if (this.state.status !== 'mining') return;
        }
      }

      // Navigate to block if out of reach
      const distance = this.bot.entity.position.distanceTo(pos);
      if (distance > REACH_DISTANCE || !this.bot.canSeeBlock(block)) {
        try {
          await this.navigator.goNear(pos, 2);
        } catch {
          // Ignore, will retry
        }
      }

      const targetBlock = this.bot.blockAt(pos);
      if (!targetBlock || !this.toolSelector.shouldMine(targetBlock)) return;

      this.state.currentTool = await this.toolSelector.equipFor(targetBlock);

      try {
        await this.bot.lookAt(targetBlock.position.offset(0.5, 0.5, 0.5), true);

        // Verify reachability after looking
        const distAfter = this.bot.entity.position.distanceTo(pos);
        if (distAfter > REACH_DISTANCE || !this.bot.canSeeBlock(targetBlock)) {
          throw new Error('Block not visible after looking');
        }

        // Dig with adaptive timeout
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const timeout = this.timings.digTimeout;

          const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            this.bot.stopDigging();
            setTimeout(() => reject(new Error('Dig timeout')), 300);
          }, timeout);

          this.bot.dig(targetBlock)
            .then(() => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              resolve();
            })
            .catch((err) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              reject(err);
            });
        });

        // Wait for server to confirm block destruction (adaptive)
        await this.posConfirmer.waitAfterDig(pos);

        this.antiStuck.markSafePosition();
        this.stateManager.save(area, this.state.minedBlocks);
        this.eventBus.emit('mining:block-mined', pos, targetBlock.name);

        return; // Success
      } catch {
        attempts++;
        await this.sleep(500);
      }
    }
  }

  private normalizeArea(area: Area): NormalizedArea {
    return {
      min: new Vec3(
        Math.min(area.corner1.x, area.corner2.x),
        Math.min(area.corner1.y, area.corner2.y),
        Math.min(area.corner1.z, area.corner2.z),
      ),
      max: new Vec3(
        Math.max(area.corner1.x, area.corner2.x),
        Math.max(area.corner1.y, area.corner2.y),
        Math.max(area.corner1.z, area.corner2.z),
      ),
    };
  }

  private areaSize(area: NormalizedArea): number {
    return (area.max.x - area.min.x + 1) *
           (area.max.y - area.min.y + 1) *
           (area.max.z - area.min.z + 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
