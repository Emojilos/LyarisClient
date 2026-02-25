import type { PingMonitor } from './ping-monitor.js';

export class AdaptiveTimings {
  constructor(public readonly pingMonitor: PingMonitor) {}

  private get ping(): number { return this.pingMonitor.currentPing; }
  private get tps(): number { return this.pingMonitor.tps; }

  /** Timeout for digging a single block */
  get digTimeout(): number {
    const base = 6000;
    const pingFactor = Math.max(0, this.ping * 2);
    const tpsFactor = 20 / Math.max(1, this.tps);
    return Math.min(Math.round((base + pingFactor) * tpsFactor), 30000);
  }

  /** Timeout for pathfinder to reach a nearby block */
  get pathfindTimeout(): number {
    const base = 8000;
    return Math.min(Math.round(base + this.ping * 3), 30000);
  }

  /** Timeout for long-distance navigation (to base, bed, etc.) */
  get navigationTimeout(): number {
    const base = 180000;
    return Math.min(Math.round(base + this.ping * 10), 300000);
  }

  /** Ticks to wait after digging for server confirmation */
  get postDigWaitTicks(): number {
    if (this.ping > 400) return 6;
    if (this.ping > 200) return 4;
    if (this.ping > 100) return 3;
    return 2;
  }

  /** Delay between mining iterations (ms) */
  get interBlockDelay(): number {
    return Math.min(Math.round(Math.max(0, (this.ping - 50) * 0.4)), 200);
  }

  /** Physics speed multiplier */
  get speedMultiplier(): number {
    if (this.ping > 400) return 0.45;
    if (this.ping > 200) return 0.55;
    if (this.ping > 100) return 0.65;
    return 0.8;
  }

  /** Whether mining should auto-pause due to bad connection */
  get shouldAutoPause(): boolean {
    return this.ping > 1000 || this.tps < 5;
  }

  /** Anti-stuck stall detection threshold (ms) */
  get stallTimeThreshold(): number {
    return 3000 + this.ping * 2;
  }

  /** Anti-stuck recovery cooldown (ms) */
  get recoveryCooldown(): number {
    return 2000 + this.ping;
  }

  /** Stuck ticks threshold before triggering recovery */
  get stuckTicksThreshold(): number {
    if (this.ping > 300) return 5;
    if (this.ping > 150) return 4;
    return 3;
  }

  /** Minimum recovery level to start at (skip useless jumps on high ping) */
  get minRecoveryLevel(): number {
    if (this.ping > 300) return 2;
    if (this.ping > 150) return 1;
    return 0;
  }

  /** Safe dig timeout for anti-stuck block clearing */
  get safedigTimeout(): number {
    return Math.min(5000 + this.ping * 2, 15000);
  }

  /** Timeout for waiting for pathfinder stuck detection (ms) */
  get stuckCheckInterval(): number {
    return 500;
  }

  /** Rubber-band detection distance */
  get rubberBandDistance(): number {
    // On high ping, larger teleports are normal, so increase threshold
    if (this.ping > 300) return 1.0;
    if (this.ping > 150) return 0.7;
    return 0.5;
  }
}
