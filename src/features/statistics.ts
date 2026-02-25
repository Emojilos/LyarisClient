import type { BotEventBus } from '../core/event-bus.js';
import type { MiningStats } from '../types.js';

export class Statistics {
  private sessionStart = Date.now();
  private totalBlocksMined = 0;
  private blockTimestamps: number[] = [];
  private totalBlocks = 0;

  constructor(private eventBus: BotEventBus) {
    this.eventBus.on('mining:block-mined', () => {
      this.totalBlocksMined++;
      const now = Date.now();
      this.blockTimestamps.push(now);
      // Keep only last 60 seconds for rate calculation
      const cutoff = now - 60000;
      this.blockTimestamps = this.blockTimestamps.filter(t => t > cutoff);
    });

    this.eventBus.on('mining:started', (area) => {
      const dx = area.max.x - area.min.x + 1;
      const dy = area.max.y - area.min.y + 1;
      const dz = area.max.z - area.min.z + 1;
      this.totalBlocks = dx * dy * dz;
    });

    this.eventBus.on('mining:finished', () => {
      this.totalBlocks = 0;
    });
  }

  getStats(): MiningStats {
    const blocksPerMinute = this.blockTimestamps.length;
    const remaining = this.totalBlocks > 0
      ? this.totalBlocks - this.totalBlocksMined
      : 0;

    const estimatedTimeRemaining = blocksPerMinute > 0 && remaining > 0
      ? Math.round((remaining / blocksPerMinute) * 60000)
      : null;

    return {
      sessionDuration: Date.now() - this.sessionStart,
      totalBlocksMined: this.totalBlocksMined,
      blocksPerMinute,
      estimatedTimeRemaining,
    };
  }

  resetSession(): void {
    this.sessionStart = Date.now();
    this.totalBlocksMined = 0;
    this.blockTimestamps = [];
    this.totalBlocks = 0;
  }
}
