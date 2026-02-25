import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals, Movements } from 'mineflayer-pathfinder';
import type { AdaptiveTimings } from '../network/adaptive-timings.js';
import type { AntiStuck } from '../safety/anti-stuck.js';
import { createLogger } from '../core/logger.js';

const { GoalNear, GoalXZ } = goals;
const log = createLogger('Navigator');

export class Navigator {
  private antiStuck: AntiStuck | null = null;

  constructor(
    private bot: Bot,
    private timings: AdaptiveTimings,
  ) {}

  setAntiStuck(antiStuck: AntiStuck): void {
    this.antiStuck = antiStuck;
  }

  /**
   * Configure pathfinder movements.
   */
  configureForMining(): void {
    const movements = new Movements(this.bot);
    movements.canDig = true;
    movements.allowSprinting = false;
    movements.allowParkour = false;
    movements.allowFreeMotion = false;
    movements.scafoldingBlocks = [];
    this.bot.pathfinder.setMovements(movements);
  }

  configureForTravel(): void {
    const movements = new Movements(this.bot);
    movements.canDig = false;
    movements.allowSprinting = false;
    movements.allowParkour = false;
    movements.allowFreeMotion = false;
    this.bot.pathfinder.setMovements(movements);
  }

  /**
   * Navigate to within `range` blocks of a position.
   */
  async goNear(pos: Vec3, range = 2): Promise<void> {
    const goal = new GoalNear(pos.x, pos.y, pos.z, range);
    await this.gotoWithTimeout(goal, this.timings.pathfindTimeout);
  }

  /**
   * Navigate to an XZ position (ignoring Y).
   */
  async goToXZ(x: number, z: number): Promise<void> {
    const goal = new GoalXZ(x, z);
    await this.gotoWithTimeout(goal, this.timings.navigationTimeout);
  }

  /**
   * Navigate to a specific position with Y.
   */
  async goTo(x: number, y: number, z: number, range = 2): Promise<void> {
    const goal = new GoalNear(x, y, z, range);
    await this.gotoWithTimeout(goal, this.timings.navigationTimeout);
  }

  /**
   * Stop pathfinder and clear movement states.
   */
  stop(): void {
    try { this.bot.pathfinder.stop(); } catch {}
    this.bot.clearControlStates();
  }

  private gotoWithTimeout(goal: any, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let isDone = false;
      let stuckChecker: ReturnType<typeof setInterval> | null = null;

      const finish = (err?: Error) => {
        if (isDone) return;
        isDone = true;
        if (stuckChecker) clearInterval(stuckChecker);
        clearTimeout(timer);
        this.bot.clearControlStates();
        if (err) reject(err);
        else resolve();
      };

      let lastPos = this.bot.entity.position.clone();
      let stuckMs = 0;
      const stuckInterval = this.timings.stuckCheckInterval;

      stuckChecker = setInterval(() => {
        if (isDone || !this.bot.entity) return;
        const pos = this.bot.entity.position;
        if (pos.distanceTo(lastPos) < 0.2) {
          stuckMs += stuckInterval;
          if (stuckMs >= 2000) {
            // Try clearing blocking blocks (especially diagonal ones)
            if (this.antiStuck && !this.antiStuck.isRecovering()) {
              this.antiStuck.clearBlockingPath();
            }
            this.bot.setControlState('jump', true);
            setTimeout(() => {
              if (!isDone) this.bot.setControlState('jump', false);
            }, 250);
            stuckMs = 0;
          }
        } else {
          stuckMs = 0;
          lastPos = pos.clone();
        }
      }, stuckInterval);

      const timer = setTimeout(() => {
        this.bot.pathfinder.stop();
        finish(new Error('Path timeout'));
      }, timeoutMs);

      this.bot.pathfinder.goto(goal)
        .then(() => finish())
        .catch((err) => finish(err));
    });
  }
}
