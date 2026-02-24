import 'dotenv/config';
import { createBot } from './bot.js';
import { Miner } from './miner.js';
import { setupViewer } from './viewer.js';
import type { BotConfig } from './types.js';

const config: BotConfig = {
  host: process.env.BOT_HOST || 'localhost',
  port: Number(process.env.BOT_PORT) || 25565,
  username: process.env.BOT_USERNAME || 'LyarisBot',
  version: process.env.MC_VERSION || '1.21.1',
  viewerPort: Number(process.env.VIEWER_PORT) || 3007,
};

console.log(`[Lyaris] Connecting to ${config.host}:${config.port} as ${config.username}...`);

const bot = createBot(config);
const miner = new Miner(bot);

setupViewer(bot, miner, config.viewerPort);

// --- ДОБАВЛЕНО: Авто-возобновление при входе ---
bot.once('spawn', async () => {
  // Небольшая задержка, чтобы мир успел прогрузиться вокруг бота
  setTimeout(async () => {
    await miner.resumeIfNeeded();
  }, 3000);
});
// -----------------------------------------------