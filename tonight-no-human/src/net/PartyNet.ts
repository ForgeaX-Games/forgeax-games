import type { NetEvent, NetHandler, NetHost, RoomRosterPayload } from './NetHost';
import type { PlayerId } from '../shared/types';

type SignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

type WelcomeMsg = {
  type: 'welcome';
  roomCode: string;
  playerId: string;
  isHost: boolean;
  hostId: string;
  chapterId: string;
  roster: RoomRosterPayload['players'];
};

type ServerMsg =
  | WelcomeMsg
  | { type: 'roster'; hostId: string; chapterId: string; roster: RoomRosterPayload['players'] }
  | { type: 'signal'; from: string; payload: SignalPayload }
  | { type: 'relay'; from: string; event: NetEvent }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export type PartyConnectionInfo = {
  roomCode: string;
  playerId: PlayerId;
  isHost: boolean;
  hostId: PlayerId;
  chapterId: string;
  transport: 'webrtc' | 'relay' | 'connecting';
};

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const DC_LABEL = 'tnh-game';
const RTC_TIMEOUT_MS = 4000;

function partyWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/party`;
}

/**
 * Real multiplayer NetHost:
 * - Signaling via Studio `/ws/party` (create / join / roster / ICE)
 * - Prefer WebRTC DataChannel (star: every client ↔ host)
 * - Fall back to WS relay if DC not ready (still directed `to` for privacy)
 */
export class PartyNet implements NetHost {
  localPlayerId: PlayerId = '';
  isHost = false;
  roomCode = '';
  hostId: PlayerId = '';
  chapterId = 'chapter_mx';
  transport: PartyConnectionInfo['transport'] = 'connecting';

  private ws: WebSocket | null = null;
  private handlers = new Set<NetHandler>();
  private rosterHandlers = new Set<(info: PartyConnectionInfo, roster: RoomRosterPayload) => void>();
  private errorHandlers = new Set<(msg: string) => void>();
  private pcs = new Map<PlayerId, RTCPeerConnection>();
  private dcs = new Map<PlayerId, RTCDataChannel>();
  private makingOffer = new Set<PlayerId>();
  private remoteIds = new Set<PlayerId>();
  private disposed = false;

  on(handler: NetHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onRoster(handler: (info: PartyConnectionInfo, roster: RoomRosterPayload) => void): () => void {
    this.rosterHandlers.add(handler);
    return () => this.rosterHandlers.delete(handler);
  }

  onError(handler: (msg: string) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  async createRoom(displayName: string, chapterId = 'chapter_mx'): Promise<PartyConnectionInfo> {
    await this.connectWs();
    this.wsSend({ type: 'create', displayName, chapterId });
    return this.waitWelcome();
  }

  async joinRoom(roomCode: string, displayName: string): Promise<PartyConnectionInfo> {
    await this.connectWs();
    this.wsSend({ type: 'join', roomCode: roomCode.trim().toUpperCase(), displayName });
    return this.waitWelcome();
  }

  setReady(ready: boolean): void {
    this.wsSend({ type: 'ready', ready });
  }

  setChapter(chapterId: string): void {
    if (!this.isHost) return;
    this.wsSend({ type: 'chapter', chapterId });
  }

  send(ev: NetEvent, opts?: { to?: PlayerId }): void {
    if (opts?.to && opts.to === this.localPlayerId) {
      this.emitLocal(ev);
      return;
    }
    if (opts?.to) {
      this.deliver(opts.to, ev);
      return;
    }
    this.broadcast(ev);
  }

  broadcast(ev: NetEvent): void {
    this.emitLocal(ev);
    if (this.isHost) {
      for (const peerId of this.remoteIds) {
        this.deliver(peerId, ev, true);
      }
    } else if (this.hostId) {
      this.deliver(this.hostId, ev, true);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const dc of this.dcs.values()) {
      try {
        dc.close();
      } catch {
        /* ignore */
      }
    }
    for (const pc of this.pcs.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    this.dcs.clear();
    this.pcs.clear();
    this.remoteIds.clear();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try {
        this.wsSend({ type: 'leave' });
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
  }

  private deliver(to: PlayerId, ev: NetEvent, skipLocal = false): void {
    if (!skipLocal && to === this.localPlayerId) {
      this.emitLocal(ev);
      return;
    }
    const dc = this.dcs.get(to);
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify(ev));
        this.transport = 'webrtc';
        return;
      } catch {
        /* fall through to relay */
      }
    }
    this.wsSend({ type: 'relay', to, event: ev });
    if (this.transport === 'connecting') this.transport = 'relay';
  }

  private emitLocal(ev: NetEvent): void {
    for (const h of this.handlers) h(ev);
  }

  private connectWs(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(partyWsUrl());
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('信令连接超时')), 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('无法连接 /ws/party — 请确认 Studio 已重启加载联机信令'));
      };
      ws.onmessage = (e) => this.onWsMessage(String(e.data));
      ws.onclose = () => {
        if (!this.disposed) {
          for (const h of this.errorHandlers) h('信令断开');
        }
      };
    });
  }

  private waitWelcome(): Promise<PartyConnectionInfo> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('进房超时')), 8000);
      const off = this.onRoster((info) => {
        clearTimeout(timer);
        off();
        resolve(info);
      });
      const offErr = this.onError((msg) => {
        clearTimeout(timer);
        off();
        offErr();
        reject(new Error(msg));
      });
    });
  }

  private wsSend(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private onWsMessage(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.applyWelcome(msg);
        break;
      case 'roster':
        this.applyRoster(msg.hostId, msg.chapterId, msg.roster);
        break;
      case 'signal':
        void this.onSignal(msg.from, msg.payload);
        break;
      case 'relay':
        if (msg.event) this.emitLocal(msg.event);
        this.transport = 'relay';
        break;
      case 'error':
        for (const h of this.errorHandlers) h(msg.message);
        break;
      default:
        break;
    }
  }

  private applyWelcome(msg: WelcomeMsg): void {
    this.localPlayerId = msg.playerId;
    this.isHost = msg.isHost;
    this.roomCode = msg.roomCode;
    this.hostId = msg.hostId;
    this.chapterId = msg.chapterId;
    this.applyRoster(msg.hostId, msg.chapterId, msg.roster);
    // Non-host starts RTC toward host.
    if (!this.isHost && this.hostId && this.hostId !== this.localPlayerId) {
      void this.ensurePeer(this.hostId, /*polite*/ true);
    }
  }

  private applyRoster(hostId: string, chapterId: string, roster: RoomRosterPayload['players']): void {
    this.hostId = hostId;
    this.chapterId = chapterId;
    this.isHost = this.localPlayerId === hostId;
    this.remoteIds = new Set(roster.map((p) => p.id).filter((id) => id !== this.localPlayerId));
    const payload: RoomRosterPayload = {
      roomCode: this.roomCode,
      hostId,
      chapterId,
      players: roster,
    };
    const info: PartyConnectionInfo = {
      roomCode: this.roomCode,
      playerId: this.localPlayerId,
      isHost: this.isHost,
      hostId,
      chapterId,
      transport: this.transport,
    };
    for (const h of this.rosterHandlers) h(info, payload);
    this.emitLocal({ type: 'room.roster', payload });

    // Host opens DC to every remote peer.
    if (this.isHost) {
      for (const peerId of this.remoteIds) {
        void this.ensurePeer(peerId, /*polite*/ false);
      }
    }
  }

  private async ensurePeer(peerId: PlayerId, polite: boolean): Promise<void> {
    if (this.pcs.has(peerId) || peerId === this.localPlayerId) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pcs.set(peerId, pc);

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      this.wsSend({
        type: 'signal',
        to: peerId,
        payload: { kind: 'ice', candidate: ev.candidate.toJSON() } satisfies SignalPayload,
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.teardownPeer(peerId);
      }
    };

    if (!polite) {
      // Host creates the data channel.
      const dc = pc.createDataChannel(DC_LABEL, { ordered: true });
      this.bindDc(peerId, dc);
      this.makingOffer.add(peerId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.wsSend({
          type: 'signal',
          to: peerId,
          payload: { kind: 'offer', sdp: offer } satisfies SignalPayload,
        });
      } finally {
        this.makingOffer.delete(peerId);
      }
    } else {
      // Client waits for host offer; also accept inbound DC.
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === DC_LABEL) this.bindDc(peerId, ev.channel);
      };
    }

    // If DC never opens, stay on relay (already works).
    window.setTimeout(() => {
      const dc = this.dcs.get(peerId);
      if (!dc || dc.readyState !== 'open') {
        this.transport = 'relay';
      }
    }, RTC_TIMEOUT_MS);
  }

  private bindDc(peerId: PlayerId, dc: RTCDataChannel): void {
    this.dcs.set(peerId, dc);
    dc.onopen = () => {
      this.transport = 'webrtc';
    };
    dc.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as NetEvent;
        this.emitLocal(msg);
      } catch {
        /* ignore */
      }
    };
    dc.onclose = () => {
      this.dcs.delete(peerId);
    };
  }

  private async onSignal(from: PlayerId, payload: SignalPayload): Promise<void> {
    if (!this.pcs.has(from)) {
      // Inbound offer before ensurePeer — create polite PC.
      await this.ensurePeer(from, /*polite*/ true);
    }
    const pc = this.pcs.get(from);
    if (!pc) return;

    if (payload.kind === 'offer') {
      await pc.setRemoteDescription(payload.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.wsSend({
        type: 'signal',
        to: from,
        payload: { kind: 'answer', sdp: answer } satisfies SignalPayload,
      });
      return;
    }
    if (payload.kind === 'answer') {
      await pc.setRemoteDescription(payload.sdp);
      return;
    }
    if (payload.kind === 'ice') {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        /* ignore */
      }
    }
  }

  private teardownPeer(peerId: PlayerId): void {
    const dc = this.dcs.get(peerId);
    if (dc) {
      try {
        dc.close();
      } catch {
        /* ignore */
      }
      this.dcs.delete(peerId);
    }
    const pc = this.pcs.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      this.pcs.delete(peerId);
    }
  }
}
