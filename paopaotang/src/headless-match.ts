import { NPC_PROTOCOL_VERSION, type Affordance, type NpcDecision, type PerceptionSnapshot } from '@forgeax/npc-client';

export const PLAYER_AFFORDANCES: readonly Affordance[] = [
  { action: 'move', params: { direction: { type: 'enum', source: 'literal', values: ['up', 'down', 'left', 'right'] } } },
  { action: 'place_bubble' },
  { action: 'collect_item', params: { target: { type: 'enum', source: 'nearby.id' } } },
  { action: 'wait' },
] as const;

type Direction = 'up' | 'down' | 'left' | 'right';
type Pos = { x: number; y: number };
interface BotState extends Pos { id: string; alive: boolean; score: number }
interface Bubble extends Pos { owner: string; fuse: number }

export interface HeadlessMatchStats {
  decisions: number;
  bubbles: number;
  movesToward: number;
  itemCollections: number;
  nearTurns: number;
}

/**
 * Deterministic, renderer-free adapter over the shipped arena rules. It accepts
 * the same typed player affordances as a live Brain session; no policy or random
 * win-roll lives here. Movement, fuse, cross-blast and pickups decide the result.
 */
export class HeadlessMatchAdapter {
  readonly width = 13;
  readonly height = 11;
  readonly bots: [BotState, BotState];
  readonly stats = new Map<string, HeadlessMatchStats>();
  readonly replay: Array<{ snapshot: PerceptionSnapshot; decision: NpcDecision }> = [];
  readonly #hard = new Set<string>();
  readonly #items = new Map<string, Pos>();
  readonly #bubbles: Bubble[] = [];
  tick = 0;

  constructor(seed = 1, leftId = 'aggressive', rightId = 'conservative') {
    this.bots = [
      { id: leftId, x: 0, y: 0, alive: true, score: 0 },
      { id: rightId, x: 12, y: 10, alive: true, score: 0 },
    ];
    for (let x = 2; x <= 10; x += 2) for (let y = 2; y <= 8; y += 2) this.#hard.add(key(x, y));
    // Seed changes deterministic item lanes without introducing probabilistic combat.
    for (let i = 0; i < 7; i += 1) {
      const x = 1 + ((seed * 3 + i * 5) % 11);
      const y = 1 + ((seed * 7 + i * 3) % 9);
      if (!this.#hard.has(key(x, y))) this.#items.set(`item-${i}`, { x, y });
    }
    for (const bot of this.bots) this.stats.set(bot.id, emptyStats());
  }

  snapshot(npcId: string): PerceptionSnapshot {
    const self = this.#bot(npcId);
    const opponent = this.bots.find((bot) => bot.id !== npcId)!;
    return {
      v: NPC_PROTOCOL_VERSION,
      eventId: `headless-${this.tick}-${npcId}`,
      game: 'paopaotang',
      npcId,
      playerId: 'headless-eval',
      t: this.tick,
      trigger: 'event',
      self: { pos: { x: self.x, y: self.y }, activity: 'match' },
      nearby: [
        { kind: 'player', id: opponent.id, pos: { x: opponent.x, y: opponent.y }, facts: [`alive=${opponent.alive}`] },
        ...[...this.#items].map(([id, pos]) => ({ kind: 'item', id, pos, facts: ['powerup'] })),
      ],
      events: [{ type: 'match_tick', tick: this.tick }],
      affordances: [...PLAYER_AFFORDANCES],
    };
  }

  step(decisions: readonly NpcDecision[]): void {
    if (this.done) return;
    for (const decision of decisions) {
      const bot = this.#bot(decision.npcId);
      if (!bot.alive) continue;
      const before = distance(bot, this.#opponent(bot.id));
      const stats = this.stats.get(bot.id)!;
      stats.decisions += 1;
      const action = decision.intent?.action ?? 'wait';
      if (action === 'move') {
        const direction = decision.intent?.params?.direction;
        if (isDirection(direction)) this.#move(bot, direction);
        if (distance(bot, this.#opponent(bot.id)) < before) stats.movesToward += 1;
      } else if (action === 'place_bubble' && !this.#bubbles.some((b) => b.owner === bot.id)) {
        this.#bubbles.push({ owner: bot.id, x: bot.x, y: bot.y, fuse: 4 });
        stats.bubbles += 1;
      } else if (action === 'collect_item') {
        const target = decision.intent?.params?.target;
        const item = target ? this.#items.get(target) : undefined;
        if (item && item.x === bot.x && item.y === bot.y) {
          this.#items.delete(target!);
          bot.score += 1;
          stats.itemCollections += 1;
        }
      }
      if (distance(bot, this.#opponent(bot.id)) <= 2) stats.nearTurns += 1;
      this.replay.push({ snapshot: this.snapshot(bot.id), decision });
    }
    this.tick += 1;
    for (const bubble of this.#bubbles) bubble.fuse -= 1;
    for (const bubble of this.#bubbles.filter((item) => item.fuse <= 0)) this.#explode(bubble);
    for (let i = this.#bubbles.length - 1; i >= 0; i -= 1) if (this.#bubbles[i]!.fuse <= 0) this.#bubbles.splice(i, 1);
  }

  get done(): boolean { return this.tick >= 120 || this.bots.some((bot) => !bot.alive); }
  get winner(): string | null {
    const alive = this.bots.filter((bot) => bot.alive);
    if (alive.length === 1) return alive[0]!.id;
    if (!this.done || this.bots[0]!.score === this.bots[1]!.score) return null;
    return this.bots[0]!.score > this.bots[1]!.score ? this.bots[0]!.id : this.bots[1]!.id;
  }

  #bot(id: string): BotState {
    const bot = this.bots.find((candidate) => candidate.id === id);
    if (!bot) throw new Error(`unknown bot ${id}`);
    return bot;
  }
  #opponent(id: string): BotState { return this.bots.find((bot) => bot.id !== id)!; }

  #move(bot: BotState, direction: Direction): void {
    const [dx, dy] = direction === 'up' ? [0, -1] : direction === 'down' ? [0, 1]
      : direction === 'left' ? [-1, 0] : [1, 0];
    const x = bot.x + dx, y = bot.y + dy;
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || this.#hard.has(key(x, y))) return;
    if (this.#bubbles.some((bubble) => bubble.x === x && bubble.y === y)) return;
    bot.x = x; bot.y = y;
  }

  #explode(bubble: Bubble): void {
    const blast = new Set<string>([key(bubble.x, bubble.y)]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let range = 1; range <= 2; range += 1) {
        const x = bubble.x + dx * range, y = bubble.y + dy * range;
        if (x < 0 || x >= this.width || y < 0 || y >= this.height || this.#hard.has(key(x, y))) break;
        blast.add(key(x, y));
      }
    }
    for (const bot of this.bots) if (blast.has(key(bot.x, bot.y))) bot.alive = false;
  }
}

function emptyStats(): HeadlessMatchStats {
  return { decisions: 0, bubbles: 0, movesToward: 0, itemCollections: 0, nearTurns: 0 };
}
function key(x: number, y: number): string { return `${x},${y}`; }
function distance(a: Pos, b: Pos): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function isDirection(value: string | undefined): value is Direction {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}
