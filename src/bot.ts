import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as toolPlugin } from 'mineflayer-tool';
import type { BotConfig } from './types.js';

export function createBot(config: BotConfig): mineflayer.Bot {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version, // Убедитесь, что тут 1.21.1
  }); 

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(toolPlugin);

  let lastHealth = 20;

  bot.on('spawn', () => {
    console.log(`[Bot] Заспавнился. Здоровье: ${bot.health}/20`);
    lastHealth = bot.health;
  });

  // Основной цикл проверки безопасности
  bot.on('physicTick', () => {
    if (!bot.entity) return;

    // Ищем ЛЮБОГО крипера в радиусе 10 блоков для теста
    const nearCreeper = bot.nearestEntity((e) => e.name?.toLowerCase() === 'creeper');
    
    if (nearCreeper) {
      const dist = bot.entity.position.distanceTo(nearCreeper.position);
      
      // Лог для отладки — вы увидите это в консоли, если бот заметил крипера
      if (dist < 10) {
        console.log(`[Radar] Вижу крипера! Расстояние: ${dist.toFixed(1)}м`);
      }

      // Если подошел критически близко
      if (dist < 5) {
        console.log(`[Bot] 🚨 ЭКСТРЕННЫЙ ВЫХОД! Крипер в упор (${dist.toFixed(1)}м)`);
        process.exit(1); // Жесткий выход для лаунчера
      }
    }

    // Защита по здоровью
    const isTakingDamage = bot.health < lastHealth;
    if (bot.health < 6 && isTakingDamage) {
      console.log(`[Bot] 🚨 ПОЛУЧАЮ УРОН ПРИ НИЗКОМ ХП! Выхожу.`);
      process.exit(1);
    }
    lastHealth = bot.health;
  });

  // Слух: если крипер начал шипеть (даже если мы его не видим через блоки)
  bot.on('soundEffect', (sound, position) => {
    if (!bot.entity) return;
    if (sound.name?.includes('creeper.primed')) {
      const dist = bot.entity.position.distanceTo(position);
      if (dist < 7) {
        console.log(`[Bot] 🚨 УСЛЫШАЛ ШИПЕНИЕ (${dist.toFixed(1)}м)! Выхожу.`);
        process.exit(1);
      }
    }
  });

  bot.on('end', (reason) => {
    console.log(`[Bot] Соединение разорвано: ${reason}.`);
    // Просто завершаем процесс. Лаунчер сам отсчитает 10 секунд.
    process.exit(1);
  });

  return bot;
}