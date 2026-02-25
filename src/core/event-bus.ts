import { EventEmitter } from 'events';
import type { Vec3 } from 'vec3';
import type { NormalizedArea, MiningStats, PingData } from '../types.js';

export interface BotEvents {
  // Network
  'ping:update': [data: PingData];
  'ping:high': [ping: number];
  'ping:critical': [ping: number];

  // Mining
  'mining:started': [area: NormalizedArea];
  'mining:progress': [mined: number, total: number];
  'mining:paused': [reason: string];
  'mining:resumed': [];
  'mining:finished': [];
  'mining:error': [error: string];
  'mining:block-mined': [pos: Vec3, blockName: string];

  // Safety
  'safety:creeper-nearby': [distance: number];
  'safety:taking-damage': [health: number];
  'safety:stuck': [level: number, reason: string];
  'safety:unstuck': [];

  // Inventory
  'inventory:full': [];
  'inventory:deposited': [];
  'inventory:hungry': [];
  'inventory:eating': [food: string];

  // Bot state
  'bot:spawned': [];
  'bot:health-changed': [health: number, food: number];
  'bot:position-changed': [pos: { x: number; y: number; z: number }];
  'bot:disconnected': [reason: string];

  // Chat
  'chat:message': [username: string, message: string];
  'chat:system': [message: string];

  // Statistics
  'stats:update': [stats: MiningStats];

  // Log
  'log:entry': [entry: { timestamp: number; level: string; module: string; message: string }];
}

export class BotEventBus extends EventEmitter {
  override emit<K extends keyof BotEvents>(event: K, ...args: BotEvents[K]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override off<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this;
  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  override once<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this;
  override once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }
}
