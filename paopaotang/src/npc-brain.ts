import { get } from "./localization";
import {
  NPC_PROTOCOL_VERSION,
  NpcClient,
  type NpcCognitiveLod,
  type NpcDecision,
  type PerceptionSnapshot,
} from '@forgeax/npc-client';
import {
  GENERIC_DIALOGUE,
  NPC_DIALOGUE,
  TOPICS,
  type AnswerPool,
  type NpcDialogue,
  type TopicDef,
} from './npc-dialogue.gen';
import { npcDefinitionById, npcDefinitions } from './npcs';
import { TOWN_WAYPOINTS, type Resident, type TownBodyIntent, type V2 } from './town';

// UI helper lives outside this managed file so npc_wire can update config safely.
export { installChatInput, type ChatInputHandle } from './chat-input';

// <forgeax:npc-brain-config>
export const npcBrainConfig = {
  game: "paopaotang",
  npcs: npcDefinitions,
} as const;
// </forgeax:npc-brain-config>

const NPC_IDS = npcDefinitions.map((definition) => definition.npcId);
const HEARTBEAT_INTERVAL_S = 30;
const SPOTLIGHT_DISTANCE = 7;
const AMBIENT_DISTANCE = 20;

export type NpcAskKind = 'greet' | 'topic' | 'free' | 'farewell';
export type NpcLodSyncAction = 'attach' | 'detach' | 'set' | 'none';

export function npcLodSyncAction(
  attached: boolean,
  next: NpcCognitiveLod,
): NpcLodSyncAction {
  if (next === 'spotlight') return attached ? 'set' : 'attach';
  if (next === 'offstage') return attached ? 'detach' : 'none';
  return attached ? 'set' : 'none';
}

export interface PlayerFacts {
  cupWins: number;
  cupFalls: number;
  duelsWatched: number;
}

interface NpcBrainAdapterOptions {
  residents: () => readonly Resident[];
  playerPosition: () => V2;
  applyIntent: (npcId: string, intent: TownBodyIntent, ttlSec: number) => boolean;
  expireIntent: (npcId: string) => void;
  onUtterance: (npcId: string, lines: readonly string[]) => void;
  onEmotion?: (npcId: string, mood: string, towardsPlayer: number | undefined) => void;
}

interface AskInput {
  npcId: string;
  kind: NpcAskKind;
  playerText?: string;
  topicId?: string;
  now: number;
}

const pick = <T>(items: ReadonlyArray<T>): T => items[Math.floor(Math.random() * items.length)]!;

/**
 * Game-owned boundary around the evolving SDK. It exposes only snapshots and
 * typed Town body intents, so transport changes remain isolated in this file.
 * Config inside `<forgeax:npc-brain-config>` is owned by `npc_wire`; Body wiring
 * below the markers is game-owned and must survive config upserts.
 */
export class PaopaotangNpcBrain {
  readonly #client: NpcClient;
  readonly #options: NpcBrainAdapterOptions;
  readonly #facts: PlayerFacts = { cupWins: 0, cupFalls: 0, duelsWatched: 0 };
  readonly #worldEvents: string[] = [];
  readonly #interactive = new Set<string>();
  readonly #attached = new Set<string>(NPC_IDS);
  #eventSeq = 0;
  #heartbeatAt = HEARTBEAT_INTERVAL_S;
  readonly #lod = new Map<string, NpcCognitiveLod>();

  private constructor(options: NpcBrainAdapterOptions, client: NpcClient) {
    this.#options = options;
    this.#client = client;
    for (const npc of npcDefinitions) client.declareAffordances(npc.npcId, [...npc.affordances]);
  }

  static async connect(options: NpcBrainAdapterOptions): Promise<PaopaotangNpcBrain> {
    let brain: PaopaotangNpcBrain | undefined;
    const client = await NpcClient.connect({
      game: npcBrainConfig.game,
      npcIds: [...NPC_IDS],
      npcs: npcDefinitions.map(({ npcId, soulId }) => ({ npcId, soulId })),
      onDecision: (decision) => { if (brain) brain.#acceptDecision(decision); },
      onIntentExpired: (npcId) => options.expireIntent(npcId),
    });
    brain = new PaopaotangNpcBrain(options, client);
    return brain;
  }


  get topics(): readonly TopicDef[] { return TOPICS; }
  get facts(): Readonly<PlayerFacts> { return this.#facts; }

  noteWin(): void {
    this.#facts.cupWins += 1;
    this.#rememberEvent('player_won_cup');
  }

  noteFall(): void {
    this.#facts.cupFalls += 1;
    this.#rememberEvent('player_lost_cup');
  }

  noteDuelWatched(): void {
    this.#facts.duelsWatched += 1;
    this.#rememberEvent('player_watched_duel');
  }

  async ask(input: AskInput): Promise<readonly string[] | null> {
    const snapshot = this.#snapshot({
      npcId: input.npcId,
      now: input.now,
      trigger: 'player_message',
      text: input.playerText,
      events: [{
        type: 'player_message',
        kind: input.kind,
        ...(input.topicId ? { topicId: input.topicId } : {}),
      }],
    });
    this.#interactive.add(input.npcId);
    try {
      // Interactive dialogue deliberately uses the correlated HTTP request.
      // Autonomous heartbeat/event traffic still uses WS batching in pulse().
      const decision = await this.#client.decide(snapshot);
      return decision?.utterance?.lines ?? null;
    } finally {
      this.#interactive.delete(input.npcId);
    }
  }

  /** Cognitive LOD is spatial; only spotlight residents enter the aligned WS batch. */
  pulse(now: number): void {
    const player = this.#options.playerPosition();
    const spotlight: string[] = [];
    for (const resident of this.#options.residents()) {
      const distance = Math.hypot(resident.x - player.x, resident.z - player.z);
      const next: NpcCognitiveLod = distance <= SPOTLIGHT_DISTANCE
        ? 'spotlight' : distance <= AMBIENT_DISTANCE ? 'ambient' : 'offstage';
      if (this.#lod.get(resident.def.key) !== next) {
        this.#lod.set(resident.def.key, next);
        const action = npcLodSyncAction(this.#attached.has(resident.def.key), next);
        if (action === 'attach') {
          this.#attached.add(resident.def.key);
          const definition = npcDefinitionById.get(resident.def.key);
          void this.#client.attach(resident.def.key, this.#snapshot({
            npcId: resident.def.key, now, trigger: 'attach',
            events: [{ type: 'lod_attached', distance }],
          }), { soulId: definition?.soulId }).catch(() => undefined);
        } else if (action === 'detach') {
          this.#attached.delete(resident.def.key);
          void this.#client.detach(resident.def.key).catch(() => undefined);
        } else if (action === 'set') {
          this.#client.setLod(resident.def.key, next, next === 'spotlight' ? this.#snapshot({
            npcId: resident.def.key, now, trigger: 'spotlight',
            events: [{ type: 'lod_promoted', distance }],
          }) : undefined);
        }
      }
      if (next === 'spotlight') spotlight.push(resident.def.key);
    }
    if (now < this.#heartbeatAt) return;
    this.#heartbeatAt = now + HEARTBEAT_INTERVAL_S;
    void this.#client.sendSnapshots(spotlight.map((npcId) => this.#snapshot({
      npcId, now, trigger: 'heartbeat', events: [{ type: 'town_tick', matchRunning: false }],
    })));
  }

  arrived(npcId: string, waypoint: string, now: number): void {
    if (this.#lod.get(npcId) !== 'spotlight') return;
    void this.#client.emit(this.#snapshot({
      npcId, now, trigger: 'event', events: [{ type: 'arrived', waypoint }],
    }));
  }

  fallbackGreeting(npcId: string): string {
    const dialogue = this.#dialogue(npcId);
    if (this.#facts.cupWins > 0 && dialogue.greetChampion.length > 0) {
      return pick(dialogue.greetChampion);
    }
    return pick(dialogue.greetFirst);
  }

  fallbackAnswer(npcId: string, topicId: string): readonly string[] {
    const pool = this.#dialogue(npcId).topics[topicId];
    if (!pool) return [get("paopaotang.src/npc-brain.ts:6772:02922ea525")];
    return pick(this.#fallbackCandidates(pool));
  }

  fallbackFarewell(npcId: string): string {
    return pick(this.#dialogue(npcId).farewells);
  }

  disconnect(): void {
    void this.#client.endEpisode()
      .catch(() => undefined)
      .finally(() => this.#client.disconnect());
  }


  #acceptDecision(decision: NpcDecision): void {
    this.#applyBodyIntent(decision);
    if (decision.emotion) this.#options.onEmotion?.(
      decision.npcId, decision.emotion.mood, decision.emotion.towards?.player,
    );
    if (!this.#interactive.has(decision.npcId) && decision.utterance?.lines) {
      this.#options.onUtterance(decision.npcId, decision.utterance.lines);
    }
  }

  #fallbackCandidates(pool: AnswerPool): ReadonlyArray<ReadonlyArray<string>> {
    const candidates: ReadonlyArray<string>[] = [...pool.base];
    if (this.#facts.cupWins > 0 && pool.champion) candidates.push(...pool.champion);
    if (this.#facts.cupFalls > 0 && this.#facts.cupWins === 0 && pool.fell) candidates.push(...pool.fell);
    if (this.#facts.duelsWatched > 0 && pool.watched) candidates.push(...pool.watched);
    return candidates;
  }

  #dialogue(npcId: string): NpcDialogue {
    return NPC_DIALOGUE[npcId] ?? GENERIC_DIALOGUE;
  }

  #snapshot(input: {
    npcId: string;
    now: number;
    trigger: PerceptionSnapshot['trigger'];
    text?: string;
    events: PerceptionSnapshot['events'];
  }): PerceptionSnapshot {
    const resident = this.#options.residents().find((item) => item.def.key === input.npcId);
    const player = this.#options.playerPosition();
    const playerFacts = [
      `cupWins=${this.#facts.cupWins}`,
      `cupFalls=${this.#facts.cupFalls}`,
      `duelsWatched=${this.#facts.duelsWatched}`,
    ];
    return {
      v: NPC_PROTOCOL_VERSION,
      eventId: `ppt-${input.npcId}-${++this.#eventSeq}`,
      game: npcBrainConfig.game,
      npcId: input.npcId,
      t: input.now,
      trigger: input.trigger,
      ...(input.text ? { text: input.text } : {}),
      self: {
        pos: { x: resident?.x ?? 0, y: resident?.z ?? 0 },
        activity: resident?.activity ?? 'idle',
      },
      nearby: [
        { kind: 'player', id: 'player', pos: { x: player.x, y: player.z }, facts: playerFacts },
        ...this.#options.residents()
          .filter((item) => item.def.key !== input.npcId)
          .map((item) => ({
            kind: 'resident',
            id: item.def.key,
            pos: { x: item.x, y: item.z },
            facts: [`activity=${item.activity}`],
          })),
        ...Object.entries(TOWN_WAYPOINTS).map(([id, pos]) => ({
          kind: 'waypoint',
          id,
          pos: { x: pos.x, y: pos.z },
          facts: [],
        })),
      ],
      events: [
        ...this.#worldEvents.map((type) => ({ type })),
        ...input.events,
        {
          type: 'player_facts',
          cupWins: this.#facts.cupWins,
          cupFalls: this.#facts.cupFalls,
          duelsWatched: this.#facts.duelsWatched,
        },
      ],
      scene: 'candy_town',
      visibilityGroup: 'town-public',
      affordances: [...(npcDefinitionById.get(input.npcId)?.affordances ?? [])],
    };
  }

  #applyBodyIntent(decision: NpcDecision): void {
    const intent = decision.intent;
    if (!intent) return;
    let body: TownBodyIntent | null = null;
    if (intent.action === 'goto' && intent.params?.waypoint) {
      body = { action: 'goto', waypoint: intent.params.waypoint };
    } else if (intent.action === 'follow' && intent.params?.target) {
      body = { action: 'follow', target: intent.params.target };
    } else if (intent.action === 'emote' && isEmote(intent.params?.emote)) {
      body = { action: 'emote', emote: intent.params.emote };
    }
    if (body) this.#options.applyIntent(decision.npcId, body, intent.ttlSec);
  }

  #rememberEvent(event: string): void {
    this.#worldEvents.push(event);
    if (this.#worldEvents.length > 12) this.#worldEvents.shift();
  }
}

function isEmote(value: string | undefined): value is 'wave' | 'cheer' | 'ponder' {
  return value === 'wave' || value === 'cheer' || value === 'ponder';
}
