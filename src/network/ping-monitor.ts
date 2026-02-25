import type { Bot } from 'mineflayer';
import type { BotEventBus } from '../core/event-bus.js';
import type { PingData } from '../types.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Ping');

export class PingMonitor {
  private bot: Bot;
  private eventBus: BotEventBus;

  private samples: number[] = [];
  private readonly SAMPLE_SIZE = 20;
  private measureInterval: ReturnType<typeof setInterval> | null = null;

  // TPS estimation
  private lastTickTime = 0;
  private tickDeltas: number[] = [];
  private readonly TPS_SAMPLE_SIZE = 40;
  private tickListener: (() => void) | null = null;

  private _currentPing = 0;
  private _tps = 20;

  constructor(bot: Bot, eventBus: BotEventBus) {
    this.bot = bot;
    this.eventBus = eventBus;
  }

  get currentPing(): number { return this._currentPing; }
  get tps(): number { return this._tps; }

  get averagePing(): number {
    if (this.samples.length === 0) return 0;
    return Math.round(this.samples.reduce((a, b) => a + b, 0) / this.samples.length);
  }

  get jitter(): number {
    if (this.samples.length < 2) return 0;
    const avg = this.averagePing;
    const variance = this.samples.reduce((sum, s) => sum + (s - avg) ** 2, 0) / this.samples.length;
    return Math.round(Math.sqrt(variance));
  }

  get quality(): PingData['quality'] {
    const ping = this._currentPing;
    if (ping < 100) return 'good';
    if (ping < 250) return 'moderate';
    if (ping < 500) return 'poor';
    return 'critical';
  }

  getData(): PingData {
    return {
      ping: this._currentPing,
      tps: Math.round(this._tps * 10) / 10,
      quality: this.quality,
    };
  }

  start(): void {
    this.startPingMeasurement();
    this.startTPSEstimation();
    log.info('Ping monitoring started');
  }

  stop(): void {
    if (this.measureInterval) {
      clearInterval(this.measureInterval);
      this.measureInterval = null;
    }
    if (this.tickListener) {
      this.bot.off('physicTick', this.tickListener);
      this.tickListener = null;
    }
  }

  private startPingMeasurement(): void {
    this.measureInterval = setInterval(() => {
      const player = this.bot.player;
      if (!player) return;

      const ping = player.ping ?? 0;
      this.samples.push(ping);
      if (this.samples.length > this.SAMPLE_SIZE) this.samples.shift();

      // Use median for stability (resistant to spikes)
      const sorted = [...this.samples].sort((a, b) => a - b);
      this._currentPing = sorted[Math.floor(sorted.length / 2)];

      const data = this.getData();
      this.eventBus.emit('ping:update', data);

      if (this._currentPing > 500) {
        this.eventBus.emit('ping:high', this._currentPing);
      }
      if (this._currentPing > 1000) {
        this.eventBus.emit('ping:critical', this._currentPing);
      }
    }, 3000);
  }

  private startTPSEstimation(): void {
    this.lastTickTime = Date.now();

    this.tickListener = () => {
      const now = Date.now();
      const delta = now - this.lastTickTime;
      this.lastTickTime = now;

      // Ignore outliers (> 500ms = server freeze, not TPS indicator)
      if (delta > 0 && delta < 500) {
        this.tickDeltas.push(delta);
        if (this.tickDeltas.length > this.TPS_SAMPLE_SIZE) this.tickDeltas.shift();
      }

      if (this.tickDeltas.length >= 10) {
        const avgDelta = this.tickDeltas.reduce((a, b) => a + b, 0) / this.tickDeltas.length;
        // Normal tick = 50ms = 20 TPS
        this._tps = Math.min(20, 1000 / avgDelta);
      }
    };

    this.bot.on('physicTick', this.tickListener);
  }
}
