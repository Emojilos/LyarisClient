import type { Bot } from 'mineflayer';
import express from 'express';
import { Vec3 } from 'vec3';
import type { Miner } from './miner.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Костыль для ES-модулей, если __dirname не работает
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setupViewer(bot: Bot, miner: Miner, port: number) {
  const app = express();
  app.use(express.json());
  
  // Раздаем статику (твой index.html)
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // --- API ---

  app.get('/api/status', (_req, res) => {
    res.json(miner.getState());
  });

  app.post('/api/start', (req, res) => {
    const { x1, y1, z1, x2, y2, z2 } = req.body;

    if ([x1, y1, z1, x2, y2, z2].some((v) => v === undefined || v === null)) {
      return res.status(400).json({ error: 'All coordinates required (x1,y1,z1,x2,y2,z2)' });
    }

    const area = {
      corner1: new Vec3(Number(x1), Number(y1), Number(z1)),
      corner2: new Vec3(Number(x2), Number(y2), Number(z2)),
    };

    miner.start(area).catch((err) => {
      console.error('[API] Mining error:', err.message);
    });

    res.json({ ok: true, message: 'Mining started' });
  });

  app.post('/api/pause', (_req, res) => {
    miner.pause();
    res.json({ ok: true, message: 'Mining paused' });
  });

  app.post('/api/resume', (_req, res) => {
    miner.resume();
    res.json({ ok: true, message: 'Mining resumed' });
  });

  app.post('/api/stop', (_req, res) => {
    miner.stop();
    res.json({ ok: true, message: 'Mining stopped' });
  });

  app.post('/api/goto-base', (_req, res) => {
    const x = process.env.BASE_X !== undefined ? Number(process.env.BASE_X) : null;
    const y = process.env.BASE_Y !== undefined ? Number(process.env.BASE_Y) : null;
    const z = process.env.BASE_Z !== undefined ? Number(process.env.BASE_Z) : null;

    if (x === null || z === null) {
      return res.status(400).json({ error: 'BASE_X и BASE_Z не заданы в .env' });
    }

    miner.goToBase(x, y, z).catch((err) => {
      console.error('[API] goToBase error:', err.message);
    });

    res.json({ ok: true, message: 'Навигация на базу запущена' });
  });

  // НОВЫЙ ЭНДПОИНТ ДЛЯ СНА
  app.post('/api/sleep', (_req, res) => {
    const x = process.env.BED_X !== undefined ? Number(process.env.BED_X) : null;
    const y = process.env.BED_Y !== undefined ? Number(process.env.BED_Y) : null;
    const z = process.env.BED_Z !== undefined ? Number(process.env.BED_Z) : null;

    if (x === null || y === null || z === null) {
      return res.status(400).json({ error: 'BED_X, BED_Y и BED_Z не заданы в .env' });
    }

    miner.goToBedAndSleep(x, y, z).catch((err) => {
      console.error('[API] goToBedAndSleep error:', err.message);
    });

    res.json({ ok: true, message: 'Бот пошел спать' });
  });

  app.post('/api/preview', (req, res) => {
    const { x1, y1, z1, x2, y2, z2 } = req.body;
    if ([x1, y1, z1, x2, y2, z2].some((v) => v === undefined || v === null)) {
      return res.status(400).json({ error: 'Missing coordinates' });
    }
    miner.previewArea({
      corner1: new Vec3(Number(x1), Number(y1), Number(z1)),
      corner2: new Vec3(Number(x2), Number(y2), Number(z2)),
    });
    res.json({ ok: true });
  });

  app.post('/api/preview/clear', (_req, res) => {
    miner.clearPreview();
    res.json({ ok: true });
  });

  app.get('/api/inventory', (_req, res) => {
    const slots = [];
    for (let i = 36; i <= 44; i++) {
      const item = bot.inventory.slots[i];
      slots.push(item ? { name: item.name, displayName: item.displayName, count: item.count } : null);
    }
    res.json({ slots, activeSlot: bot.quickBarSlot });
  });

  const server = app.listen(port, () => {
    console.log(`[Viewer] Control panel at http://localhost:${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Viewer] Port ${port} is already in use. Kill the old process or change VIEWER_PORT in .env`);
      process.exit(1);
    }
    throw err;
  });
}