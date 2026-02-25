import { loadConfig } from './core/config.js';
import { BotEventBus } from './core/event-bus.js';
import { createLogger, setLogEventBus } from './core/logger.js';
import { createBot } from './core/bot.js';

import { PingMonitor } from './network/ping-monitor.js';
import { AdaptiveTimings } from './network/adaptive-timings.js';
import { PositionConfirmer } from './network/position-confirmer.js';

import { MiningEngine } from './mining/mining-engine.js';
import { Navigator } from './mining/navigator.js';
import { StateManager } from './mining/state-manager.js';

import { ToolSelector } from './inventory/tool-selector.js';
import { InventoryManager } from './inventory/inventory-manager.js';
import { FoodManager } from './inventory/food-manager.js';

import { AntiStuck } from './safety/anti-stuck.js';
import { CreeperGuard } from './safety/creeper-guard.js';
import { HealthMonitor } from './safety/health-monitor.js';

import { ChatMonitor } from './features/chat-monitor.js';
import { PlayerList } from './features/player-list.js';
import { Statistics } from './features/statistics.js';
import { AutoReconnect } from './features/auto-reconnect.js';

import { setupServer } from './api/server.js';

// ─── Init ───

const log = createLogger('Main');
const config = loadConfig();
const eventBus = new BotEventBus();

setLogEventBus(eventBus);

log.info(`Connecting to ${config.host}:${config.port} as ${config.username}...`);

const bot = createBot(config);

// ─── Network Layer ───

const pingMonitor = new PingMonitor(bot, eventBus);
const timings = new AdaptiveTimings(pingMonitor);
const posConfirmer = new PositionConfirmer(bot, pingMonitor);

// ─── Mining Layer ───

const navigator = new Navigator(bot, timings);
const stateManager = new StateManager();
const toolSelector = new ToolSelector(bot);
const inventoryManager = new InventoryManager(bot, eventBus, config);
const foodManager = new FoodManager(bot, eventBus);
const antiStuck = new AntiStuck(bot, timings, eventBus);
navigator.setAntiStuck(antiStuck);

const miningEngine = new MiningEngine({
  bot,
  eventBus,
  navigator,
  stateManager,
  toolSelector,
  inventoryManager,
  foodManager,
  antiStuck,
  timings,
  posConfirmer,
  pingMonitor,
  config,
});

// ─── Safety Layer ───

const creeperGuard = new CreeperGuard(bot, eventBus, config);
const healthMonitor = new HealthMonitor(bot, eventBus, config, foodManager);

// ─── Features ───

const chatMonitor = new ChatMonitor(bot, eventBus);
const playerList = new PlayerList(bot);
const statistics = new Statistics(eventBus);

const autoReconnect = new AutoReconnect(eventBus, () => {
  log.info('Auto-reconnect: restarting process...');
  process.exit(1); // launcher.js will restart
});

// ─── API Server ───

setupServer({
  eventBus,
  config,
  miningEngine,
  pingMonitor,
  statistics,
  playerList,
  chatMonitor,
  inventoryManager,
});

// ─── Boot Sequence ───

bot.once('spawn', () => {
  log.success('Bot spawned! Initializing systems...');

  pingMonitor.start();
  creeperGuard.enable();
  healthMonitor.enable();
  chatMonitor.enable();
  autoReconnect.enable();

  eventBus.emit('bot:spawned');

  // Wait for world to load before resuming mining
  setTimeout(async () => {
    autoReconnect.resetAttempts();
    await miningEngine.resumeIfNeeded();
  }, 5000);
});

let sleepDisconnectPending = false;

const handleSleepDisconnect = (who: string) => {
  if (sleepDisconnectPending) return;
  sleepDisconnectPending = true;
  log.warn(`${who} went to sleep — disconnecting for 10s`);
  miningEngine.pause();
  autoReconnect.setNextDelay(10_000);
  bot.quit();
};

// Detect sleep via entity metadata (works only in loaded chunks)
bot.on('entitySleep', (entity) => {
  if (entity.type !== 'player') return;
  if (entity.username === bot.username) return;
  handleSleepDisconnect(entity.username ?? 'Player');
});

// Detect sleep via chat messages (works regardless of distance)
// Vanilla Minecraft sends: "chat.sleep" translation key → "<player> fell asleep"
// Also catches common sleep plugin messages
bot.on('message', (jsonMsg, position) => {
  if (sleepDisconnectPending) return;
  // Only check system/game info messages, not player chat
  if (position === 'chat') return;

  const json = jsonMsg.json as any;

  // Vanilla: translation key "chat.type.sleep" or similar
  if (json?.translate?.includes('sleep')) {
    const who = json.with?.[0]?.text ?? json.with?.[0] ?? 'Player';
    if (who !== bot.username) {
      handleSleepDisconnect(String(who));
      return;
    }
  }

  // Fallback: check plaintext for common sleep patterns
  const text = jsonMsg.toString();
  if (!text) return;

  const sleepPatterns = [
    /^(\S+)\s+fell asleep/i,
    /^(\S+)\s+is now sleeping/i,
    /^(\S+)\s+лёг спать/i,
    /^(\S+)\s+лег спать/i,
    /^(\S+)\s+заснул/i,
  ];

  for (const pattern of sleepPatterns) {
    const match = text.match(pattern);
    if (match && match[1] !== bot.username) {
      handleSleepDisconnect(match[1]);
      return;
    }
  }
});

bot.on('end', (reason) => {
  sleepDisconnectPending = false;
  pingMonitor.stop();
  creeperGuard.disable();
  healthMonitor.disable();
  eventBus.emit('bot:disconnected', reason || 'unknown');
});
