import type { BotEventBus } from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Reconnect');

export class AutoReconnect {
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private readonly MAX_DELAY = 120000;
  private readonly BASE_DELAY = 5000;
  private overrideDelay: number | null = null;

  constructor(
    private eventBus: BotEventBus,
    private reconnectFn: () => void,
  ) {}

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.eventBus.on('bot:disconnected', (reason) => {
      if (!this.enabled) return;

      this.attempt++;
      const delay = this.calculateDelay();

      log.warn(`Disconnected: ${reason}. Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${this.attempt})...`);

      this.timer = setTimeout(() => {
        if (!this.enabled) return;
        log.info('Reconnecting...');
        this.reconnectFn();
      }, delay);
    });

    log.info('Auto-reconnect enabled');
  }

  disable(): void {
    this.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resetAttempts(): void {
    this.attempt = 0;
  }

  setNextDelay(ms: number): void {
    this.overrideDelay = ms;
  }

  private calculateDelay(): number {
    if (this.overrideDelay !== null) {
      const d = this.overrideDelay;
      this.overrideDelay = null;
      return d;
    }
    // Exponential backoff: 5s, 7.5s, 11.25s, ... max 120s
    return Math.min(this.BASE_DELAY * Math.pow(1.5, this.attempt - 1), this.MAX_DELAY);
  }
}
