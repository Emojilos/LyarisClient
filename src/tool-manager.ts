import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import type { NormalizedArea } from './types.js'; // Добавленный импорт

const { GoalNear } = goals;

const SKIP_BLOCKS = new Set([
  'air', 'cave_air', 'void_air',
  'water', 'lava',
  'flowing_water', 'flowing_lava',
  'bedrock',
  'snow', // Тонкий слой снега
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'oak_leaves', 'oak_log', 'chest', 'crafting_table', 'white_bed' // Трава и кусты
]);

export function shouldMine(block: Block): boolean {
  return !SKIP_BLOCKS.has(block.name);
}

export async function equipBestTool(bot: Bot, block: Block): Promise<string> {
  try {
    // mineflayer-tool автоматически выбирает лучший инструмент
    await (bot as any).tool.equipForBlock(block, { requireHarvest: false });
  } catch {
    // Если не удалось экипировать — копаем руками
  }

  const held = bot.heldItem;
  return held ? held.displayName : 'Hand';
}

export function isInventoryFull(bot: Bot): boolean {
  const emptySlots = bot.inventory.slots.filter(
    (slot, i) => i >= 9 && i < 45 && slot === null
  );
  return emptySlots.length === 0;
}


// Что оставлять в инвентаре при сдаче в сундук
function shouldKeepItem(name: string): boolean {
  const toolSuffixes = ['_pickaxe', '_axe', '_shovel', '_sword', '_hoe'];
  if (toolSuffixes.some(s => name.endsWith(s))) return true;
  if (FOOD_ITEMS.has(name)) return true;
  return false;
}

export async function depositToChest(bot: Bot, area?: NormalizedArea | null): Promise<boolean> {
  let chestBlock: Block | null = null;

  // 1. Ищем ближайший сундук прямо внутри выделенной области раскопок
  if (area) {
    chestBlock = bot.findBlock({
      matching: (b: Block) => {
        if (b.name !== 'chest' && b.name !== 'trapped_chest') return false;
        // Проверяем, находится ли блок в пределах координат области
        return b.position.x >= area.min.x && b.position.x <= area.max.x &&
               b.position.y >= area.min.y && b.position.y <= area.max.y &&
               b.position.z >= area.min.z && b.position.z <= area.max.z;
      },
      maxDistance: 128, // Радиус поиска увеличен, так как зона может быть большой
    });
    
    if (chestBlock) {
      console.log(`[ToolManager] Найден сундук в зоне раскопок: ${chestBlock.position}`);
    }
  }

  // 2. Если в рабочей зоне сундука нет, пробуем координаты из .env
  if (!chestBlock) {
    const cx = process.env.CHEST_X ? parseInt(process.env.CHEST_X) : null;
    const cy = process.env.CHEST_Y ? parseInt(process.env.CHEST_Y) : null;
    const cz = process.env.CHEST_Z ? parseInt(process.env.CHEST_Z) : null;

    if (cx !== null && cy !== null && cz !== null) {
      const block = bot.blockAt(new Vec3(cx, cy, cz));
      if (block && (block.name === 'chest' || block.name === 'trapped_chest')) {
        chestBlock = block;
        console.log(`[ToolManager] Использую сундук из .env: ${chestBlock.position}`);
      } else {
        console.log(`[ToolManager] По координатам из .env (${cx}, ${cy}, ${cz}) сундука нет.`);
      }
    }
  }

  // 3. Если ничего не помогло, ищем просто ближайший сундук вокруг бота
  if (!chestBlock) {
    chestBlock = bot.findBlock({
      matching: (b: Block) => b.name === 'chest' || b.name === 'trapped_chest',
      maxDistance: 64,
    });
    if (chestBlock) {
      console.log(`[ToolManager] Нашел ближайший сундук вне зоны: ${chestBlock.position}`);
    }
  }

  if (!chestBlock) {
    console.log('[ToolManager] Сундук не найден! Поставьте его в зону, рядом с ботом или укажите в .env');
    return false;
  }

  console.log(`[ToolManager] Иду к сундуку (${chestBlock.position})...`);

  try {
    await bot.pathfinder.goto(
      new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
    );
  } catch (err) {
    console.error('[ToolManager] Не удалось добраться до сундука:', err);
    return false;
  }

  let chest: any;
  try {
    chest = await (bot as any).openChest(chestBlock);
  } catch (err) {
    console.error('[ToolManager] Не удалось открыть сундук:', err);
    return false;
  }

  try {
    for (const item of bot.inventory.items()) {
      if (!shouldKeepItem(item.name)) {
        try {
          await chest.deposit(item.type, null, item.count);
        } catch {
          console.log('[ToolManager] Сундук переполнен, остановка сдачи');
          break;
        }
      }
    }
    console.log('[ToolManager] Предметы сложены в сундук');
  } finally {
    chest.close();
  }

  return !isInventoryFull(bot);
}

// Список еды, которую бот умеет кушать (можно дополнять)
const FOOD_ITEMS = new Set([
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'baked_potato', 'bread', 'golden_carrot', 'apple', 'carrot', 'melon_slice', 'sweet_berries'
]);

export async function eatFoodIfNeeded(bot: Bot): Promise<void> {
  // Максимальная сытость в Майнкрафте = 20. Если больше 17, бот будет регенить ХП, так что кушать не нужно.
  if (bot.food >= 18) return;

  const items = bot.inventory.items();
  const food = items.find(item => FOOD_ITEMS.has(item.name));

  if (!food) {
    // Еды нет, но бот голоден. Просто выведем в консоль, чтобы вы знали.
    console.log('[Miner] Bot is hungry, but no food in inventory!');
    return;
  }

  console.log(`[Miner] Eating ${food.name}...`);
  try {
    // Берем еду в основную руку и кушаем
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log('[Miner] Finished eating.');
  } catch (err) {
    console.error('[Miner] Failed to eat:', err);
  }
}