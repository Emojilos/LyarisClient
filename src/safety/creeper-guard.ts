import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { BotEventBus } from '../core/event-bus.js';
import type { AppConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Creeper');

export class CreeperGuard {
  private tickListener: (() => void) | null = null;
  private soundListener: ((sound: any, position: Vec3) => void) | null = null;

  constructor(
    private bot: Bot,
    private eventBus: BotEventBus,
    private config: AppConfig,
  ) {}

  enable(): void {
    this.tickListener = () => {
      if (!this.bot.entity) return;

      const creeper = this.bot.nearestEntity(e => e.name?.toLowerCase() === 'creeper');
      if (!creeper || !creeper.position) return;

      const dist = this.bot.entity.position.distanceTo(creeper.position);

      if (dist < 10) {
        this.eventBus.emit('safety:creeper-nearby', dist);
      }

      if (dist < this.config.creeperEvadeDistance) {
        log.warn(`Creeper at ${dist.toFixed(1)}m — evading!`);
        this.evadeFrom(creeper.position);
      }

      if (dist < this.config.creeperDisconnectDistance) {
        log.error(`Creeper at ${dist.toFixed(1)}m — emergency disconnect!`);
        this.bot.quit();
      }
    };

    this.soundListener = (sound: any, position: Vec3) => {
      if (!this.bot.entity) return;
      if (sound.name?.includes('creeper.primed')) {
        const dist = this.bot.entity.position.distanceTo(position);
        if (dist < 7) {
          log.error(`Heard creeper hissing at ${dist.toFixed(1)}m — disconnecting!`);
          this.bot.quit();
        }
      }
    };

    this.bot.on('physicTick', this.tickListener);
    (this.bot as any).on('soundEffect', this.soundListener);
    log.info('Creeper guard enabled');
  }

  disable(): void {
    if (this.tickListener) {
      this.bot.off('physicTick', this.tickListener);
      this.tickListener = null;
    }
    if (this.soundListener) {
      (this.bot as any).off('soundEffect', this.soundListener);
      this.soundListener = null;
    }
  }

  private evadeFrom(threatPos: Vec3): void {
    if (!this.bot.entity) return;

    const botPos = this.bot.entity.position;
    const away = botPos.minus(threatPos).normalize();

    this.bot.lookAt(botPos.plus(away.scaled(5)), true);
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('forward', true);

    setTimeout(() => {
      this.bot.setControlState('sprint', false);
      this.bot.setControlState('forward', false);
    }, 2000);
  }
}
