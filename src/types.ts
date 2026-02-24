import type { Vec3 } from 'vec3';

export interface Area {
  corner1: Vec3;
  corner2: Vec3;
}

export interface NormalizedArea {
  min: Vec3;
  max: Vec3;
}

export type MiningStatus = 'idle' | 'mining' | 'paused' | 'finished' | 'error' | 'traveling';

export interface MiningState {
  status: MiningStatus;
  area: NormalizedArea | null;
  totalBlocks: number;
  minedBlocks: number;
  currentTool: string | null;
  botPosition: { x: number; y: number; z: number } | null;
  error: string | null;
}

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version: string;
  viewerPort: number;
}
