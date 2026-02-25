import type { Vec3 } from 'vec3';

// ─── Mining ───

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
  health: number;
  food: number;
  ping: number;
  tps: number;
}

// ─── Network ───

export interface PingData {
  ping: number;
  tps: number;
  quality: 'good' | 'moderate' | 'poor' | 'critical';
}

// ─── Statistics ───

export interface MiningStats {
  sessionDuration: number;
  totalBlocksMined: number;
  blocksPerMinute: number;
  estimatedTimeRemaining: number | null;
}

// ─── Chat ───

export interface ChatMessage {
  timestamp: number;
  username: string;
  message: string;
  isSystem: boolean;
}

// ─── Player ───

export interface PlayerInfo {
  name: string;
  ping: number;
}

// ─── Inventory ───

export interface SlotInfo {
  name: string;
  displayName: string;
  count: number;
}

// ─── State file (persisted) ───

export interface SavedMiningState {
  area: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  minedBlocks: number;
}
