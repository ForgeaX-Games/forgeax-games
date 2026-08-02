//  localized comment
//  localized comment
// NPC residents animate exactly like the Player.
//
// Pack naming convention: root node Name = <prefix> (e.g. 'Player', 'NpcA'),
// parts = <prefix><Suffix> ('PlayerTorso', 'NpcATorso', ...). All parts are
// ChildOf the root with their REST pose authored in the pack; we animate as
// offsets/rotations from that rest pose, so ✎ Edit always shows the clean rig.

import { Transform } from '@forgeax/engine-scene';
import { quat } from '@forgeax/engine-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';

export interface PackNodeLike {
  localId: number;
  components: Record<string, Record<string, unknown>>;
}

// rig tuning (same values the Player shipped with)
const HIP_Y = -0.29;      // hip pivot height (local)
const SHOULDER_Y = 0.13;  // shoulder pivot height (local)
const SWING_AMP = 0.62;   // max stride angle (rad)
const TURN_RATE = 14;     // yaw chase rate (1/s)
const LEAN = 0.10;        // forward lean while running (rad)
const SQUASH_T = 0.22;    // bubble-drop squash duration (s)

interface Part { e: EntityHandle; px: number; py: number; pz: number; sx: number; sy: number; sz: number }

export class HumanoidRig {
  readonly root: EntityHandle | undefined;
  private readonly parts = new Map<string, Part>();
  private readonly q = quat.create();

  constructor(
    private readonly world: World,
    nodes: readonly PackNodeLike[],
    mapping: ReadonlyMap<number, EntityHandle>,
    prefix: string,
  ) {
    const rootNode = nodes.find((n) => (n.components.Name as { value?: string } | undefined)?.value === prefix);
    this.root = rootNode ? mapping.get(rootNode.localId) : undefined;
    for (const n of nodes) {
      const nm = (n.components.Name as { value?: string } | undefined)?.value;
      if (!nm || !nm.startsWith(prefix) || nm === prefix) continue;
      const e = mapping.get(n.localId);
      if (e === undefined) continue;
      const t = (n.components.Transform ?? {}) as { pos?: number[]; scale?: number[] };
      this.parts.set(nm.slice(prefix.length), {
        e,
        px: t.pos?.[0] ?? 0, py: t.pos?.[1] ?? 0, pz: t.pos?.[2] ?? 0,
        sx: t.scale?.[0] ?? 1, sy: t.scale?.[1] ?? 1, sz: t.scale?.[2] ?? 1,
      });
    }
  }

  get found(): boolean { return this.root !== undefined && this.parts.size > 0; }

  setVisible(vis: boolean): void {
    for (const p of this.parts.values()) {
      this.world.set(p.e, Transform, vis
        ? { pos: [p.px, p.py, p.pz], quat: [0, 0, 0, 1], scale: [p.sx, p.sy, p.sz] }
        : { scale: [0, 0, 0] });
    }
  }

  /** offset a part from its rest pose (optionally scaled) */
  private setPart(name: string, dx: number, dy: number, dz: number, kx = 1, ky = 1, kz = 1): void {
    const p = this.parts.get(name);
    if (p) this.world.set(p.e, Transform, { pos: [p.px + dx, p.py + dy, p.pz + dz], scale: [p.sx * kx, p.sy * ky, p.sz * kz] });
  }

  /** rotate a limb around a hip/shoulder pivot (local X axis, +ang → toward -Z face) */
  private swingPart(name: string, pivotY: number, ang: number): void {
    const p = this.parts.get(name);
    if (!p) return;
    const s = Math.sin(ang), c = Math.cos(ang);
    const ry = p.py - pivotY, rz = p.pz;
    quat.fromAxisAngle(this.q, [1, 0, 0], ang);
    this.world.set(p.e, Transform, {
      pos: [p.px, pivotY + ry * c - rz * s, ry * s + rz * c],
      quat: [this.q[0]!, this.q[1]!, this.q[2]!, this.q[3]!],
      scale: [p.sx, p.sy, p.sz],
    });
  }

  /** full-body pose: legs stride / arms counter-swing / torso breathe / head bob */
  pose(walkPhase: number, moveBlend: number, idleT: number, sq: number): void {
    const swing = Math.sin(walkPhase) * moveBlend * SWING_AMP;
    this.swingPart('LegL', HIP_Y, swing);
    this.swingPart('FootL', HIP_Y, swing);
    this.swingPart('LegR', HIP_Y, -swing);
    this.swingPart('FootR', HIP_Y, -swing);
    this.swingPart('ArmL', SHOULDER_Y, -swing * 0.85);
    this.swingPart('HandL', SHOULDER_Y, -swing * 0.85);
    this.swingPart('ArmR', SHOULDER_Y, swing * 0.85);
    this.swingPart('HandR', SHOULDER_Y, swing * 0.85);
    const breathe = Math.sin(idleT * 2.4) * 0.03 * (1 - moveBlend);
    const pump = Math.sin(walkPhase * 2) * 0.03 * moveBlend;
    const kxz = 1 + 0.12 * sq, ky = 1 + breathe + pump - 0.16 * sq;
    this.setPart('Torso', 0, -0.03 * sq, 0, kxz, ky, kxz);
    this.setPart('Shorts', 0, -0.02 * sq, 0);
    const headDy = -0.07 * sq + Math.sin(walkPhase * 2 + 0.6) * 0.025 * moveBlend;
    this.setPart('Head', 0, headDy, 0);
    this.setPart('Hat', 0, headDy, 0);
    this.setPart('Bobble', 0, headDy + Math.sin(walkPhase * 2) * 0.015 * moveBlend, 0);
    this.setPart('EyeL', 0, headDy, 0);
    this.setPart('EyeR', 0, headDy, 0);
    this.setPart('BlushL', 0, headDy, 0);
    this.setPart('BlushR', 0, headDy, 0);
  }

  /** Friendly wave: raise + wiggle the right arm. Call AFTER pose() to override
   *  its ArmR/HandR swing for the duration of an 'emote:wave' Body intent. */
  waveRightArm(phase: number): void {
    const ang = -2.0 + Math.sin(phase * 10) * 0.35;   // arm up, hand flapping hello
    this.swingPart('ArmR', SHOULDER_Y, ang);
    this.swingPart('HandR', SHOULDER_Y, ang);
  }
}

/** One walking character: phase bookkeeping + smooth turn + root driving. */
export class Actor {
  curYaw = Math.PI;         // rest facing = +Z
  baseY = 0.55;             // root height (town apron 0.55 / arena floor 0.75)
  private walkPhase = 0;
  private moveBlend = 0;
  private idleT = Math.random() * 10;
  private squashT = 0;
  private faceX = 0;
  private faceZ = 1;
  private visible = true;
  private emoteKind: string | null = null;
  private emoteT = 0;
  private readonly yawQ = quat.create();
  private readonly leanQ = quat.create();
  private readonly rootQ = quat.create();

  constructor(private readonly world: World, readonly rig: HumanoidRig) {}

  face(fx: number, fz: number): void {
    if (Math.hypot(fx, fz) > 1e-3) { this.faceX = fx; this.faceZ = fz; }
  }
  snapYaw(): void { this.curYaw = Math.atan2(-this.faceX, -this.faceZ); }
  squash(): void { this.squashT = SQUASH_T; }
  /** Layer a gesture over the walk/idle pose. Pass null to clear. */
  setEmote(kind: string | null): void {
    if (kind === this.emoteKind) return;
    this.emoteKind = kind;
    this.emoteT = 0;
  }
  setVisible(v: boolean): void {
    this.visible = v;
    this.rig.setVisible(v);
  }

  /** advance animation + drive the root Transform. cadence ≈ 5 + speed*1.5 */
  update(dt: number, x: number, z: number, moving: boolean, cadence: number): void {
    if (!this.visible || this.rig.root === undefined) return;
    this.moveBlend += ((moving ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 10);
    if (moving) this.walkPhase += dt * cadence;
    this.idleT += dt;
    if (this.squashT > 0) this.squashT = Math.max(0, this.squashT - dt);
    const sq = this.squashT > 0 ? Math.sin((1 - this.squashT / SQUASH_T) * Math.PI) : 0;
    this.rig.pose(this.walkPhase, this.moveBlend, this.idleT, sq);
    // emote layer: overrides the arm the base pose just set (e.g. a wave hello)
    if (this.emoteKind === 'wave') {
      this.emoteT += dt;
      this.rig.waveRightArm(this.emoteT);
    }
    // smooth shortest-arc turn toward the facing direction
    const targetYaw = Math.atan2(-this.faceX, -this.faceZ);
    let dYaw = targetYaw - this.curYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.curYaw += dYaw * Math.min(1, dt * TURN_RATE);
    quat.fromAxisAngle(this.yawQ, [0, 1, 0], this.curYaw);
    quat.fromAxisAngle(this.leanQ, [1, 0, 0], -LEAN * this.moveBlend);
    quat.multiply(this.rootQ, this.yawQ, this.leanQ);
    const bob = Math.abs(Math.cos(this.walkPhase)) * 0.04 * this.moveBlend;
    this.world.set(this.rig.root, Transform, {
      pos: [x, this.baseY + bob - 0.05 * sq, z],
      quat: [this.rootQ[0]!, this.rootQ[1]!, this.rootQ[2]!, this.rootQ[3]!],
    });
  }
}
