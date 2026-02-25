import 'dotenv/config';

export interface AppConfig {
  host: string;
  port: number;
  username: string;
  version: string;
  viewerPort: number;

  baseLocation: { x: number; y: number | null; z: number } | null;
  bedLocation: { x: number; y: number; z: number } | null;
  chestLocation: { x: number; y: number; z: number } | null;

  autoPausePingMs: number;
  lowHealthThreshold: number;
  healToThreshold: number;
  foodThreshold: number;
  creeperEvadeDistance: number;
  creeperDisconnectDistance: number;
}

function parseCoords(prefix: string): { x: number; y: number | null; z: number } | null {
  const x = process.env[`${prefix}_X`];
  const z = process.env[`${prefix}_Z`];
  if (!x || !z) return null;
  const y = process.env[`${prefix}_Y`];
  return { x: Number(x), y: y ? Number(y) : null, z: Number(z) };
}

function parseFullCoords(prefix: string): { x: number; y: number; z: number } | null {
  const x = process.env[`${prefix}_X`];
  const y = process.env[`${prefix}_Y`];
  const z = process.env[`${prefix}_Z`];
  if (!x || !y || !z) return null;
  return { x: Number(x), y: Number(y), z: Number(z) };
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.BOT_HOST || 'localhost',
    port: Number(process.env.BOT_PORT) || 25565,
    username: process.env.BOT_USERNAME || 'LyarisBot',
    version: process.env.MC_VERSION || '1.21.1',
    viewerPort: Number(process.env.VIEWER_PORT) || 3007,

    baseLocation: parseCoords('BASE'),
    bedLocation: parseFullCoords('BED'),
    chestLocation: parseFullCoords('CHEST'),

    autoPausePingMs: Number(process.env.AUTO_PAUSE_PING) || 1000,
    lowHealthThreshold: 6,
    healToThreshold: 18,
    foodThreshold: 18,
    creeperEvadeDistance: 5,
    creeperDisconnectDistance: 3,
  };
}
