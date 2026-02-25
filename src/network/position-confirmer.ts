import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { PingMonitor } from './ping-monitor.js';

export class PositionConfirmer {
  constructor(
    private bot: Bot,
    private pingMonitor: PingMonitor,
  ) {}

  /**
   * Wait until the server has likely confirmed our position.
   * Checks if the bot's position stabilizes near the expected position.
   */
  async waitForPositionConfirmation(expectedPos: Vec3, toleranceDist = 0.5): Promise<boolean> {
    const maxWait = Math.min(this.pingMonitor.currentPing * 3 + 200, 3000);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await this.bot.waitForTicks(1);
      if (!this.bot.entity) return false;

      const currentPos = this.bot.entity.position;
      if (currentPos.distanceTo(expectedPos) < toleranceDist) {
        return true;
      }
    }

    return false;
  }

  /**
   * After digging, wait for the block to actually disappear server-side.
   */
  async waitForBlockBreak(pos: Vec3, maxTicks = 4): Promise<boolean> {
    for (let i = 0; i < maxTicks; i++) {
      await this.bot.waitForTicks(1);
      const block = this.bot.blockAt(pos);
      if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
        return true;
      }
    }
    return false;
  }

  /**
   * Adaptive wait after digging — uses ping data to determine appropriate wait.
   */
  async waitAfterDig(pos: Vec3): Promise<boolean> {
    const ticks = this.getAdaptiveWaitTicks();
    return this.waitForBlockBreak(pos, ticks);
  }

  private getAdaptiveWaitTicks(): number {
    const ping = this.pingMonitor.currentPing;
    if (ping > 400) return 6;
    if (ping > 200) return 4;
    if (ping > 100) return 3;
    return 2;
  }
}
