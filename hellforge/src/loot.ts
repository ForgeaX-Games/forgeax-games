// Hellforge loot — xp gems, gold piles, potion orbs. Kill → drop → walk
// over → magnet pickup → HUD ticks up. (cow-survivor gems.ts pattern:
// single-entity emissive drops, JS-array integration, no physics.)

import {
  Transform,
} from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
  Materials,
} from '@forgeax/engine-render';
import {
  type MaterialAsset,
} from '@forgeax/engine-types';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';

import type { Monster } from './monsters';
import { MONSTERS } from './monsters';
import { RARITY_META, type ItemInstance, type Rarity } from './items';

type MatHandle = Handle<'MaterialAsset', 'shared'>;

export type DropKind = 'xp' | 'gold' | 'healPotion' | 'manaPotion' | 'item';

interface Drop {
  /** Stable InteractionRef id — never an ECS EntityHandle. */
  id: string;
  e: EntityHandle;
  kind: DropKind;
  amount: number;
  /** Equipment payload (kind === 'item' only). */
  item?: ItemInstance;
  x: number; y: number; z: number;
  baseY: number;
  /** Render scale (item beams are tall pillars, orbs are small). */
  sx: number; sy: number; sz: number;
  vx: number; vz: number;
  age: number;
  hooked: boolean;
  bobPhase: number;
  spinPhase: number;
}

export interface PickupEvent {
  kind: DropKind;
  amount: number;
  item?: ItemInstance;
  x: number; y: number; z: number;
}

export class LootSystem {
  private drops: Drop[] = [];
  private mats: Record<Exclude<DropKind, 'item'>, MatHandle>;
  private beamMats: Record<Rarity, MatHandle>;
  private nextStableId = 1;
  readonly attractR = 3.2;
  readonly collectR = 0.7;
  readonly lifeSec = 30;

  constructor(private world: World) {
    const mk = (color: [number, number, number], i: number) =>
      world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: [color[0], color[1], color[2], 1],
        roughness: 0.25, metallic: 0.4,
        emissive: color, emissiveIntensity: i,
      }));
    this.mats = {
      xp:         mk([0.95, 0.35, 0.10], 5),   // hellfire-orange rune shard
      gold:       mk([1.0, 0.80, 0.25], 6),
      healPotion: mk([0.95, 0.15, 0.20], 4),
      manaPotion: mk([0.25, 0.35, 1.0], 4),
    };
    this.beamMats = {
      common:    mk(RARITY_META.common.beam, RARITY_META.common.beamI),
      magic:     mk(RARITY_META.magic.beam, RARITY_META.magic.beamI),
      rare:      mk(RARITY_META.rare.beam, RARITY_META.rare.beamI),
      legendary: mk(RARITY_META.legendary.beam, RARITY_META.legendary.beamI),
    };
  }

  /** Roll the D2-ish drop table for a monster kill. */
  dropFrom(m: Monster): void {
    const def = MONSTERS[m.kind];
    // XP shards: split the monster's xp into 1..3 shards for pickup pops.
    const shards = def.xp >= 15 ? 3 : def.xp >= 10 ? 2 : 1;
    const each = Math.max(1, Math.floor(def.xp / shards));
    for (let i = 0; i < shards; i++) {
      this.spawn('xp', each, m.x, m.z);
    }
    if (Math.random() < def.goldChance) {
      this.spawn('gold', 3 + Math.floor(Math.random() * (def.isBoss ? 80 : 9)), m.x, m.z);
    }
    // Potions keep the grind sustainable without a shop.
    const roll = Math.random();
    const potionChance = def.isBoss ? 1 : 0.10;
    if (roll < potionChance) {
      this.spawn(Math.random() < 0.55 ? 'healPotion' : 'manaPotion', def.isBoss ? 60 : 25, m.x, m.z);
    }
  }

  spawn(kind: Exclude<DropKind, 'item'>, amount: number, x: number, z: number): void {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.7;
    x += Math.cos(ang) * r;
    z += Math.sin(ang) * r;
    const baseY = 0.4;
    const s = kind === 'xp' ? 0.14 : kind === 'gold' ? 0.16 : 0.18;
    const sy = s * (kind === 'xp' ? 1.6 : 1);
    const shape = kind === 'xp' ? HANDLE_CUBE : HANDLE_SPHERE;
    const res = this.world.spawn(
      { component: Transform, data: { pos: [x, baseY, z], scale: [s, sy, s] } },
      { component: MeshFilter, data: { assetHandle: shape } },
      { component: MeshRenderer, data: { materials: [this.mats[kind]] } },
    );
    if (!res.ok) return;
    this.drops.push({
      id: `l-${this.nextStableId++}`,
      e: res.value as EntityHandle, kind, amount,
      x, y: baseY, z, baseY,
      sx: s, sy, sz: s,
      vx: 0, vz: 0, age: 0, hooked: false,
      bobPhase: Math.random() * Math.PI * 2,
      spinPhase: Math.random() * Math.PI * 2,
    });
  }

  /** Equipment drop — a D2-style rarity-coloured beam pillar. Legendary
   *  beams are visibly fatter + taller (the across-the-room "orange!"). */
  spawnItem(item: ItemInstance, x: number, z: number): void {
    const ang = Math.random() * Math.PI * 2;
    x += Math.cos(ang) * 0.6;
    z += Math.sin(ang) * 0.6;
    const fat = item.rarity === 'legendary' ? 0.2 : 0.13;
    const tall = item.rarity === 'legendary' ? 3.0 : 2.2;
    const baseY = tall / 2;
    const res = this.world.spawn(
      { component: Transform, data: { pos: [x, baseY, z], scale: [fat, tall, fat] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [this.beamMats[item.rarity]] } },
    );
    if (!res.ok) return;
    this.drops.push({
      id: `l-${this.nextStableId++}`,
      e: res.value as EntityHandle, kind: 'item', amount: 0, item,
      x, y: baseY, z, baseY,
      sx: fat, sy: tall, sz: fat,
      vx: 0, vz: 0, age: 0, hooked: false,
      bobPhase: Math.random() * Math.PI * 2,
      spinPhase: Math.random() * Math.PI * 2,
    });
  }

  byId(id: string): { id: string; x: number; z: number; kind: DropKind; item?: ItemInstance; amount: number } | null {
    for (const g of this.drops) {
      if (g.id === id) return { id: g.id, x: g.x, z: g.z, kind: g.kind, item: g.item, amount: g.amount };
    }
    return null;
  }

  /** Snapshot for InteractionRegistry click picks. */
  listForPick(): ReadonlyArray<{ id: string; x: number; z: number }> {
    return this.drops.map((g) => ({ id: g.id, x: g.x, z: g.z }));
  }

  /** Force-collect one drop by stable id (click-interact). Returns event or null. */
  collectById(id: string, canTakeItem: () => boolean = () => true): PickupEvent | null {
    const i = this.drops.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const g = this.drops[i]!;
    if (g.kind === 'item' && !canTakeItem()) return null;
    const ev: PickupEvent = { kind: g.kind, amount: g.amount, item: g.item, x: g.x, y: g.y, z: g.z };
    this.world.despawn(g.e);
    this.drops.splice(i, 1);
    return ev;
  }

  /**
   * Per-frame bob + magnet + collect. Returns this frame's pickups.
   * `canTakeItem` gates EQUIPMENT pickups (bag full → the beam stays put
   * and doesn't magnet, so it's still there after you make room).
   */
  tick(dt: number, px: number, pz: number, canTakeItem: () => boolean = () => true): PickupEvent[] {
    const events: PickupEvent[] = [];
    const attractR2 = this.attractR * this.attractR;
    const collectR2 = this.collectR * this.collectR;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const g = this.drops[i]!;
      g.age += dt;
      // equipment never rots away — only currency/potion orbs expire
      if (g.kind !== 'item' && g.age > this.lifeSec) {
        this.world.despawn(g.e);
        this.drops.splice(i, 1);
        continue;
      }
      const dx = px - g.x, dz = pz - g.z;
      const d2 = dx * dx + dz * dz;
      const takeable = g.kind !== 'item' || canTakeItem();
      if (!g.hooked && d2 < attractR2 && takeable) g.hooked = true;
      if (g.hooked && !takeable) g.hooked = false;   // bag filled mid-flight
      if (g.hooked) {
        const d = Math.sqrt(d2) || 1;
        const t = Math.max(0, Math.min(1, 1 - d / this.attractR));
        const targetSpeed = 4 + t * 12;
        const k = 1 - Math.exp(-12 * dt);
        g.vx += ((dx / d) * targetSpeed - g.vx) * k;
        g.vz += ((dz / d) * targetSpeed - g.vz) * k;
        g.x += g.vx * dt;
        g.z += g.vz * dt;
        g.y += ((g.kind === 'item' ? 1.1 : 0.9) - g.y) * Math.min(1, dt * 6);
        if (d2 < collectR2) {
          events.push({ kind: g.kind, amount: g.amount, item: g.item, x: g.x, y: g.y, z: g.z });
          this.world.despawn(g.e);
          this.drops.splice(i, 1);
          continue;
        }
      } else {
        g.bobPhase += dt * Math.PI * 2 * 1.4;
        g.y = g.baseY + Math.sin(g.bobPhase) * (g.kind === 'item' ? 0.04 : 0.1);
      }
      g.spinPhase += dt * (g.kind === 'item' ? 0.9 : 2.2);
      const h = g.spinPhase * 0.5;
      this.world.set(g.e, Transform, {
        pos: [g.x, g.y, g.z],
        quat: [0, Math.sin(h), 0, Math.cos(h)],
        scale: [g.sx, g.sy, g.sz],
      });
    }
    return events;
  }

  count(): number { return this.drops.length; }

  /** Remove all ground drops (combat-run reset). */
  clearGroundDrops(): void {
    for (const g of this.drops) this.world.despawn(g.e);
    this.drops.length = 0;
  }
}
