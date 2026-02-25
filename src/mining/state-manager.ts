import fs from 'fs';
import type { NormalizedArea, SavedMiningState } from '../types.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('State');
const STATE_FILE = 'mining_state.json';

export class StateManager {
  save(area: NormalizedArea, minedBlocks: number): void {
    const data: SavedMiningState = {
      area: {
        min: { x: area.min.x, y: area.min.y, z: area.min.z },
        max: { x: area.max.x, y: area.max.y, z: area.max.z },
      },
      minedBlocks,
    };
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(data));
    } catch (err: any) {
      log.error(`Failed to save state: ${err.message}`);
    }
  }

  load(): SavedMiningState | null {
    try {
      if (!fs.existsSync(STATE_FILE)) return null;
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw) as SavedMiningState;
    } catch (err: any) {
      log.error(`Failed to load state: ${err.message}`);
      return null;
    }
  }

  clear(): void {
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } catch {}
  }

  hasState(): boolean {
    return fs.existsSync(STATE_FILE);
  }
}
