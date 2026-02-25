import type { Bot } from 'mineflayer';
import type { BotEventBus } from '../core/event-bus.js';
import type { AppConfig } from '../core/config.js';
import type { FoodManager } from '../inventory/food-manager.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Health');

// Cooldown between mob-triggered disconnects to avoid instant spam
const MOB_QUIT_COOLDOWN_MS = 8_000;
// How often to run the post-spawn mob check
const SPAWN_CHECK_INTERVAL_MS = 2_000;
// How long to keep running the post-spawn check
const SPAWN_CHECK_DURATION_MS = 90_000;
// Radius to scan for hostile mobs (blocks)
const MOB_DANGER_RADIUS = 10;

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'spider', 'cave_spider', 'creeper',
  'witch', 'blaze', 'ghast', 'slime', 'magma_cube',
  'guardian', 'elder_guardian', 'shulker', 'phantom',
  'drowned', 'husk', 'stray', 'wither_skeleton',
  'pillager', 'ravager', 'vindicator', 'evoker', 'vex',
  'hoglin', 'zoglin', 'piglin_brute', 'warden',
  'silverfish', 'endermite', 'enderman',
]);

export class HealthMonitor {
  private lastHealth = 20;
  private listener: (() => void) | null = null;
  private spawnCheckInterval: ReturnType<typeof setInterval> | null = null;

  private isHealing = false;
  private lastQuitAt = 0;

  constructor(
    private bot: Bot,
    private eventBus: BotEventBus,
    private config: AppConfig,
    private foodManager: FoodManager,
  ) {}

  enable(): void {
    this.lastHealth = this.bot.health ?? 20;
    this.isHealing = false;

    this.listener = () => {
      const health = this.bot.health;
      const food = this.bot.food;

      this.eventBus.emit('bot:health-changed', health, food);

      if (health < this.lastHealth) {
        this.eventBus.emit('safety:taking-damage', health);

        if (health < this.config.lowHealthThreshold && !this.isHealing) {
          this.handleLowHealth(health);
        }
      }

      this.lastHealth = health;
    };

    this.bot.on('health', this.listener);
    this.startSpawnCheck();

    log.info('Health monitoring enabled');
  }

  disable(): void {
    if (this.listener) {
      this.bot.off('health', this.listener);
      this.listener = null;
    }
    this.stopSpawnCheck();
    this.isHealing = false;
  }

  // ─── Post-spawn periodic check ───
  // Reconnects if health is still low AND mobs are nearby after spawning.

  private startSpawnCheck(): void {
    this.stopSpawnCheck();

    let elapsed = 0;

    this.spawnCheckInterval = setInterval(() => {
      elapsed += SPAWN_CHECK_INTERVAL_MS;

      if (elapsed >= SPAWN_CHECK_DURATION_MS || !this.listener) {
        this.stopSpawnCheck();
        return;
      }

      if ((this.bot.health ?? 20) >= this.config.lowHealthThreshold) return;

      const mob = this.hasDangerousMobsNearby();
      if (!mob) return;

      const now = Date.now();
      if (now - this.lastQuitAt < MOB_QUIT_COOLDOWN_MS) return;

      log.error(`Post-spawn: low health (${this.bot.health} HP) + ${mob} nearby — reconnecting!`);
      this.lastQuitAt = now;
      this.stopSpawnCheck();
      this.bot.quit();
    }, SPAWN_CHECK_INTERVAL_MS);
  }

  private stopSpawnCheck(): void {
    if (this.spawnCheckInterval) {
      clearInterval(this.spawnCheckInterval);
      this.spawnCheckInterval = null;
    }
  }

  // ─── Damage event handler ───

  private hasDangerousMobsNearby(): string | null {
    if (!this.bot.entity) return null;
    const mob = this.bot.nearestEntity(
      e => !!e.name && HOSTILE_MOBS.has(e.name.toLowerCase()),
    );
    if (!mob || !mob.position) return null;
    const dist = this.bot.entity.position.distanceTo(mob.position);
    return dist <= MOB_DANGER_RADIUS ? mob.name! : null;
  }

  private handleLowHealth(health: number): void {
    const mob = this.hasDangerousMobsNearby();

    if (mob) {
      // Mobs nearby — disconnect immediately, no point eating
      const now = Date.now();
      if (now - this.lastQuitAt >= MOB_QUIT_COOLDOWN_MS) {
        log.error(`Low health (${health} HP) + ${mob} nearby — disconnecting!`);
        this.lastQuitAt = now;
        this.bot.quit();
      } else {
        log.warn(`Low health (${health} HP) + ${mob} nearby but on cooldown`);
      }
      return;
    }

    // No mobs — just eat and recover, never disconnect
    if (this.isHealing) return;
    this.isHealing = true;

    log.warn(`Low health (${health} HP), no mobs nearby — eating to recover`);

    this.foodManager.eatIfNeeded(20).then(() => {
      this.isHealing = false;
    }).catch(() => {
      this.isHealing = false;
    });
  }
}
