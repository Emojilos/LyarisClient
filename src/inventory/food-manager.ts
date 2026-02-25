import type { Bot } from 'mineflayer';
import type { BotEventBus } from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Food');

const FOOD_ITEMS = new Set([
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'baked_potato', 'bread', 'golden_carrot', 'apple', 'carrot',
  'melon_slice', 'sweet_berries', 'golden_apple', 'enchanted_golden_apple',
  'cooked_cod', 'cooked_salmon', 'mushroom_stew', 'rabbit_stew',
  'beetroot_soup', 'pumpkin_pie', 'cookie',
]);

export class FoodManager {
  constructor(
    private bot: Bot,
    private eventBus: BotEventBus,
  ) {}

  /**
   * Eat food if hunger is below threshold.
   */
  async eatIfNeeded(threshold = 18): Promise<void> {
    if (this.bot.food >= threshold) return;

    const items = this.bot.inventory.items();
    const food = items.find(item => FOOD_ITEMS.has(item.name));

    if (!food) {
      this.eventBus.emit('inventory:hungry');
      return;
    }

    log.info(`Eating ${food.name}...`);
    this.eventBus.emit('inventory:eating', food.name);

    try {
      await this.bot.equip(food, 'hand');
      await this.bot.consume();
      log.success('Finished eating');
    } catch (err: any) {
      log.error(`Failed to eat: ${err.message}`);
    }
  }

  /**
   * Check if the bot has any food items.
   */
  hasFood(): boolean {
    return this.bot.inventory.items().some(item => FOOD_ITEMS.has(item.name));
  }

  static isFoodItem(name: string): boolean {
    return FOOD_ITEMS.has(name);
  }
}
