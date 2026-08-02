//  localized comment
// fully offline. Each resident is a tiny agent: needs (energy/fun/social)
// decay over time; every decision tick they pick the highest-utility activity
// (work at the factory / stroll the plaza / chat / rest at home / watch or
// FIGHT in the arena). Movement is waypoint-graph routing over lanes that are
// authored clear of buildings, so residents never clip through houses.
//
// main.ts owns the arena; this module only walks people around town and
// hands over contestants when the match scheduler asks.

export interface V2 { x: number; z: number }

// ── waypoint graph (coords match tools/build-town.mjs lanes/paths) ───────────
const WP: Record<string, V2> = {
  PLAZA: { x: 0, z: 14 },
  PLAZA_W: { x: -4, z: 14 },
  PLAZA_E: { x: 4, z: 13.6 },
  W_JUNC: { x: -13, z: 14 },      // houses lane ∩ west path (also house C's door)
  HOUSE_A: { x: -13, z: 2 },
  HOUSE_B: { x: -13, z: 8 },
  HOUSE_D: { x: -13, z: 20 },
  E_JUNC: { x: 10.9, z: 13.6 },
  BOOTH_N: { x: 10.9, z: 9.7 },   // north side of the signup booth
  GATE: { x: 9.2, z: 9.4 },       // contestants gather here before entering
  WATCH_J: { x: 8.6, z: 7 },
  WATCH_0: { x: 8.6, z: 2.5 },    // front-row standing spots beside the stands
  WATCH_1: { x: 8.6, z: -2.5 },
  F_TOP: { x: 14, z: 13.6 },
  F_MID: { x: 14, z: -3 },
  FACTORY: { x: 15.2, z: -3 },    // just outside the factory door
};
export const TOWN_WAYPOINTS: Readonly<Record<string, V2>> = WP;

// Friendly names for waypoints (shown when NPC leads player)
export const WAYPOINT_NAMES: Readonly<Record<string, string>> = {
  PLAZA: 'the Plaza',
  PLAZA_W: 'the Plaza',
  PLAZA_E: 'the Plaza',
  W_JUNC: 'the Houses',
  HOUSE_A: 'House A',
  HOUSE_B: 'House B',
  HOUSE_D: 'House D',
  E_JUNC: 'the Junction',
  BOOTH_N: 'the Signup Booth',
  GATE: 'the Arena Gate',
  WATCH_J: 'the Spectator Area',
  WATCH_0: 'the Spectator Stands',
  WATCH_1: 'the Spectator Stands',
  F_TOP: 'the Factory Path',
  F_MID: 'the Factory Path',
  FACTORY: 'the Candy Factory',
};

const EDGES: ReadonlyArray<readonly [string, string]> = [
  ['HOUSE_A', 'HOUSE_B'], ['HOUSE_B', 'W_JUNC'], ['W_JUNC', 'HOUSE_D'],
  ['W_JUNC', 'PLAZA_W'], ['PLAZA_W', 'PLAZA'], ['PLAZA', 'PLAZA_E'],
  ['PLAZA_E', 'E_JUNC'], ['E_JUNC', 'BOOTH_N'], ['BOOTH_N', 'GATE'],
  ['BOOTH_N', 'WATCH_J'], ['WATCH_J', 'WATCH_0'], ['WATCH_0', 'WATCH_1'],
  ['E_JUNC', 'F_TOP'], ['F_TOP', 'F_MID'], ['F_MID', 'FACTORY'],
];
const ADJ = new Map<string, string[]>();
for (const [a, b] of EDGES) {
  (ADJ.get(a) ?? ADJ.set(a, []).get(a)!).push(b);
  (ADJ.get(b) ?? ADJ.set(b, []).get(b)!).push(a);
}
const routeBetween = (from: string, to: string): string[] => {
  if (from === to) return [];
  const prev = new Map<string, string>([[from, '']]);
  const q = [from];
  while (q.length > 0) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const nb of ADJ.get(cur) ?? []) {
      if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
  }
  if (!prev.has(to)) return [to];
  const path: string[] = [];
  for (let n = to; n !== from; n = prev.get(n)!) path.push(n);
  return path.reverse();
};

export type Activity =
  | 'idle' | 'stroll' | 'work' | 'chat' | 'rest' | 'toArena' | 'fight' | 'watch'
  | 'talkPlayer' | 'talkLeading' | 'brain';
// talkPlayer = frozen dialogue; talkLeading = walking while leading player to a destination

export type TownBodyIntent =
  | { action: 'goto'; waypoint: string }
  | { action: 'follow'; target: string }
  | { action: 'emote'; emote: 'wave' | 'cheer' | 'ponder' };

export interface ResidentDef {
  key: string;         // 'A'...
  prefix: string;      // rig prefix in the pack ('NpcA')
  name: string;        // display name for chat/trash-talk
  home: string;        // waypoint key of their house door
  workTalk: string;    // one flavor line when heading to work
  role?: string;       // 'guide' → a stationary greeter (no work / no duels)
}

export interface Resident {
  def: ResidentDef;
  x: number; z: number;
  faceX: number; faceZ: number;
  moving: boolean;
  speed: number;
  activity: Activity;
  atNode: string;             // last reached waypoint
  route: string[];            // remaining waypoint keys
  microTarget: V2 | null;     // plaza stroll wander target
  timer: number;              // current activity countdown
  decideT: number;            // next decision tick
  needs: { energy: number; fun: number; social: number };
  chatPartner: Resident | null;
  chatScript: readonly string[];
  chatLine: number;
  chatT: number;
  onArrive: (() => void) | null;
  brainIntent: TownBodyIntent | null;
  brainTtl: number;
  brainArrived: string | null;
  mood: string;
  towardsPlayer: number;
  // leading state: destination waypoint when talkLeading
  leadTarget: string | null;
  leadArrived: boolean;
  leadArrivalAnnounced: boolean;
}

export interface TownApi {
  chat(name: string, text: string): void;
  matchRunning(): boolean;
}

const WALK_SPEED = 2.3;
const DECIDE_EVERY = 0.9;
const CHAT_LINE_S = 1.7;

export class TownSim {
  readonly residents: Resident[] = [];

  constructor(
    defs: readonly ResidentDef[],
    private readonly chatScripts: ReadonlyArray<readonly string[]>,
  ) {
    for (const def of defs) {
      const at = WP[def.home]!;
      this.residents.push({
        def, x: at.x, z: at.z, faceX: 0, faceZ: 1, moving: false, speed: WALK_SPEED,
        activity: 'idle', atNode: def.home, route: [], microTarget: null,
        timer: 0, decideT: Math.random() * DECIDE_EVERY,
        needs: {
          energy: 60 + Math.random() * 40,
          fun: 30 + Math.random() * 45,
          social: 30 + Math.random() * 45,
        },
        chatPartner: null, chatScript: [], chatLine: 0, chatT: 0, onArrive: null,
        brainIntent: null, brainTtl: 0, brainArrived: null, mood: 'neutral', towardsPlayer: 0,
        leadTarget: null, leadArrived: false, leadArrivalAnnounced: false,
      });
    }
  }

  /** two least-busy residents for an NPC-vs-NPC match, already routed to the gate */
  requestContestants(): [Resident, Resident] | null {
    const free = this.residents.filter((r) =>
      r.def.role !== 'guide' &&        // the guide greets; it never brawls
      r.activity !== 'fight' && r.activity !== 'toArena' && r.activity !== 'chat' &&
      r.activity !== 'talkPlayer' && r.activity !== 'talkLeading');   // don't yank someone mid-sentence or mid-guide
    if (free.length < 2) return null;
    free.sort((a, b) => a.needs.fun - b.needs.fun);   // the bored ones want to brawl
    const pair: [Resident, Resident] = [free[0]!, free[1]!];
    for (const r of pair) {
      this.abortChat(r);
      r.activity = 'toArena';
      r.route = routeBetween(this.nearestNode(r), 'GATE');
      r.microTarget = null;
      r.onArrive = null;
    }
    return pair;
  }

  bothAtGate(pair: readonly [Resident, Resident]): boolean {
    const g = WP.GATE!;
    return pair.every((r) => Math.hypot(r.x - g.x, r.z - g.z) < 0.9);
  }

  /** hand a contestant over to the arena (sim stops driving them) */
  enterFight(r: Resident): void { r.activity = 'fight'; r.route = []; r.moving = false; }

  /** match over — back to town life at the gate, fun restored by the brawl */
  releaseFromMatch(r: Resident): void {
    const g = WP.GATE!;
    r.x = g.x; r.z = g.z;
    r.atNode = 'GATE';
    r.activity = 'idle';
    r.route = [];
    r.timer = 0;
    r.brainIntent = null;
    r.brainTtl = 0;
    r.needs.fun = 100;
    r.needs.energy = Math.max(10, r.needs.energy - 25);
  }

  /** residents currently standing at the watch spots (for heckling) */
  watchers(): Resident[] { return this.residents.filter((r) => r.activity === 'watch'); }

  /** Apply a validated Brain intent without replacing combat or the match scheduler. */
  applyBodyIntent(npcId: string, intent: TownBodyIntent, ttlSec: number): boolean {
    const resident = this.residents.find((item) => item.def.key === npcId);
    if (!resident || resident.activity === 'fight' || resident.activity === 'toArena') {
      return false;
    }
    // A correlated goto received during face-to-face dialogue means “show me
    // the way”: keep the talk session alive while the local Body walks.
    if (intent.action === 'goto' && resident.activity === 'talkPlayer') {
      if (!WP[intent.waypoint]) return false;
      resident.activity = 'talkLeading';
      resident.leadTarget = intent.waypoint;
      resident.leadArrived = false;
      resident.leadArrivalAnnounced = false;
      resident.brainIntent = intent;
      resident.brainTtl = Math.max(1, ttlSec);
      resident.route = routeBetween(this.nearestNode(resident), intent.waypoint);
      resident.microTarget = null;
      resident.onArrive = () => { resident.leadArrived = true; };
      return true;
    }
    // Other intents are rejected during talkPlayer (NPC is frozen for dialogue)
    if (resident.activity === 'talkPlayer' || resident.activity === 'talkLeading') return false;
    if (intent.action === 'goto' && !WP[intent.waypoint]) return false;
    if (intent.action === 'follow' && intent.target !== 'player' && !this.residents.some((item) => item.def.key === intent.target)) {
      return false;
    }

    this.abortChat(resident);
    resident.activity = 'brain';
    resident.brainIntent = intent;
    resident.brainTtl = Math.max(1, ttlSec);
    resident.brainArrived = null;
    resident.route = [];
    resident.microTarget = null;
    resident.onArrive = null;
    if (intent.action === 'goto') this.goto(resident, intent.waypoint);
    if (intent.action === 'emote') resident.timer = Math.min(3, resident.brainTtl);
    return true;
  }

  /** Release an expired Brain override so the resident's needs scheduler resumes. */
  expireBodyIntent(npcId: string): boolean {
    const resident = this.residents.find((item) => item.def.key === npcId);
    if (!resident) return false;
    resident.brainIntent = null;
    resident.brainTtl = 0;
    resident.brainArrived = null;
    if (resident.activity !== 'brain' && resident.activity !== 'talkLeading') return false;
    resident.activity = 'idle';
    resident.route = [];
    resident.microTarget = null;
    resident.onArrive = null;
    resident.timer = 0;
    resident.moving = false;
    resident.decideT = 0;
    resident.leadTarget = null;
    resident.leadArrived = false;
    resident.leadArrivalAnnounced = false;
    return true;
  }


  consumeBrainArrival(npcId: string): string | null {
    const resident = this.residents.find((item) => item.def.key === npcId);
    if (!resident) return null;
    const waypoint = resident.brainArrived;
    resident.brainArrived = null;
    return waypoint;
  }

  applyEmotion(npcId: string, mood: string, towardsPlayer: number | undefined): boolean {
    const resident = this.residents.find((item) => item.def.key === npcId);
    if (!resident) return false;
    resident.mood = mood;
    if (towardsPlayer !== undefined) resident.towardsPlayer = Math.max(-1, Math.min(1, towardsPlayer));
    return true;
  }

  /** the player walked up and pressed E — freeze in place for a chat */
  beginPlayerTalk(r: Resident): void {
    this.abortChat(r);
    r.activity = 'talkPlayer';
    r.route = [];
    r.microTarget = null;
    r.onArrive = null;
    r.moving = false;
    r.timer = 0;
    r.brainIntent = null;
    r.brainTtl = 0;
    r.leadTarget = null;
    r.leadArrived = false;
    r.leadArrivalAnnounced = false;
  }

  /** chat over (finished, skipped, or the player walked off) — back to life */
  endPlayerTalk(r: Resident): void {
    if (r.activity !== 'talkPlayer' && r.activity !== 'talkLeading') return;
    r.activity = 'idle';
    r.timer = 0;
    r.route = [];
    r.microTarget = null;
    r.onArrive = null;
    r.moving = false;
    r.leadTarget = null;
    r.leadArrived = false;
    r.leadArrivalAnnounced = false;
    r.needs.social = 100;   // talking to the player is peak social
    r.needs.fun = Math.min(100, r.needs.fun + 15);
  }

  private nearestNode(r: Resident): string {
    let best = 'PLAZA', bd = Infinity;
    for (const [k, p] of Object.entries(WP)) {
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  private abortChat(r: Resident): void {
    if (r.chatPartner) {
      const p = r.chatPartner;
      p.chatPartner = null;
      if (p.activity === 'chat') { p.activity = 'idle'; p.timer = 0; }
      r.chatPartner = null;
    }
  }

  private goto(r: Resident, node: string, then: (() => void) | null = null): void {
    r.route = routeBetween(this.nearestNode(r), node);
    r.microTarget = null;
    r.onArrive = then;
  }

  private decide(r: Resident, api: TownApi): void {
    const n = r.needs;
    // the plaza guide is a patient greeter: it idles near home waiting to help,
    // and only moves when the Brain issues a goto/wave intent. It never works
    // the factory or gets bored enough to wander off post.
    if (r.def.role === 'guide') {
      r.activity = 'idle';
      r.moving = false;
      if (r.atNode !== r.def.home && r.route.length === 0) this.goto(r, r.def.home);
      r.timer = 2 + Math.random() * 3;
      n.social = Math.max(n.social, 60);   // greeting the town keeps it content
      n.fun = Math.max(n.fun, 60);
      return;
    }
    // rest is non-negotiable when drained
    if (n.energy < 25) {
      r.activity = 'rest';
      this.goto(r, r.def.home, () => { r.timer = 9; });
      return;
    }
    // a match is on and they're free → go heckle from the front row
    if (api.matchRunning() && n.fun < 75 && Math.random() < 0.75) {
      r.activity = 'watch';
      this.goto(r, Math.random() < 0.5 ? 'WATCH_0' : 'WATCH_1', () => { r.timer = 999; });
      return;
    }
    // chat when social is the sorest need and someone else is loitering nearby
    if (n.social <= n.fun && n.social < 55) {
      const buddy = this.residents.find((o) =>
        o !== r && o.def.role !== 'guide' && (o.activity === 'idle' || o.activity === 'stroll') &&
        Math.hypot(o.x - r.x, o.z - r.z) < 7);
      if (buddy) {
        this.abortChat(buddy);
        r.activity = 'chat'; buddy.activity = 'chat';
        r.chatPartner = buddy; buddy.chatPartner = r;
        r.chatScript = this.chatScripts[Math.floor(Math.random() * this.chatScripts.length)]!;
        r.chatLine = 0; r.chatT = 0.6;
        r.timer = r.chatScript.length * CHAT_LINE_S + 1.5;
        buddy.timer = r.timer;
        buddy.route = []; buddy.microTarget = null;
        // face each other
        const dx = buddy.x - r.x, dz = buddy.z - r.z, L = Math.hypot(dx, dz) || 1;
        r.faceX = dx / L; r.faceZ = dz / L;
        buddy.faceX = -dx / L; buddy.faceZ = -dz / L;
        return;
      }
    }
    // bored → stroll the plaza; content → clock in at the candy factory
    if (n.fun < 45 || Math.random() < 0.45) {
      r.activity = 'stroll';
      this.goto(r, 'PLAZA', () => { r.timer = 7 + Math.random() * 4; });
    } else {
      r.activity = 'work';
      if (Math.random() < 0.35) api.chat(r.def.name, r.def.workTalk);
      this.goto(r, 'FACTORY', () => { r.timer = 10 + Math.random() * 5; });
    }
  }

  update(dt: number, api: TownApi, player?: V2): void {
    for (const r of this.residents) {
      // arena drives fighters; main.ts drives a resident chatting with the player
      // BUT talkLeading needs movement updates here
      if (r.activity === 'fight' || r.activity === 'talkPlayer') continue;
      if (r.activity === 'brain') {
        r.brainTtl -= dt;
        if (r.brainTtl <= 0) {
          this.expireBodyIntent(r.def.key);
        } else if (r.brainIntent?.action === 'follow') {
          const targetId = r.brainIntent.target;
          const target = targetId === 'player'
            ? player
            : this.residents.find((item) => item.def.key === targetId);
          if (target) {
            const dx = target.x - r.x, dz = target.z - r.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 1.5) {
              const step = Math.min(r.speed * dt, dist - 1.5);
              r.x += (dx / dist) * step;
              r.z += (dz / dist) * step;
              r.faceX = dx / dist;
              r.faceZ = dz / dist;
              r.moving = true;
            } else {
              r.moving = false;
            }
          }
        } else if (r.brainIntent?.action === 'emote') {
          r.moving = false;
          r.timer -= dt;
          if (r.timer <= 0) r.brainTtl = 0;
        } else if (r.brainIntent?.action === 'goto' && r.route.length === 0) {
          r.moving = false;
          r.brainArrived = r.brainIntent.waypoint;
          r.brainTtl = 0;
        }
      }
      // needs decay (rest restores below)
      r.needs.energy = Math.max(0, r.needs.energy - dt * 0.8);
      r.needs.fun = Math.max(0, r.needs.fun - dt * 1.1);
      r.needs.social = Math.max(0, r.needs.social - dt * 0.9);

      // watching ends when the match does
      if (r.activity === 'watch' && !api.matchRunning()) {
        r.activity = 'idle'; r.timer = 0; r.needs.fun = Math.min(100, r.needs.fun + 30);
      }

      // chat playback (owner side of the pair speaks for both, alternating)
      if (r.activity === 'chat') {
        if (r.chatPartner && r.chatScript.length > 0) {
          r.chatT -= dt;
          if (r.chatT <= 0 && r.chatLine < r.chatScript.length) {
            const speaker = r.chatLine % 2 === 0 ? r : r.chatPartner;
            api.chat(speaker.def.name, r.chatScript[r.chatLine]!);
            r.chatLine++;
            r.chatT = CHAT_LINE_S;
          }
        }
        r.timer -= dt;
        r.moving = false;
        if (r.timer <= 0) {
          r.needs.social = 100;
          if (r.chatPartner) { r.chatPartner.needs.social = 100; }
          this.abortChat(r);
          r.activity = 'idle';
        }
        continue;
      }

      // ── talkLeading: NPC walks toward leadTarget while dialogue continues ────
      if (r.activity === 'talkLeading') {
        r.brainTtl -= dt;
        if (r.brainTtl <= 0) {
          this.expireBodyIntent(r.def.key);
          continue;
        }
        const targetWp = r.leadTarget ? WP[r.leadTarget] : null;
        if (targetWp && !r.leadArrived) {
          // follow the route toward the destination
          let moveTarget: V2 | null = null;
          if (r.route.length > 0) moveTarget = WP[r.route[0]!]!;
          else if (r.leadTarget) {
            // no route yet or route exhausted, compute new route
            r.route = routeBetween(this.nearestNode(r), r.leadTarget);
            if (r.route.length > 0) moveTarget = WP[r.route[0]!]!;
          }
          if (moveTarget) {
            const dx = moveTarget.x - r.x, dz = moveTarget.z - r.z;
            const dist = Math.hypot(dx, dz);
            const step = r.speed * dt;
            if (dist <= step) {
              r.x = moveTarget.x; r.z = moveTarget.z;
              if (r.route.length > 0) {
                r.atNode = r.route.shift()!;
                if (r.route.length === 0 && r.atNode === r.leadTarget) {
                  r.leadArrived = true;
                  r.moving = false;
                  r.onArrive?.();
                }
              }
            } else {
              r.x += (dx / dist) * step;
              r.z += (dz / dist) * step;
              r.faceX = dx / dist;
              r.faceZ = dz / dist;
              r.moving = true;
            }
          }
        } else {
          r.moving = false;  // arrived or no target
        }
        continue;  // skip the normal movement logic below
      }

      // ── movement: follow the waypoint route, then micro-wander (stroll) ────
      let target: V2 | null = null;
      if (r.route.length > 0) target = WP[r.route[0]!]!;
      else if (r.microTarget) target = r.microTarget;

      if (target) {
        const dx = target.x - r.x, dz = target.z - r.z;
        const dist = Math.hypot(dx, dz);
        const step = r.speed * dt;
        if (dist <= step) {
          r.x = target.x; r.z = target.z;
          if (r.route.length > 0) {
            r.atNode = r.route.shift()!;
            if (r.route.length === 0) {
              r.moving = false;
              r.onArrive?.();
              r.onArrive = null;
            }
          } else {
            r.microTarget = null;
            r.moving = false;
          }
        } else {
          r.x += (dx / dist) * step;
          r.z += (dz / dist) * step;
          r.faceX = dx / dist; r.faceZ = dz / dist;
          r.moving = true;
        }
      } else if (!(r.activity === 'brain' && r.brainIntent?.action === 'follow')) {
        r.moving = false;
      }

      // ── activity timers ────────────────────────────────────────────────────
      if (r.route.length === 0 && r.timer > 0) {
        r.timer -= dt;
        if (r.activity === 'rest') r.needs.energy = Math.min(100, r.needs.energy + dt * 12);
        if (r.activity === 'work' && r.timer <= 0) r.needs.fun = Math.max(0, r.needs.fun - 8);
        if (r.activity === 'stroll') {
          r.needs.fun = Math.min(100, r.needs.fun + dt * 6);
          if (!r.microTarget && Math.random() < dt * 0.7) {
            const p = WP.PLAZA!;
            r.microTarget = { x: p.x + (Math.random() * 2 - 1) * 3.6, z: p.z + (Math.random() * 2 - 1) * 2.6 };
          }
        }
        if (r.timer <= 0) r.activity = 'idle';
      }

      // ── decision tick when free ────────────────────────────────────────────
      if (r.activity === 'idle' && r.route.length === 0) {
        r.decideT -= dt;
        if (r.decideT <= 0) {
          r.decideT = DECIDE_EVERY + Math.random() * 0.6;
          this.decide(r, api);
        }
      }
    }
  }
}
