import type { BotEventBus } from './event-bus.js';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

const LEVEL_STYLES: Record<LogLevel, { color: string; label: string }> = {
  info:    { color: COLORS.blue,   label: 'INFO' },
  warn:    { color: COLORS.yellow, label: 'WARN' },
  error:   { color: COLORS.red,    label: 'ERROR' },
  debug:   { color: COLORS.gray,   label: 'DEBUG' },
  success: { color: COLORS.green,  label: 'OK' },
};

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  module: string;
  message: string;
}

const logHistory: LogEntry[] = [];
const MAX_HISTORY = 500;

let eventBus: BotEventBus | null = null;

export function setLogEventBus(bus: BotEventBus): void {
  eventBus = bus;
}

function formatTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function log(level: LogLevel, module: string, message: string): void {
  const style = LEVEL_STYLES[level];
  const time = formatTime();

  const formatted = `${COLORS.gray}${time}${COLORS.reset} ${style.color}${COLORS.bold}[${style.label}]${COLORS.reset} ${COLORS.cyan}${module}${COLORS.reset} ${message}`;

  if (level === 'error') console.error(formatted);
  else if (level === 'warn') console.warn(formatted);
  else console.log(formatted);

  const entry: LogEntry = { timestamp: Date.now(), level, module, message };
  logHistory.push(entry);
  if (logHistory.length > MAX_HISTORY) logHistory.shift();

  if (eventBus) {
    eventBus.emit('log:entry', entry);
  }
}

export function createLogger(module: string) {
  return {
    info:    (msg: string) => log('info', module, msg),
    warn:    (msg: string) => log('warn', module, msg),
    error:   (msg: string) => log('error', module, msg),
    debug:   (msg: string) => log('debug', module, msg),
    success: (msg: string) => log('success', module, msg),
  };
}

export function getLogHistory(): LogEntry[] {
  return [...logHistory];
}
