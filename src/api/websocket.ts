import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { BotEventBus } from '../core/event-bus.js';
import type { MiningEngine } from '../mining/mining-engine.js';
import type { PingMonitor } from '../network/ping-monitor.js';
import type { Statistics } from '../features/statistics.js';
import type { PlayerList } from '../features/player-list.js';
import type { ChatMonitor } from '../features/chat-monitor.js';
import type { InventoryManager } from '../inventory/inventory-manager.js';
import { getLogHistory } from '../core/logger.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('WS');

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(
    server: Server,
    private eventBus: BotEventBus,
    private miningEngine: MiningEngine,
    private pingMonitor: PingMonitor,
    private statistics: Statistics,
    private playerList: PlayerList,
    private chatMonitor: ChatMonitor,
    private inventoryManager: InventoryManager,
  ) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      log.debug(`Client connected (${this.clients.size} total)`);

      // Send initial state snapshot
      this.send(ws, {
        type: 'init',
        data: {
          state: this.miningEngine.getState(),
          ping: this.pingMonitor.getData(),
          stats: this.statistics.getStats(),
          players: this.playerList.getPlayers(),
          chat: this.chatMonitor.getHistory().slice(-50),
          inventory: this.inventoryManager.getHotbar(),
          logs: getLogHistory().slice(-100),
        },
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log.debug(`Client disconnected (${this.clients.size} total)`);
      });
    });

    this.subscribeToEvents();
    this.startPeriodicUpdates();
  }

  private subscribeToEvents(): void {
    this.eventBus.on('mining:progress', (mined, total) => {
      this.broadcast({ type: 'mining:progress', data: { mined, total } });
    });

    this.eventBus.on('mining:started', () => {
      this.broadcastState();
    });

    this.eventBus.on('mining:paused', (reason) => {
      this.broadcast({ type: 'mining:paused', data: { reason } });
      this.broadcastState();
    });

    this.eventBus.on('mining:resumed', () => {
      this.broadcastState();
    });

    this.eventBus.on('mining:finished', () => {
      this.broadcastState();
    });

    this.eventBus.on('mining:error', (error) => {
      this.broadcast({ type: 'mining:error', data: { error } });
      this.broadcastState();
    });

    this.eventBus.on('ping:update', (data) => {
      this.broadcast({ type: 'ping', data });
    });

    this.eventBus.on('bot:health-changed', (health, food) => {
      this.broadcast({ type: 'health', data: { health, food } });
    });

    this.eventBus.on('chat:message', (username, message) => {
      this.broadcast({ type: 'chat', data: { username, message, timestamp: Date.now(), isSystem: false } });
    });

    this.eventBus.on('chat:system', (message) => {
      this.broadcast({ type: 'chat', data: { username: 'SYSTEM', message, timestamp: Date.now(), isSystem: true } });
    });

    this.eventBus.on('safety:stuck', (level, reason) => {
      this.broadcast({ type: 'safety:stuck', data: { level, reason } });
    });

    this.eventBus.on('log:entry', (entry) => {
      this.broadcast({ type: 'log', data: entry });
    });
  }

  private startPeriodicUpdates(): void {
    // Send full state + stats + inventory every 2 seconds
    setInterval(() => {
      if (this.clients.size === 0) return;

      this.broadcast({
        type: 'periodic',
        data: {
          state: this.miningEngine.getState(),
          stats: this.statistics.getStats(),
          players: this.playerList.getPlayers(),
          inventory: this.inventoryManager.getHotbar(),
        },
      });
    }, 2000);
  }

  private broadcastState(): void {
    this.broadcast({ type: 'state', data: this.miningEngine.getState() });
  }

  private broadcast(msg: object): void {
    if (this.clients.size === 0) return;
    const json = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
