import { MatchFSM } from '../../session/MatchFSM';
import { RoomState } from '../../session/RoomState';
import { SeedService } from '../../session/SeedService';
import type { MatchContext } from '../../session/MatchContext';
import type { NetEvent, NetHost, MatchSyncPayload } from '../../net/NetHost';
import { LocalLoopbackNet } from '../../net/NetHost';
import { PartyNet } from '../../net/PartyNet';
import { SnapshotSync } from '../../net/sync/SnapshotSync';
import { VoiceChannel } from '../../net/voice/VoiceChannel';
import { PrivacyChannel } from '../../net/privacy/PrivacyChannel';
import { CardDeck } from '../../cauldron/CardDeck';
import { CastInput } from '../../cauldron/CastInput';
import { AiClassifier } from '../../cauldron/AiClassifier';
import { RoleAllocator } from '../../cauldron/RoleAllocator';
import { TimelinePlayer } from '../../narrative/TimelinePlayer';
import { VoteSystem } from '../../narrative/VoteSystem';
import { DmPresenter } from '../../narrative/DmPresenter';
import { NarrativeDirector } from '../../narrative/NarrativeDirector';
import { requireNarrativeScript } from '../../narrative/content';
import { CHAPTER_CATALOG, getChapter, NodePlaylist } from '../../chapter/NodePlaylist';
import { createMinigame, getLibraryEntry } from '../../minigame/registry';
import type { IMinigame } from '../../minigame/IMinigame';
import { StubMinigame } from '../../minigame/impl/StubMinigame';
import { SugarCoat } from '../../progression/SugarCoat';
import { Ghost } from '../../progression/Ghost';
import { Scoreboard } from '../../progression/Scoreboard';
import { installShellHud, type ShellHud } from './ShellHud';
import { ROLE_LABELS } from '../../shared/config';
import type { CandyRole, MaterialCard, MatchPhase } from '../../shared/types';

type Mode = 'menu' | 'party' | 'solo';

/**
 * AppShell — MatchFSM + lobby/net wiring.
 * - menu: create room / join room / solo(bots)
 * - party: PartyNet (WS signal + WebRTC DC / relay)
 * - solo: LocalLoopbackNet + bots (offline smoke)
 */
export class AppShell {
  readonly fsm = new MatchFSM();
  readonly room: RoomState;
  seed = new SeedService();
  net: NetHost;
  party: PartyNet | null = null;
  sync: SnapshotSync;
  readonly voice = new VoiceChannel();
  privacy: PrivacyChannel;
  readonly deck = CardDeck.demoMx();
  readonly cast = new CastInput();
  readonly classifier: AiClassifier;
  readonly allocator = new RoleAllocator();
  readonly timeline = new TimelinePlayer();
  readonly votes = new VoteSystem();
  dm: DmPresenter;
  readonly narrative: NarrativeDirector;
  readonly sugar = new SugarCoat();
  readonly ghost = new Ghost();
  readonly scoreboard = new Scoreboard();
  playlist: NodePlaylist;

  private hud: ShellHud;
  private mode: Mode = 'menu';
  private displayName = '玩家';
  private joinCode = '';
  private netStatus = '';
  private statusLine = '创建房间或输入房间码加入（最多 4 人）';
  private activeMinigame: IMinigame | null = null;
  private minigameBooting = false;
  private phaseTimer = 0;
  private hand: MaterialCard[] = [];
  private selected: string[] = [];
  private privateClue = '';
  private castConfirmedLocal = false;
  private unsubNet: (() => void) | null = null;

  constructor(private uiHost: HTMLElement) {
    this.room = new RoomState({ empty: true });
    this.net = new LocalLoopbackNet('local', true);
    this.sync = new SnapshotSync(this.net);
    this.privacy = new PrivacyChannel(this.net);
    this.classifier = new AiClassifier(this.deck);
    this.playlist = new NodePlaylist(getChapter('chapter_mx')!, true);
    this.dm = new DmPresenter('katrina_sugar');
    this.narrative = new NarrativeDirector(this.timeline, this.votes, this.dm);
    this.hud = installShellHud(uiHost);
    this.hud.onAction((id) => void this.handleAction(id));
    this.fsm.onChange(() => {
      if (this.isHost) this.broadcastSync();
      this.render();
    });
    this.render();
  }

  private get isHost(): boolean {
    return this.net.isHost;
  }

  private get localId(): string {
    return this.net.localPlayerId;
  }

  dispose(): void {
    this.activeMinigame?.dispose?.();
    this.unsubNet?.();
    this.party?.dispose();
    this.hud.dispose();
  }

  private ctx(): MatchContext {
    return {
      localPlayerId: this.localId,
      isHost: this.isHost,
      room: this.room,
      seed: this.seed,
      net: this.net,
      chapter: getChapter(this.room.chapterId)!,
      nodeIndex: this.fsm.nodeIndex,
      currentNode: this.playlist.at(this.fsm.nodeIndex),
      inputs: this.sync.pendingInputs,
      nowMs: () => performance.now(),
    };
  }

  tick(dt: number): void {
    if (this.mode === 'menu') return;

    this.sync.tick(dt, () => ({
      phase: this.fsm.phase,
      nodeIndex: this.fsm.nodeIndex,
      room: this.room.snapshot(),
    }));

    // Only Host advances authoritative timers / settles.
    if (!this.isHost) {
      if (this.fsm.phase === 'MinigamePlay' && this.activeMinigame) {
        this.activeMinigame.tick(dt, this.sync.pendingInputs);
      } else if (this.fsm.phase === 'NarrativePlay' || this.fsm.phase === 'FinaleNarrative') {
        this.narrative.tick(dt, this.seed, performance.now());
      }
      if (
        this.fsm.phase === 'MinigamePlay' ||
        this.fsm.phase === 'NarrativePlay' ||
        this.fsm.phase === 'LoadingCutscene'
      ) {
        this.render();
      }
      return;
    }

    switch (this.fsm.phase) {
      case 'LoadingCutscene':
        this.phaseTimer += dt;
        if (this.phaseTimer >= 2.5) this.fsm.cutsceneDone();
        break;
      case 'RoleReveal':
        this.phaseTimer += dt;
        if (this.phaseTimer >= 2.2) {
          this.fsm.rolesRevealed();
          void this.beginNarrative('mx_open', /*distributeClues*/ true);
        }
        break;
      case 'NarrativePlay':
      case 'FinaleNarrative':
        if (this.narrative.tick(dt, this.seed, performance.now())) {
          if (this.fsm.phase === 'FinaleNarrative') {
            this.fsm.narrativeDone({ finale: true });
          } else if (this.fsm.nodeIndex < 0) {
            this.fsm.enterFirstNode();
          } else {
            this.fsm.narrativeDone();
          }
        }
        break;
      case 'MinigameLoad':
        void this.bootMinigame();
        break;
      case 'MinigamePlay':
        if (this.activeMinigame) {
          this.activeMinigame.tick(dt, this.sync.pendingInputs);
          if (this.activeMinigame instanceof StubMinigame && this.activeMinigame.finished) {
            const result = this.activeMinigame.settle();
            const ghosts = this.sugar.applyResult(this.room, result);
            for (const g of ghosts) this.ghost.onBecomeGhost(g);
            this.fsm.minigameSettled(result);
            this.phaseTimer = 0;
            this.broadcastSync();
          }
        }
        break;
      case 'NodeSettle':
        this.phaseTimer += dt;
        if (this.phaseTimer >= 1.8) {
          this.activeMinigame?.dispose?.();
          this.activeMinigame = null;
          this.minigameBooting = false;
          const next = this.fsm.nodeIndex + 1;
          const hasMore = this.playlist.has(next);
          if (hasMore) {
            const nid = this.playlist.at(next)?.narrativeId ?? 'mx_gap';
            void this.beginNarrative(nid, false);
          } else {
            void this.beginNarrative('mx_finale', false);
          }
          this.fsm.settleDone(hasMore);
        }
        break;
      case 'CauldronCasting':
        this.tryHostResolveCast();
        break;
      default:
        break;
    }

    if (
      this.fsm.phase === 'MinigamePlay' ||
      this.fsm.phase === 'NarrativePlay' ||
      this.fsm.phase === 'LoadingCutscene'
    ) {
      this.render();
    }
  }

  private async beginNarrative(scriptId: string, distributeClues: boolean): Promise<void> {
    const script = await this.narrative.play(scriptId);
    if (distributeClues && this.isHost) {
      this.narrative.distributeClues(
        this.net,
        this.room.players.map((p) => p.id),
      );
    }
    // Solo / shorter demo: clamp very long scripts? Keep full duration from catalog.
    void script;
    this.broadcastSync();
    this.render();
  }

  private distributeCluesHost(): void {
    this.narrative.distributeClues(
      this.net,
      this.room.players.map((p) => p.id),
    );
  }

  private broadcastSync(): void {
    if (!this.isHost || this.mode === 'menu') return;
    const payload: MatchSyncPayload = {
      phase: this.fsm.phase,
      nodeIndex: this.fsm.nodeIndex,
      matchSeed: this.seed.matchSeed,
      room: {
        roomCode: this.room.roomCode,
        hostId: this.room.hostId,
        chapterId: this.room.chapterId,
        players: this.room.players.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          ready: p.ready,
          isHost: p.isHost,
          connected: p.connected,
        })),
      },
      roles: this.fsm.roleAssignment?.mapping,
      lastResult: this.fsm.lastMinigameResult ?? undefined,
      timeline: this.timeline.narrativeId
        ? {
            narrativeId: this.timeline.narrativeId,
            duration: this.timeline.duration,
            t: this.timeline.t,
            playing: this.timeline.playing,
          }
        : undefined,
    };
    // Attach sugar/ghost onto a side channel inside room players via match.sync extension:
    this.net.broadcast({
      type: 'match.sync',
      payload: {
        ...payload,
        room: {
          ...payload.room,
          players: this.room.players.map((p) => ({
            ...payload.room.players.find((x) => x.id === p.id)!,
            // cast through unknown fields for clients
            ...( { sugarCoat: p.sugarCoat, isGhost: p.isGhost, role: p.role } as object),
          })),
        },
      },
    });
  }

  private applySync(payload: MatchSyncPayload): void {
    if (this.isHost) return;
    this.seed = new SeedService(payload.matchSeed);
    this.room.applyRoster(payload.room);
    // restore sugar/role if present on roster rows
    for (const row of payload.room.players as Array<{
      id: string;
      sugarCoat?: number;
      isGhost?: boolean;
      role?: CandyRole;
    }>) {
      const p = this.room.find(row.id);
      if (!p) continue;
      if (typeof row.sugarCoat === 'number') p.sugarCoat = row.sugarCoat;
      if (typeof row.isGhost === 'boolean') p.isGhost = row.isGhost;
      if (row.role) p.role = row.role;
    }
    if (payload.roles) {
      this.fsm.roleAssignment = { mapping: payload.roles as Record<string, CandyRole>, seed: payload.matchSeed };
      for (const p of this.room.players) p.role = payload.roles[p.id] as CandyRole | undefined;
    }
    this.playlist = new NodePlaylist(getChapter(this.room.chapterId)!, true);
    this.fsm.nodeIndex = payload.nodeIndex;
    if (payload.timeline) {
      this.narrative.applyRemote(
        payload.timeline.narrativeId,
        payload.timeline.t,
        payload.timeline.playing,
      );
    }
    if (payload.lastResult) {
      this.fsm.lastMinigameResult = payload.lastResult as typeof this.fsm.lastMinigameResult;
    }
    const phase = payload.phase as MatchPhase;
    if (phase !== this.fsm.phase) {
      if (phase === 'CauldronCasting') {
        this.cast.clear();
        this.castConfirmedLocal = false;
        this.selected = [];
        this.hand = [];
      }
      this.fsm.forcePhase(phase, payload.nodeIndex);
      if (phase === 'MinigameLoad' || (phase === 'MinigamePlay' && !this.activeMinigame)) {
        void this.bootMinigameClient();
      }
    } else {
      this.fsm.nodeIndex = payload.nodeIndex;
    }
    this.render();
  }

  private async bootMinigameClient(): Promise<void> {
    if (this.activeMinigame || this.minigameBooting) return;
    const node = this.playlist.at(this.fsm.nodeIndex);
    if (!node) return;
    this.minigameBooting = true;
    try {
      const mg = createMinigame(node.minigameId);
      await mg.load(this.ctx());
      mg.start(this.seed.matchSeed ^ (this.fsm.nodeIndex + 1));
      this.activeMinigame = mg;
    } finally {
      this.minigameBooting = false;
    }
  }

  private async bootMinigame(): Promise<void> {
    if (this.activeMinigame || this.minigameBooting) return;
    const node = this.playlist.at(this.fsm.nodeIndex);
    if (!node) {
      this.fsm.settleDone(false);
      return;
    }
    this.minigameBooting = true;
    try {
      const mg = createMinigame(node.minigameId);
      await mg.load(this.ctx());
      mg.start(this.seed.matchSeed ^ (this.fsm.nodeIndex + 1));
      this.activeMinigame = mg;
      this.fsm.minigameReady();
      this.render();
    } finally {
      this.minigameBooting = false;
    }
  }

  private wireNet(net: NetHost): void {
    this.unsubNet?.();
    this.net = net;
    this.sync = new SnapshotSync(net);
    this.privacy = new PrivacyChannel(net);
    this.unsubNet = net.on((ev) => this.onNetEvent(ev));
  }

  private onNetEvent(ev: NetEvent): void {
    switch (ev.type) {
      case 'room.roster':
        if (this.mode === 'party') {
          this.room.applyRoster(ev.payload);
          this.render();
        }
        break;
      case 'match.sync':
        this.applySync(ev.payload);
        break;
      case 'match.roles':
        if (!this.isHost) {
          this.fsm.roleAssignment = {
            mapping: ev.mapping as Record<string, CandyRole>,
            seed: ev.seed,
          };
          for (const p of this.room.players) {
            p.role = ev.mapping[p.id] as CandyRole | undefined;
          }
          this.render();
        }
        break;
      case 'cast.submit':
        if (this.isHost && this.fsm.phase === 'CauldronCasting') {
          this.cast.submit(ev.playerId, ev.cardIds, performance.now());
          this.tryHostResolveCast();
        }
        break;
      case 'privacy.clue':
        if (ev.clue.targetPlayerId === this.localId) {
          this.privateClue = ev.clue.body;
          this.render();
        }
        break;
      default:
        break;
    }
  }

  private tryHostResolveCast(): void {
    if (!this.isHost || this.fsm.phase !== 'CauldronCasting') return;
    const ids = this.room.players.map((p) => p.id);
    if (!this.cast.allConfirmed(ids)) return;
    const classified = this.classifier.classifyAll(this.cast.list());
    const assignment = this.allocator.allocate(ids, classified, this.seed);
    for (const p of this.room.players) p.role = assignment.mapping[p.id];
    this.net.broadcast({ type: 'match.roles', mapping: assignment.mapping, seed: assignment.seed });
    this.phaseTimer = 0;
    this.fsm.castingDone(assignment);
    this.broadcastSync();
    this.render();
  }

  private async handleAction(id: string): Promise<void> {
    switch (id) {
      case 'menu_create':
        await this.startPartyCreate();
        break;
      case 'menu_join':
        await this.startPartyJoin();
        break;
      case 'menu_solo':
        this.startSolo();
        break;
      case 'ready_toggle': {
        const me = this.room.find(this.localId);
        if (!me) break;
        const next = !me.ready;
        if (this.party) this.party.setReady(next);
        else {
          this.room.setReady(me.id, next);
          this.render();
        }
        break;
      }
      case 'start':
        if (!this.isHost || !this.room.canStart()) return;
        this.sugar.reset(this.room);
        this.playlist = new NodePlaylist(getChapter(this.room.chapterId)!, true);
        this.seed = new SeedService();
        this.phaseTimer = 0;
        this.cast.clear();
        this.castConfirmedLocal = false;
        this.selected = [];
        this.hand = [];
        this.privateClue = '';
        this.fsm.startMatch();
        this.broadcastSync();
        this.render();
        break;
      case 'skip_cutscene':
        if (this.isHost && this.fsm.phase === 'LoadingCutscene') this.fsm.cutsceneDone();
        break;
      case 'confirm_cast':
        this.confirmCastLocal();
        break;
      case 'skip_narrative':
        if (this.isHost) this.narrative.skip();
        break;
      case 'restart':
        if (!this.isHost) break;
        this.resetMatchKeepRoom();
        this.fsm.restartMatch();
        this.broadcastSync();
        break;
      case 'lobby':
        if (!this.isHost) break;
        this.resetMatchKeepRoom();
        this.fsm.backToLobby();
        this.broadcastSync();
        this.render();
        break;
      case 'leave_room':
        this.leaveToMenu();
        break;
      default:
        if (id.startsWith('card:')) this.toggleCard(id.slice(5));
        else if (id.startsWith('chapter:') && this.isHost) {
          const ch = getChapter(id.slice(8));
          if (ch?.unlocked) {
            this.room.setChapter(ch);
            this.party?.setChapter(ch.id);
            this.render();
          }
        } else if (id.startsWith('name:')) {
          this.displayName = id.slice(5) || '玩家';
        }
        break;
    }
  }

  private resetMatchKeepRoom(): void {
    this.activeMinigame?.dispose?.();
    this.activeMinigame = null;
    this.minigameBooting = false;
    this.selected = [];
    this.hand = [];
    this.privateClue = '';
    this.castConfirmedLocal = false;
    this.cast.clear();
    this.sugar.reset(this.room);
    this.phaseTimer = 0;
  }

  private leaveToMenu(): void {
    this.resetMatchKeepRoom();
    this.unsubNet?.();
    this.party?.dispose();
    this.party = null;
    this.mode = 'menu';
    this.net = new LocalLoopbackNet('local', true);
    this.sync = new SnapshotSync(this.net);
    this.room.players = [];
    this.room.hostId = '';
    this.room.roomCode = '';
    this.fsm.backToLobby();
    this.statusLine = '已离开房间';
    this.netStatus = '';
    this.render();
  }

  private startSolo(): void {
    this.party?.dispose();
    this.party = null;
    this.mode = 'solo';
    const room = new RoomState({ hostName: this.displayName || '你' });
    room.fillBots(4);
    room.setReady(room.hostId, true);
    this.room.roomCode = room.roomCode;
    this.room.hostId = room.hostId;
    this.room.chapterId = room.chapterId;
    this.room.players = room.players;
    this.wireNet(new LocalLoopbackNet(room.hostId, true));
    this.statusLine = `单机 Bot 房 ${room.roomCode}`;
    this.netStatus = 'loopback';
    this.fsm.backToLobby();
    this.render();
  }

  private async startPartyCreate(): Promise<void> {
    this.statusLine = '正在创建房间…';
    this.render();
    try {
      const party = new PartyNet();
      party.onError((msg) => {
        this.statusLine = msg;
        this.render();
      });
      party.onRoster((info) => {
        this.netStatus = info.transport;
        this.statusLine = `房间 ${info.roomCode} · ${info.isHost ? '房主' : '成员'} · ${info.transport}`;
        this.render();
      });
      const info = await party.createRoom(this.displayName || '房主');
      this.party = party;
      this.mode = 'party';
      this.wireNet(party);
      this.room.roomCode = info.roomCode;
      this.room.hostId = info.hostId;
      this.room.chapterId = info.chapterId;
      this.netStatus = info.transport;
      this.statusLine = `已建房 ${info.roomCode} — 把房间码发给另外 1～3 人`;
      this.fsm.backToLobby();
      this.render();
    } catch (e) {
      this.statusLine = (e as Error).message;
      this.render();
    }
  }

  private async startPartyJoin(): Promise<void> {
    const code = this.joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      this.statusLine = '请输入 4 位房间码';
      this.render();
      return;
    }
    this.statusLine = `正在加入 ${code}…`;
    this.render();
    try {
      const party = new PartyNet();
      party.onError((msg) => {
        this.statusLine = msg;
        this.render();
      });
      party.onRoster((info) => {
        this.netStatus = info.transport;
        this.statusLine = `房间 ${info.roomCode} · 成员 · ${info.transport}`;
        this.render();
      });
      const info = await party.joinRoom(code, this.displayName || '玩家');
      this.party = party;
      this.mode = 'party';
      this.wireNet(party);
      this.room.roomCode = info.roomCode;
      this.room.hostId = info.hostId;
      this.room.chapterId = info.chapterId;
      this.netStatus = info.transport;
      this.statusLine = `已加入 ${info.roomCode}`;
      this.fsm.backToLobby();
      this.render();
    } catch (e) {
      this.statusLine = (e as Error).message;
      this.render();
    }
  }

  private toggleCard(cardId: string): void {
    if (this.castConfirmedLocal) return;
    if (this.selected.includes(cardId)) {
      this.selected = this.selected.filter((x) => x !== cardId);
    } else if (this.selected.length < 3) {
      this.selected.push(cardId);
    }
    this.render();
  }

  private confirmCastLocal(): void {
    if (this.selected.length !== 3 || this.castConfirmedLocal) return;
    this.castConfirmedLocal = true;
    const cardIds = this.selected as [string, string, string];
    if (this.isHost) {
      this.cast.submit(this.localId, cardIds, performance.now());
      // Solo bots auto-submit
      if (this.mode === 'solo') {
        const pick3 = (offset: number): [string, string, string] => {
          const pool = this.deck.cards;
          return [
            pool[offset % pool.length]!.id,
            pool[(offset + 1) % pool.length]!.id,
            pool[(offset + 2) % pool.length]!.id,
          ];
        };
        this.room.players.forEach((p, i) => {
          if (p.id === this.localId) return;
          this.cast.submit(p.id, pick3(i * 3), performance.now() + i);
        });
      }
      this.tryHostResolveCast();
    } else {
      this.net.broadcast({ type: 'cast.submit', playerId: this.localId, cardIds });
    }
    this.render();
  }

  private render(): void {
    if (this.mode === 'menu') {
      this.hud.setPhase('Lobby', '联机大厅');
      this.hud.setBody(
        `<div style="font-size:18px;font-weight:700;margin-bottom:10px">今晚别变回人 · 四人联机</div>` +
          `<div style="opacity:.85;margin-bottom:12px">${this.statusLine}</div>` +
          `<label style="display:block;margin-bottom:8px">昵称<br/>` +
          `<input id="tnh-name" value="${escapeHtml(this.displayName)}" maxlength="24" ` +
          `style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff"/></label>` +
          `<label style="display:block;margin-bottom:8px">房间码（加入时）<br/>` +
          `<input id="tnh-code" value="${escapeHtml(this.joinCode)}" maxlength="4" placeholder="AB12" ` +
          `style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff;letter-spacing:.2em;text-transform:uppercase"/></label>` +
          `<div style="opacity:.65;font-size:12px;margin-top:8px">四开浏览器 / 无痕窗口 → 一方「创建房间」，其余输入房间码「加入」。Studio 需已加载 /ws/party 信令。</div>`,
      );
      this.hud.setActions([
        { id: 'menu_create', label: '创建房间', primary: true },
        { id: 'menu_join', label: '加入房间' },
        { id: 'menu_solo', label: '单机 Bot' },
      ]);
      queueMicrotask(() => this.bindMenuInputs());
      return;
    }

    const phase = this.fsm.phase;
    const node = this.playlist.at(this.fsm.nodeIndex);
    const transport = this.party ? ` · ${this.netStatus || this.party.transport}` : this.mode === 'solo' ? ' · solo' : '';
    this.hud.setPhase(
      phase,
      (node && (phase === 'MinigamePlay' || phase === 'MinigameLoad' || phase === 'NodeSettle')
        ? `${node.id} ${node.title}`
        : this.room.roomCode) + transport,
    );

    if (phase === 'Lobby') {
      this.hud.setRoom(this.room, CHAPTER_CATALOG);
      const chapterBtns = CHAPTER_CATALOG.map((c) => ({
        id: `chapter:${c.id}`,
        label: c.unlocked ? c.title : `${c.title}（锁）`,
        disabled: !c.unlocked || !this.isHost,
        primary: c.id === this.room.chapterId,
      }));
      const me = this.room.find(this.localId);
      this.hud.setActions([
        ...chapterBtns,
        { id: 'ready_toggle', label: me?.ready ? '取消准备' : '准备' },
        {
          id: 'start',
          label: '开始',
          primary: true,
          disabled: !this.isHost || !this.room.canStart(),
        },
        { id: 'leave_room', label: '离开' },
      ]);
      return;
    }

    if (phase === 'LoadingCutscene') {
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${this.dm.line('welcome')}</div>` +
          `<div>坠入糖果裂隙…… ${this.isHost ? `${(Math.min(1, this.phaseTimer / 2.5) * 100) | 0}%` : '跟随房主…'}</div>`,
      );
      this.hud.setActions(this.isHost ? [{ id: 'skip_cutscene', label: '跳过' }] : []);
      return;
    }

    if (phase === 'CauldronCasting') {
      if (this.hand.length === 0) this.hand = this.deck.hand(12);
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:6px">${this.dm.line('cast')}</div>` +
          `<div style="opacity:.8;margin-bottom:8px">选 3 张材料卡（${this.selected.length}/3）` +
          `${this.castConfirmedLocal ? ' · 已提交，等待全员…' : ''}</div>`,
      );
      this.hud.setActions([
        ...this.hand.map((c) => ({
          id: `card:${c.id}`,
          label: this.selected.includes(c.id) ? `✓ ${c.name}` : c.name,
          disabled: this.castConfirmedLocal,
        })),
        {
          id: 'confirm_cast',
          label: '投入坩埚',
          primary: true,
          disabled: this.selected.length !== 3 || this.castConfirmedLocal,
        },
      ]);
      return;
    }

    if (phase === 'RoleReveal') {
      const mine = this.room.find(this.localId)?.role;
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${this.dm.line('reveal')}</div>` +
          `<div style="font-size:28px;margin:12px 0">${mine ? ROLE_LABELS[mine] : '…'}</div>` +
          `<div style="opacity:.75">四型强制各一 · 随机分配（不是谁投谁得）</div>`,
      );
      this.hud.setActions([]);
      return;
    }

    if (phase === 'NarrativePlay' || phase === 'FinaleNarrative') {
      const script = this.narrative.script ?? requireNarrativeScript(this.timeline.narrativeId ?? 'mx_gap');
      const line = this.narrative.currentLine() || this.dm.line(phase === 'FinaleNarrative' ? 'finale' : 'welcome');
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${script.title}</div>` +
          `<div style="margin-bottom:6px">${line}</div>` +
          `<div>影游进度 ${(this.timeline.progress * 100) | 0}% · ${script.durationSec | 0}s</div>` +
          `<div style="opacity:.6;font-size:12px;margin-top:6px">脚本 ${script.id} · 媒体 ${script.mediaRoot}</div>` +
          (this.privateClue
            ? `<div style="margin-top:12px;padding:10px;border-radius:10px;background:rgba(80,40,20,.55);border:1px solid rgba(255,180,100,.35)"><b>私密线索（仅你可见）</b><br/>${this.privateClue}</div>`
            : ''),
      );
      this.hud.setActions(this.isHost ? [{ id: 'skip_narrative', label: '跳过' }] : []);
      return;
    }

    if (phase === 'MinigameLoad' || phase === 'MinigamePlay') {
      const stub = this.activeMinigame instanceof StubMinigame ? this.activeMinigame : null;
      const lib = node ? getLibraryEntry(node.minigameId) : undefined;
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${lib?.title ?? node?.title ?? '小游戏'}</div>` +
          `<div style="opacity:.8;margin-bottom:6px">${lib?.oneLiner ?? `类型：${node?.type ?? '?'}`}</div>` +
          `<div>进度 ${stub ? ((stub.progress * 100) | 0) : 0}%</div>` +
          `<div style="opacity:.6;font-size:12px;margin-top:6px">库 ${lib?.id ?? '?'} · ${lib?.status ?? '?'} · 素材 ${lib?.contentRoot ?? ''}</div>`,
      );
      this.hud.setActions([]);
      return;
    }

    if (phase === 'NodeSettle') {
      const result = this.fsm.lastMinigameResult;
      const rows = this.room.players
        .map((p) => {
          const d = result?.sugarDelta[p.id] ?? 0;
          const sign = d > 0 ? `+${d}` : `${d}`;
          return `${p.displayName}：糖衣 ${p.sugarCoat}（${sign}）${p.isGhost ? ' · 幽灵' : ''}`;
        })
        .join('\n');
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${this.dm.line('settle')}</div>` +
          `<pre style="margin:0;font:inherit;opacity:.9">${rows}</pre>`,
      );
      this.hud.setActions([]);
      return;
    }

    if (phase === 'MatchResult') {
      const score = this.scoreboard.build(this.room.players, this.fsm.roleAssignment, this.ghost);
      const rows = score.personal
        .map(
          (p) =>
            `${p.name} · ${p.role ?? '—'} · 糖衣${p.sugarCoat} · ${p.title}${p.isGhost ? ` · 捣蛋${p.mischief}` : ''}`,
        )
        .join('\n');
      this.hud.setBody(
        `<div style="font-size:16px;font-weight:700;margin-bottom:8px">天亮了 · 存活 ${score.aliveCount}/${this.room.players.length}</div>` +
          `<pre style="margin:0 0 10px;font:inherit">${rows}</pre>` +
          `<div style="opacity:.8">${score.funLine}</div>`,
      );
      this.hud.setActions(
        this.isHost
          ? [
              { id: 'restart', label: '再来一局', primary: true },
              { id: 'lobby', label: '回大厅' },
              { id: 'leave_room', label: '离开房间' },
            ]
          : [{ id: 'leave_room', label: '离开房间' }],
      );
    }
  }

  private bindMenuInputs(): void {
    const name = this.uiHost.querySelector('#tnh-name') as HTMLInputElement | null;
    const code = this.uiHost.querySelector('#tnh-code') as HTMLInputElement | null;
    if (name) {
      name.oninput = () => {
        this.displayName = name.value.slice(0, 24);
      };
    }
    if (code) {
      code.oninput = () => {
        this.joinCode = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        code.value = this.joinCode;
      };
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
