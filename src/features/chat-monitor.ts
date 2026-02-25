import type { Bot } from 'mineflayer';
import type { BotEventBus } from '../core/event-bus.js';
import type { ChatMessage } from '../types.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Chat');
const MAX_HISTORY = 100;

export class ChatMonitor {
  private history: ChatMessage[] = [];

  constructor(
    private bot: Bot,
    private eventBus: BotEventBus,
  ) {}

  enable(): void {
    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;

      const entry: ChatMessage = {
        timestamp: Date.now(),
        username,
        message,
        isSystem: false,
      };

      this.history.push(entry);
      if (this.history.length > MAX_HISTORY) this.history.shift();

      this.eventBus.emit('chat:message', username, message);
      log.debug(`<${username}> ${message}`);
    });

    this.bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      if (!text || text.trim().length === 0) return;

      const entry: ChatMessage = {
        timestamp: Date.now(),
        username: 'SYSTEM',
        message: text,
        isSystem: true,
      };

      this.history.push(entry);
      if (this.history.length > MAX_HISTORY) this.history.shift();

      this.eventBus.emit('chat:system', text);
    });

    log.info('Chat monitoring enabled');
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  sendMessage(message: string): void {
    this.bot.chat(message);
  }
}
