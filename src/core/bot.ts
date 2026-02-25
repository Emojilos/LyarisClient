import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as toolPlugin } from 'mineflayer-tool';
import type { AppConfig } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('Bot');

export function createBot(config: AppConfig): mineflayer.Bot {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(toolPlugin);

  bot.on('spawn', () => {
    log.success(`Spawned. Health: ${bot.health}/20`);
  });

  bot.on('end', (reason) => {
    log.warn(`Disconnected: ${reason}`);
  });

  bot.on('error', (err) => {
    log.error(`Connection error: ${err.message}`);
  });

  return bot;
}
