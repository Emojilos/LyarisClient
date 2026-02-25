import type { Bot } from 'mineflayer';
import type { PlayerInfo } from '../types.js';

export class PlayerList {
  constructor(private bot: Bot) {}

  getPlayers(): PlayerInfo[] {
    return Object.values(this.bot.players)
      .filter(p => p.username)
      .map(p => ({
        name: p.username,
        ping: p.ping ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getCount(): number {
    return Object.keys(this.bot.players).length;
  }

  isPlayerOnline(username: string): boolean {
    return username in this.bot.players;
  }
}
