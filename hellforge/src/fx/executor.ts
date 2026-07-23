// EffectExecutor — pooled EffectDef runtime (PR2b T2).
// Pure bookkeeping + injectable FxSpawnPort; no World/renderer imports.

import { assertEffectBudget, checkEffectBudget } from './budget';
import type {
  EffectColor,
  EffectDef,
  EmitterDef,
  EmitterKind,
  SubEmitterDef,
} from './effect-def';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Opaque acquisition token. Internal instance slots are recycled, but tokens
 * are never reused, so a stale release cannot target a new slot occupant.
 */
export type EffectHandle = number;

/**
 * Ownership token for particles spawned by one port call.
 * `dispose` is exactly-once and must reclaim presentation resources.
 */
export interface FxSpawnLease {
  dispose(): void;
}

/** Presentation bridge — production maps to FxSystem; tests use a recorder. */
export interface FxSpawnPort {
  burst(
    x: number, y: number, z: number,
    color: EffectColor, count?: number, speed?: number,
  ): FxSpawnLease;
  pop(
    x: number, y: number, z: number,
    color: EffectColor, size?: number,
  ): FxSpawnLease;
  rise(
    x: number, y: number, z: number,
    color: EffectColor, count?: number, spread?: number,
  ): FxSpawnLease;
}

export interface EffectExecutorStats {
  activeEffects: number;
  activeEmitters: number;
  activeParticles: number;
  activeTrails: number;
  peakEffects: number;
  peakEmitters: number;
  peakParticles: number;
  peakTrails: number;
  budgetRejects: number;
}

interface EmitterInstance {
  readonly defId: string;
  readonly def: EmitterDef;
  age: number;
  life: number;
  dead: boolean;
}

interface SubEmitterState {
  readonly def: SubEmitterDef;
  fired: boolean;
}

interface EffectInstance {
  readonly handle: EffectHandle;
  readonly slot: number;
  readonly def: EffectDef;
  readonly origin: Vec3;
  readonly emitters: EmitterInstance[];
  readonly subs: SubEmitterState[];
  /** Presentation leases from every spawn in this ownership tree. */
  readonly leases: FxSpawnLease[];
  trailSlots: number;
  released: boolean;
}

const DEFAULT_LIFE: Record<EmitterKind, number> = {
  burst: 0.7,
  pop: 0.16,
  rise: 1.5,
  custom: 0.5,
};

function childEmitterIds(def: EffectDef): Set<string> {
  const ids = new Set<string>();
  for (const s of def.subEmitters) ids.add(s.childEmitterId);
  return ids;
}

function emitterById(def: EffectDef, id: string): EmitterDef | undefined {
  for (const e of def.emitters) {
    if (e.id === id) return e;
  }
  return undefined;
}

/**
 * Runs EffectDefs against pooled instance slots with deterministic
 * acquire/release and a sub-emitter ownership tree (exactly-once release).
 */
export class EffectExecutor {
  private readonly port: FxSpawnPort;
  private readonly slots: Array<EffectInstance | undefined> = [];
  private readonly slotByHandle = new Map<EffectHandle, number>();
  private readonly freeSlots: number[] = [];
  private nextHandle = 1;

  private activeEmitters = 0;
  private activeParticles = 0;
  private activeTrails = 0;
  private peakEffects = 0;
  private peakEmitters = 0;
  private peakParticles = 0;
  private peakTrails = 0;
  private budgetRejects = 0;

  constructor(port: FxSpawnPort) {
    this.port = port;
  }

  /**
   * Acquire an effect instance.
   * Over-budget: throws in dev (FX_DEV_ASSERTS); production soft-rejects null
   * and increments budgetRejects so gameplay never crashes.
   */
  play(def: EffectDef, origin: Vec3): EffectHandle | null {
    assertEffectBudget(def);
    if (!checkEffectBudget(def).ok) {
      this.budgetRejects++;
      return null;
    }

    const { handle, slot } = this.allocHandle();
    const inst: EffectInstance = {
      handle,
      slot,
      def,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      emitters: [],
      subs: def.subEmitters.map((s) => ({ def: s, fired: false })),
      leases: [],
      trailSlots: def.trails.length,
      released: false,
    };
    this.slots[slot] = inst;
    this.slotByHandle.set(handle, slot);

    try {
      this.activeTrails += inst.trailSlots;
      this.notePeaks();

      const children = childEmitterIds(def);
      for (const e of def.emitters) {
        if (children.has(e.id)) continue;
        this.spawnEmitter(inst, e);
      }

      this.notePeaks();
      return handle;
    } catch (error) {
      this.release(handle);
      throw error;
    }
  }

  /** Advance ages; fire atAge / onDeath sub-emitters; auto-release when done. */
  tick(dt: number): void {
    if (dt <= 0 || this.slotByHandle.size === 0) return;

    const toAutoRelease: EffectHandle[] = [];
    const activeAtStart = [...this.slotByHandle.keys()];

    for (const handle of activeAtStart) {
      const inst = this.instanceFor(handle);
      if (!inst || inst.released) continue;

      // Children born during this tick start at age 0 on the next tick.
      const emittersAtStart = [...inst.emitters];
      for (const em of emittersAtStart) {
        if (inst.released) break;
        if (em.dead) continue;

        const prevAge = em.age;
        em.age += dt;

        this.fireAtAge(inst, em, prevAge);

        if (!inst.released && em.age >= em.life) {
          this.killEmitter(inst, em);
        }
      }

      if (!inst.released && this.isTreeDone(inst)) {
        toAutoRelease.push(inst.handle);
      }
    }

    for (const h of toAutoRelease) this.release(h);
  }

  /**
   * Release an effect and its entire ownership tree exactly once.
   * Double-release / unknown handle is a safe no-op.
   */
  release(handle: EffectHandle): void {
    const inst = this.instanceFor(handle);
    if (!inst || inst.released) return;

    inst.released = true;

    // Reclaim presentation first so a dispose throw cannot strand bookkeeping
    // without a retry path — leases are exactly-once themselves.
    for (const lease of inst.leases) lease.dispose();
    inst.leases.length = 0;

    for (const em of inst.emitters) {
      if (!em.dead) {
        em.dead = true;
        this.activeEmitters--;
        this.activeParticles -= em.def.count;
      }
    }
    inst.emitters.length = 0;

    this.activeTrails -= inst.trailSlots;
    inst.trailSlots = 0;
    inst.subs.length = 0;

    this.slotByHandle.delete(handle);
    this.slots[inst.slot] = undefined;
    this.freeSlots.push(inst.slot);

    if (this.activeEmitters < 0) this.activeEmitters = 0;
    if (this.activeParticles < 0) this.activeParticles = 0;
    if (this.activeTrails < 0) this.activeTrails = 0;
  }

  /** Release every active instance (combat-run / area reset). */
  releaseAll(): void {
    const handles = [...this.slotByHandle.keys()];
    for (const h of handles) this.release(h);
  }

  activeCount(): number {
    return this.slotByHandle.size;
  }

  stats(): EffectExecutorStats {
    return {
      activeEffects: this.slotByHandle.size,
      activeEmitters: this.activeEmitters,
      activeParticles: this.activeParticles,
      activeTrails: this.activeTrails,
      peakEffects: this.peakEffects,
      peakEmitters: this.peakEmitters,
      peakParticles: this.peakParticles,
      peakTrails: this.peakTrails,
      budgetRejects: this.budgetRejects,
    };
  }

  private allocHandle(): { handle: EffectHandle; slot: number } {
    const slot = this.freeSlots.pop() ?? this.slots.length;
    return { handle: this.nextHandle++, slot };
  }

  private instanceFor(handle: EffectHandle): EffectInstance | undefined {
    const slot = this.slotByHandle.get(handle);
    if (slot === undefined) return undefined;
    const inst = this.slots[slot];
    return inst?.handle === handle ? inst : undefined;
  }

  private spawnEmitter(inst: EffectInstance, edef: EmitterDef): void {
    if (inst.released) return;

    const life = edef.life ?? DEFAULT_LIFE[edef.kind];
    const em: EmitterInstance = {
      defId: edef.id,
      def: edef,
      age: 0,
      life,
      dead: false,
    };
    inst.emitters.push(em);
    this.activeEmitters++;
    this.activeParticles += edef.count;
    this.notePeaks();
    this.present(inst, edef, inst.origin);
    this.fireOnSpawn(inst, edef.id);
  }

  private killEmitter(inst: EffectInstance, em: EmitterInstance): void {
    if (em.dead) return;
    em.dead = true;
    this.activeEmitters--;
    this.activeParticles -= em.def.count;
    this.fireOnDeath(inst, em.defId);
  }

  private fireOnSpawn(inst: EffectInstance, parentId: string): void {
    for (const sub of inst.subs) {
      if (sub.fired || sub.def.trigger !== 'onSpawn') continue;
      if (sub.def.parentEmitterId !== parentId) continue;
      this.fireSub(inst, sub);
    }
  }

  private fireOnDeath(inst: EffectInstance, parentId: string): void {
    for (const sub of inst.subs) {
      if (sub.fired || sub.def.trigger !== 'onDeath') continue;
      if (sub.def.parentEmitterId !== parentId) continue;
      this.fireSub(inst, sub);
    }
  }

  private fireAtAge(inst: EffectInstance, em: EmitterInstance, prevAge: number): void {
    for (const sub of inst.subs) {
      if (sub.fired || sub.def.trigger !== 'atAge') continue;
      if (sub.def.parentEmitterId !== em.defId) continue;
      const at = sub.def.atAge ?? 0;
      if (at <= em.life && prevAge <= at && em.age >= at) {
        this.fireSub(inst, sub);
      }
    }
  }

  private fireSub(inst: EffectInstance, sub: SubEmitterState): void {
    if (sub.fired || inst.released) return;
    sub.fired = true;
    const child = emitterById(inst.def, sub.def.childEmitterId);
    if (!child) return;
    this.spawnEmitter(inst, child);
  }

  private present(inst: EffectInstance, edef: EmitterDef, origin: Vec3): void {
    let lease: FxSpawnLease | null = null;
    switch (edef.kind) {
      case 'burst':
        lease = this.port.burst(origin.x, origin.y, origin.z, edef.color, edef.count, edef.speed);
        break;
      case 'pop':
        lease = this.port.pop(origin.x, origin.y, origin.z, edef.color, edef.size);
        break;
      case 'rise':
        lease = this.port.rise(
          origin.x, origin.y, origin.z, edef.color, edef.count, edef.spread,
        );
        break;
      case 'custom':
        // Escape hatch — no presentation in T2; T3 may bind customStep hooks.
        break;
    }
    if (lease) inst.leases.push(lease);
  }

  private isTreeDone(inst: EffectInstance): boolean {
    if (inst.emitters.length === 0) return true;
    for (const em of inst.emitters) {
      if (!em.dead) return false;
    }
    return true;
  }

  private notePeaks(): void {
    if (this.slotByHandle.size > this.peakEffects) this.peakEffects = this.slotByHandle.size;
    if (this.activeEmitters > this.peakEmitters) this.peakEmitters = this.activeEmitters;
    if (this.activeParticles > this.peakParticles) this.peakParticles = this.activeParticles;
    if (this.activeTrails > this.peakTrails) this.peakTrails = this.activeTrails;
  }
}
