import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';

const SKIP_BLOCKS = new Set([
  'air', 'cave_air', 'void_air',
  'water', 'lava',
  'flowing_water', 'flowing_lava',
  'bedrock',
  'snow',
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
  'oak_leaves', 'oak_log',
  'chest', 'trapped_chest', 'crafting_table',
  'white_bed', 'red_bed', 'blue_bed', 'green_bed', 'yellow_bed',
  'black_bed', 'brown_bed', 'cyan_bed', 'gray_bed', 'light_blue_bed',
  'light_gray_bed', 'lime_bed', 'magenta_bed', 'orange_bed', 'pink_bed',
  'purple_bed', 'smithing_table', 'furnace', 
]);

export class ToolSelector {
  constructor(private bot: Bot) {}

  /**
   * Check if a block should be mined (not air, water, bedrock, etc.)
   */
  shouldMine(block: Block): boolean {
    return !SKIP_BLOCKS.has(block.name);
  }

  /**
   * Equip the best tool for mining a block.
   * Returns the name of the equipped tool.
   */
  async equipFor(block: Block): Promise<string> {
    try {
      await (this.bot as any).tool.equipForBlock(block, { requireHarvest: false });
    } catch {
      // Fall back to hand
    }

    const held = this.bot.heldItem;
    return held ? held.displayName : 'Hand';
  }
}
