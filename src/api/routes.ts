import type { Express } from 'express';
import { Vec3 } from 'vec3';
import type { MiningEngine } from '../mining/mining-engine.js';
import type { PingMonitor } from '../network/ping-monitor.js';
import type { Statistics } from '../features/statistics.js';
import type { PlayerList } from '../features/player-list.js';
import type { ChatMonitor } from '../features/chat-monitor.js';
import type { InventoryManager } from '../inventory/inventory-manager.js';
import { getLogHistory } from '../core/logger.js';

export function setupRoutes(
  app: Express,
  miningEngine: MiningEngine,
  pingMonitor: PingMonitor,
  statistics: Statistics,
  playerList: PlayerList,
  chatMonitor: ChatMonitor,
  inventoryManager: InventoryManager,
): void {

  // ─── Mining ───

  app.get('/api/status', (_req, res) => {
    res.json(miningEngine.getState());
  });

  app.post('/api/start', (req, res) => {
    const { x1, y1, z1, x2, y2, z2 } = req.body;

    if ([x1, y1, z1, x2, y2, z2].some(v => v === undefined || v === null)) {
      return res.status(400).json({ error: 'All coordinates required (x1,y1,z1,x2,y2,z2)' });
    }

    const area = {
      corner1: new Vec3(Number(x1), Number(y1), Number(z1)),
      corner2: new Vec3(Number(x2), Number(y2), Number(z2)),
    };

    miningEngine.start(area).catch(() => {});
    res.json({ ok: true, message: 'Mining started' });
  });

  app.post('/api/pause', (_req, res) => {
    miningEngine.pause();
    res.json({ ok: true, message: 'Mining paused' });
  });

  app.post('/api/resume', (_req, res) => {
    miningEngine.resume();
    res.json({ ok: true, message: 'Mining resumed' });
  });

  app.post('/api/stop', (_req, res) => {
    miningEngine.stop();
    res.json({ ok: true, message: 'Mining stopped' });
  });

  // ─── Navigation ───

  app.post('/api/goto-base', (_req, res) => {
    miningEngine.goToBase().catch(() => {});
    res.json({ ok: true, message: 'Navigating to base' });
  });

  // ─── Info ───

  app.get('/api/ping', (_req, res) => {
    res.json(pingMonitor.getData());
  });

  app.get('/api/stats', (_req, res) => {
    res.json(statistics.getStats());
  });

  app.get('/api/players', (_req, res) => {
    res.json(playerList.getPlayers());
  });

  app.get('/api/chat', (_req, res) => {
    res.json(chatMonitor.getHistory().slice(-50));
  });

  app.get('/api/inventory', (_req, res) => {
    res.json(inventoryManager.getHotbar());
  });

  app.get('/api/logs', (_req, res) => {
    res.json(getLogHistory().slice(-200));
  });

  // ─── Chat send ───

  app.post('/api/chat', (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message required' });
    }
    chatMonitor.sendMessage(message);
    res.json({ ok: true });
  });
}
