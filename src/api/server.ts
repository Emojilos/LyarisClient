import express from 'express';
import http from 'http';
import path from 'path';
import type { BotEventBus } from '../core/event-bus.js';
import type { AppConfig } from '../core/config.js';
import type { MiningEngine } from '../mining/mining-engine.js';
import type { PingMonitor } from '../network/ping-monitor.js';
import type { Statistics } from '../features/statistics.js';
import type { PlayerList } from '../features/player-list.js';
import type { ChatMonitor } from '../features/chat-monitor.js';
import type { InventoryManager } from '../inventory/inventory-manager.js';
import { setupRoutes } from './routes.js';
import { WebSocketManager } from './websocket.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Server');

export function setupServer(deps: {
  eventBus: BotEventBus;
  config: AppConfig;
  miningEngine: MiningEngine;
  pingMonitor: PingMonitor;
  statistics: Statistics;
  playerList: PlayerList;
  chatMonitor: ChatMonitor;
  inventoryManager: InventoryManager;
}): void {
  const app = express();
  app.use(express.json());

  // Serve static files
  app.use(express.static(path.join(process.cwd(), 'public')));

  // REST API routes
  setupRoutes(
    app,
    deps.miningEngine,
    deps.pingMonitor,
    deps.statistics,
    deps.playerList,
    deps.chatMonitor,
    deps.inventoryManager,
  );

  // Create HTTP server for both Express and WebSocket
  const server = http.createServer(app);

  // WebSocket
  new WebSocketManager(
    server,
    deps.eventBus,
    deps.miningEngine,
    deps.pingMonitor,
    deps.statistics,
    deps.playerList,
    deps.chatMonitor,
    deps.inventoryManager,
  );

  server.listen(deps.config.viewerPort, () => {
    log.success(`Control panel at http://localhost:${deps.config.viewerPort}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${deps.config.viewerPort} is already in use. Kill the old process or change VIEWER_PORT in .env`);
      process.exit(1);
    }
    throw err;
  });
}
