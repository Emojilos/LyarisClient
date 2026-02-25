import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import type { NormalizedArea } from '../types.js';
import type { BotEventBus } from '../core/event-bus.js';
import type { AppConfig } from '../core/config.js';
import { FoodManager } from './food-manager.js';
import { createLogger } from '../core/logger.js';

const { GoalNear } = goals;
const log = createLogger('Inventory');

const TOOL_SUFFIXES = ['_pickaxe', '_axe', '_shovel', '_sword', '_hoe'];

function shouldKeepItem(name: string): boolean {
  if (TOOL_SUFFIXES.some(s => name.endsWith(s))) return true;
  if (FoodManager.isFoodItem(name)) return true;
  return false;
}

export class InventoryManager {
  constructor(
    private bot: Bot,
    private eventBus: BotEventBus,
    private config: AppConfig,
  ) {}

  /**
   * Check if inventory is full (no empty slots in main inventory).
   */
  isFull(): boolean {
    const emptySlots = this.bot.inventory.slots.filter(
      (slot, i) => i >= 9 && i < 45 && slot === null
    );
    return emptySlots.length === 0;
  }

  /**
   * Get the number of empty inventory slots.
   */
  emptySlots(): number {
    return this.bot.inventory.slots.filter(
      (slot, i) => i >= 9 && i < 45 && slot === null
    ).length;
  }

  /**
   * Deposit items to a chest. Tries multiple strategies to find one.
   * Returns true if inventory was freed.
   */
  async depositToChest(miningArea?: NormalizedArea | null): Promise<boolean> {
    const chestBlock = this.findChest(miningArea);

    if (!chestBlock) {
      log.warn('No chest found! Place one in the mining area, near the bot, or specify in .env');
      return false;
    }

    log.info(`Going to chest at ${chestBlock.position}...`);

    // Navigate to chest
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.bot.pathfinder.stop();
          reject(new Error('Chest navigation timeout'));
        }, 30000);

        this.bot.pathfinder.goto(
          new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
        )
          .then(() => { clearTimeout(timer); resolve(); })
          .catch((err) => { clearTimeout(timer); reject(err); });
      });
    } catch (err: any) {
      log.error(`Failed to reach chest: ${err.message}`);
      return false;
    }

    // Open and deposit
    let chest: any;
    try {
      chest = await (this.bot as any).openChest(chestBlock);
    } catch (err: any) {
      log.error(`Failed to open chest: ${err.message}`);
      return false;
    }

    try {
      for (const item of this.bot.inventory.items()) {
        if (!shouldKeepItem(item.name)) {
          try {
            await chest.deposit(item.type, null, item.count);
          } catch {
            log.warn('Chest full, stopping deposit');
            break;
          }
        }
      }
      log.success('Items deposited to chest');
      this.eventBus.emit('inventory:deposited');
    } finally {
      chest.close();
    }

    return !this.isFull();
  }

  /**
   * Get hotbar items for UI display.
   */
  getHotbar(): { slots: (null | { name: string; displayName: string; count: number })[]; activeSlot: number } {
    const slots = [];
    for (let i = 36; i <= 44; i++) {
      const item = this.bot.inventory.slots[i];
      slots.push(item ? { name: item.name, displayName: item.displayName, count: item.count } : null);
    }
    return { slots, activeSlot: this.bot.quickBarSlot };
  }

  private findChest(miningArea?: NormalizedArea | null): Block | null {
    // 1. Search within mining area
    if (miningArea) {
      const inArea = this.bot.findBlock({
        matching: (b: Block) => {
          if (b.name !== 'chest' && b.name !== 'trapped_chest') return false;
          if (!b.position) return false;
          return b.position.x >= miningArea.min.x && b.position.x <= miningArea.max.x &&
                 b.position.y >= miningArea.min.y && b.position.y <= miningArea.max.y &&
                 b.position.z >= miningArea.min.z && b.position.z <= miningArea.max.z;
        },
        maxDistance: 128,
      });
      if (inArea) {
        log.info(`Found chest in mining area: ${inArea.position}`);
        return inArea;
      }
    }

    // 2. Use coordinates from config
    const chest = this.config.chestLocation;
    if (chest) {
      const block = this.bot.blockAt(new Vec3(chest.x, chest.y, chest.z));
      if (block && (block.name === 'chest' || block.name === 'trapped_chest')) {
        log.info(`Using chest from config: ${block.position}`);
        return block;
      }
      log.warn(`No chest at config coordinates (${chest.x}, ${chest.y}, ${chest.z})`);
    }

    // 3. Find nearest chest
    const nearest = this.bot.findBlock({
      matching: (b: Block) => b.name === 'chest' || b.name === 'trapped_chest',
      maxDistance: 64,
    });
    if (nearest) {
      log.info(`Found nearest chest: ${nearest.position}`);
    }
    return nearest;
  }
}
