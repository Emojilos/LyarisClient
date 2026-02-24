import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals, Movements } from 'mineflayer-pathfinder';
import type { Area, NormalizedArea, MiningState } from './types.js';
import { equipBestTool, shouldMine, isInventoryFull, depositToChest, eatFoodIfNeeded } from './tool-manager.js';
import fs from 'fs';

const { GoalNear, GoalXZ } = goals;
const REACH_DISTANCE = 4.5;
const STATE_FILE = 'mining_state.json';

export class Miner {
  private bot: Bot;
  private state: MiningState;

  constructor(bot: Bot) {
    this.bot = bot;
    this.state = {
      status: 'idle',
      area: null,
      totalBlocks: 0,
      minedBlocks: 0,
      currentTool: null,
      botPosition: null,
      error: null,
    };
  }

  private saveProgress() {
    if (this.state.status === 'mining' || this.state.status === 'paused') {
      const data = {
        area: this.state.area,
        minedBlocks: this.state.minedBlocks
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(data));
    }
  }

  private clearSavedProgress() {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  }

  public async resumeIfNeeded() {
    if (fs.existsSync(STATE_FILE)) {
      console.log('[Miner] Найден старый прогресс. Возобновляю...');
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      
      const areaToResume: Area = {
        corner1: new Vec3(data.area.min.x, data.area.min.y, data.area.min.z),
        corner2: new Vec3(data.area.max.x, data.area.max.y, data.area.max.z)
      };

      await this.start(areaToResume, data.minedBlocks);
    }
  }

  getState(): MiningState {
    const pos = this.bot.entity?.position;
    return {
      ...this.state,
      botPosition: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
    };
  }

  private normalizeArea(area: Area): NormalizedArea {
    return {
      min: new Vec3(
        Math.min(area.corner1.x, area.corner2.x),
        Math.min(area.corner1.y, area.corner2.y),
        Math.min(area.corner1.z, area.corner2.z),
      ),
      max: new Vec3(
        Math.max(area.corner1.x, area.corner2.x),
        Math.max(area.corner1.y, area.corner2.y),
        Math.max(area.corner1.z, area.corner2.z),
      ),
    };
  }

  private generateZigzagPositions(area: NormalizedArea): Vec3[] {
    const positions: Vec3[] = [];
    for (let y = area.max.y; y >= area.min.y; y--) {
      let reverseX = false;
      for (let z = area.min.z; z <= area.max.z; z++) {
        if (reverseX) {
          for (let x = area.max.x; x >= area.min.x; x--) {
            positions.push(new Vec3(x, y, z));
          }
        } else {
          for (let x = area.min.x; x <= area.max.x; x++) {
            positions.push(new Vec3(x, y, z));
          }
        }
        reverseX = !reverseX;
      }
    }
    return positions;
  }

  private async clearSuffocation(): Promise<void> {
    const pos = this.bot.entity.position.floored();
    for (const dy of [0, 1, 2]) {
      const b = this.bot.blockAt(pos.offset(0, dy, 0));
      if (b && b.boundingBox === 'block' && b.name !== 'bedrock' && shouldMine(b)) {
        try {
          await equipBestTool(this.bot, b);
          await this.bot.dig(b);
        } catch (e) {}
      }
    }
  }

  async start(area: Area, startIndex = 0): Promise<void> {
    if (this.state.status === 'mining' && startIndex === 0) throw new Error('Already mining');

    const normalized = this.normalizeArea(area);
    this.state = {
      ...this.state,
      status: 'mining',
      area: normalized,
      minedBlocks: startIndex,
      error: null,
    };

    const movements = new Movements(this.bot, this.bot.registry);
    movements.canDig = true; // В шахте копать можно
    movements.allowSprinting = false; 
    this.bot.pathfinder.setMovements(movements);

    try {
      await this.mineArea(normalized, startIndex);
      if (this.state.status === 'mining') {
        this.state.status = 'finished';
        this.clearSavedProgress(); 
      }
    } catch (err: any) {
      if (this.state.status !== 'idle') {
        this.state.status = 'error';
        this.state.error = err.message;
      }
    }
  }

  private async mineArea(area: NormalizedArea, startIndex: number): Promise<void> {
    const positions = this.generateZigzagPositions(area);
    this.state.totalBlocks = positions.length;

    for (let i = startIndex; i < positions.length; i++) {
      if (this.state.status === 'idle') return;

      if (i % 50 === 0) {
        this.saveProgress();
        await this.sleep(10);
      }

      if (this.bot.health < 14) {
        const oldStatus = this.state.status;
        this.state.status = 'paused';
        this.state.error = 'Healing...';
        while (this.bot.health < 18) {
          await eatFoodIfNeeded(this.bot);
          await this.sleep(2000);
          if (this.state.status === 'idle') return;
        }
        this.state.status = oldStatus === 'paused' ? 'paused' : 'mining';
        this.state.error = null;
      }

      while (this.state.status === 'paused') {
        await this.sleep(500);
        if (this.state.status === 'idle') return;
      }

      await eatFoodIfNeeded(this.bot);
      
      const pos = positions[i];
      let attempts = 0;
      let success = false;

      while (attempts < 3 && !success) {
        if (this.state.status === 'idle') return;

        await this.clearSuffocation();

        const block = this.bot.blockAt(pos);
        if (!block || !shouldMine(block)) {
          success = true;
          break;
        }

        if (isInventoryFull(this.bot)) {
          this.state.error = 'Несу вещи в сундук...';
          const freed = await depositToChest(this.bot, this.state.area); 
          this.state.error = null;
          if (!freed) {
            this.state.status = 'paused';
            this.state.error = 'Инвентарь полон, сундук не найден';
            this.saveProgress();
            while (this.state.status === 'paused') {
              await this.sleep(1000);
              if (!isInventoryFull(this.bot)) {
                this.state.status = 'mining';
                this.state.error = null;
                break;
              }
            }
            if (this.state.status !== 'mining') return;
          }
        }

        const distance = this.bot.entity.position.distanceTo(pos);
        if (distance > REACH_DISTANCE || !this.bot.canSeeBlock(block)) {
          try {
            await this.gotoWithTimeout(new GoalNear(pos.x, pos.y, pos.z, 2), 8000);
          } catch {
            // Игнорируем ошибку и пробуем еще раз
          }
        }

        const targetBlock = this.bot.blockAt(pos);
        if (!targetBlock || !shouldMine(targetBlock)) {
          success = true;
          break;
        }

        this.state.currentTool = await equipBestTool(this.bot, targetBlock);

        try {
          await this.bot.lookAt(targetBlock.position.offset(0.5, 0.5, 0.5), true);

          // Проверяем досягаемость после lookAt — вдруг бот встал за углом
          const distAfterLook = this.bot.entity.position.distanceTo(pos);
          if (distAfterLook > REACH_DISTANCE || !this.bot.canSeeBlock(targetBlock)) {
            throw new Error('Блок не виден после поворота');
          }

          await new Promise<void>((resolve, reject) => {
            let finished = false;

            const timer = setTimeout(() => {
              if (finished) return;
              finished = true;
              this.bot.stopDigging();
              // Задержка перед reject чтобы stopDigging дошёл до сервера
              setTimeout(() => reject(new Error('Копка зависла')), 300);
            }, 6000);

            this.bot.dig(targetBlock)
              .then(() => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolve();
              })
              .catch((err) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                reject(err);
              });
          });

          success = true;
          this.saveProgress();
        } catch (err) {
          attempts++;
          // Даём mineflayer время сбросить состояние dig
          await this.sleep(500);
        }
      }

      this.state.minedBlocks++;
    }
  }

  pause(): void { if (this.state.status === 'mining') { this.state.status = 'paused'; this.saveProgress(); } }
  resume(): void { if (this.state.status === 'paused') { this.state.status = 'mining'; this.saveProgress(); } }
  
  stop(): void {
    this.state.status = 'idle';
    this.bot.pathfinder.setGoal(null as any);
    this.clearSavedProgress();
  }

  private gotoWithTimeout(goal: any, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let isDone = false;
      let stuckChecker: ReturnType<typeof setInterval> | null = null;
      
      const finish = (err?: Error) => {
        if (isDone) return;
        isDone = true;
        if (stuckChecker) clearInterval(stuckChecker);
        clearTimeout(timer);
        this.bot.clearControlStates(); 
        if (err) reject(err);
        else resolve();
      };

      // Легкий пинок: если бот стоит на месте, просто подпрыгнет
      let lastPos = this.bot.entity.position.clone();
      let stuckMs = 0;
      stuckChecker = setInterval(() => {
        if (isDone) return;
        const pos = this.bot.entity.position;
        if (pos.distanceTo(lastPos) < 0.2) {
          stuckMs += 500;
          if (stuckMs >= 2000) {
            this.bot.setControlState('jump', true);
            setTimeout(() => this.bot.setControlState('jump', false), 250);
            stuckMs = 0;
          }
        } else {
          stuckMs = 0;
          lastPos = pos.clone();
        }
      }, 500);

      const timer = setTimeout(() => {
        this.bot.pathfinder.stop();
        finish(new Error('Тайм-аут пути'));
      }, timeoutMs);

      this.bot.pathfinder.goto(goal)
        .then(() => finish())
        .catch((err) => finish(err));
    });
  }

  public async goToBase(targetX: number, targetY: number | null, targetZ: number): Promise<void> {
    if (this.state.status === 'mining' || this.state.status === 'traveling') {
      throw new Error('Бот занят');
    }

    this.state = {
      ...this.state,
      status: 'traveling',
      error: 'Ищу путь на базу...',
    };

    // Для путешествий: нужен registry, ЗАПРЕЩАЕМ КОПАТЬ и бегать
    const movements = new Movements(this.bot, this.bot.registry);
    movements.canDig = false; 
    movements.allowSprinting = false;
    this.bot.pathfinder.setMovements(movements);

    try {
      const goal = targetY === null
        ? new GoalXZ(targetX, targetZ)
        : new GoalNear(targetX, targetY, targetZ, 2);
      
      // Даем ему 3 минуты, чтобы спокойно дойти (A* сам найдет путь в обход)
      await this.gotoWithTimeout(goal, 180000);

      if (this.state.status === 'traveling') {
        this.state.status = 'idle';
        this.state.error = null;
        console.log('[Miner] Добрался до базы!');
      }
    } catch (err: any) {
      if (this.state.status !== 'idle') {
        this.state.status = 'error';
        this.state.error = `Ошибка навигации: ${err.message}`;
      }
    }
  }

  public async goToBedAndSleep(targetX: number, targetY: number, targetZ: number): Promise<void> {
    if (this.state.status === 'mining' || this.state.status === 'traveling') {
      throw new Error('Бот занят другим делом');
    }

    this.state = {
      ...this.state,
      status: 'traveling',
      error: 'Ищу путь к кровати...',
    };

    // То же самое: запрещаем рыть тоннели сквозь стены
    const movements = new Movements(this.bot, this.bot.registry);
    movements.canDig = false;
    movements.allowSprinting = false;
    this.bot.pathfinder.setMovements(movements);

    try {
      const goal = new GoalNear(targetX, targetY, targetZ, 2);
      await this.gotoWithTimeout(goal, 180000);

      const bedBlock = this.bot.findBlock({
        matching: (block) => this.bot.isABed(block),
        maxDistance: 4, 
      });

      if (!bedBlock) {
        throw new Error('Кровать не найдена! Проверь координаты.');
      }

      this.state.error = 'Пытаюсь уснуть...';
      
      try {
        await this.bot.sleep(bedBlock);
        this.state.error = 'Сплю... zZZ';
        console.log('[Miner] Бот лег спать.');
        
        await new Promise<void>((resolve) => {
          this.bot.once('wake', () => {
            resolve();
          });
        });
        
        console.log('[Miner] Бот проснулся! Доброе утро.');
        this.state.error = null;
      } catch (sleepErr: any) {
        throw new Error(`Не удалось уснуть: ${sleepErr.message}`);
      }

    } catch (err: any) {
      this.state.error = `Ошибка сна: ${err.message}`;
      console.error('[Miner] Ошибка сна:', err.message);
    } finally {
      if (this.state.status === 'traveling') {
        this.state.status = 'idle';
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}