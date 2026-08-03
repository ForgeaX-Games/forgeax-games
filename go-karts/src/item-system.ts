/**
 * One-slot kart item inventory distilled from the original Fable racer, with
 * the reference video's banana trap added to the pool.
 */
import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { AiRacers } from './ai-racers';
import type { KartController, KartPose } from './kart-controller';
import type { LoadedScene } from './scene';
import { forwardNegZ } from './orientation';

export type ItemKind = 'boost' | 'star' | 'horn' | 'banana';

export const ITEM_PRESENTATION: Record<
  ItemKind,
  { icon: string; label: string; help: string }
> = {
  boost: { icon: '🚀', label: '火箭冲刺', help: '短时间极速冲刺' },
  star: { icon: '⭐', label: '无敌星', help: '撞开附近对手' },
  horn: { icon: '📣', label: '震荡喇叭', help: '减速周围对手' },
  banana: { icon: '🍌', label: '香蕉陷阱', help: '在身后放置陷阱' },
};

const ITEM_POOL: readonly ItemKind[] = [
  'boost',
  'boost',
  'star',
  'horn',
  'banana',
];

interface BananaTrap {
  entity: EntityHandle;
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  life: number;
  throwT: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

interface HornPulse {
  entity: EntityHandle;
  index: number;
}

export interface ItemUseResult {
  item: ItemKind;
  affected: number;
}

export interface KartItems {
  hasItem(): boolean;
  getHeld(): ItemKind | null;
  obtainRandom(): ItemKind | null;
  use(pose: KartPose): ItemUseResult | null;
  update(dt: number, pose: KartPose): void;
  isStarActive(): boolean;
  isHornActive(): boolean;
  reset(): void;
}

export function createKartItems(options: {
  world: World;
  scene: LoadedScene;
  kart: KartController;
  ais: AiRacers;
}): KartItems {
  const { world, scene, kart, ais } = options;
  const traps: BananaTrap[] = [];
  const hornPulses: HornPulse[] = [];

  for (const node of scene.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    const entity = scene.mapping.get(node.localId);
    if (entity === undefined) continue;
    if (name?.startsWith('BananaTrap_')) {
      traps.push({
        entity,
        active: false,
        x: 0,
        y: -20,
        z: 0,
        yaw: 0,
        life: 0,
        throwT: 1,
        fromX: 0,
        fromY: -20,
        fromZ: 0,
        targetX: 0,
        targetY: -20,
        targetZ: 0,
      });
    } else if (name?.startsWith('HornPulse_')) {
      hornPulses.push({ entity, index: hornPulses.length });
    }
  }

  let held: ItemKind | null = null;
  let starT = 0;
  let hornT = 0;
  let hornX = 0;
  let hornY = 0;
  let hornZ = 0;
  const starHitCooldown = new Map<string, number>();
  let nextTrap = 0;

  const writeTrap = (trap: BananaTrap): void => {
    const cur = world.get(trap.entity, Transform);
    if (!cur.ok) return;
    world.set(trap.entity, Transform, {
      ...cur.value,
      pos: trap.active ? [trap.x, trap.y, trap.z] : [0, -20, 0],
      quat: [0, Math.sin(trap.yaw * 0.5), 0, Math.cos(trap.yaw * 0.5)],
      scale: trap.active ? [1.35, 1.35, 1.35] : [0, 0, 0],
    });
  };

  const writeHornPulse = (pulse: HornPulse): void => {
    const cur = world.get(pulse.entity, Transform);
    if (!cur.ok) return;
    if (hornT <= 0) {
      world.set(pulse.entity, Transform, {
        ...cur.value,
        pos: [0, -20, 0],
        scale: [0, 0, 0],
      });
      return;
    }
    const progress = 1 - hornT / 0.65;
    const radius = 0.8 + progress * 11.2;
    const angle = (pulse.index / Math.max(1, hornPulses.length)) * Math.PI * 2;
    world.set(pulse.entity, Transform, {
      ...cur.value,
      pos: [
        hornX + Math.cos(angle) * radius,
        hornY + 0.12,
        hornZ + Math.sin(angle) * radius,
      ],
      quat: [0, Math.sin((-angle + Math.PI / 2) * 0.5), 0, Math.cos((-angle + Math.PI / 2) * 0.5)],
      scale: [0.18, 0.08, 1.15],
    });
  };

  const deployBanana = (pose: KartPose): void => {
    if (traps.length === 0) return;
    const trap = traps[nextTrap % traps.length]!;
    nextTrap++;
    const forward = forwardNegZ(pose.yaw);
    trap.active = true;
    trap.fromX = pose.x - forward.x * 0.7;
    trap.fromY = pose.y + 1.0;
    trap.fromZ = pose.z - forward.z * 0.7;
    trap.targetX = pose.x - forward.x * 3.4;
    trap.targetY = pose.y + 0.12;
    trap.targetZ = pose.z - forward.z * 3.4;
    trap.x = trap.fromX;
    trap.y = trap.fromY;
    trap.z = trap.fromZ;
    trap.yaw = pose.yaw;
    trap.throwT = 0;
    trap.life = 20;
    writeTrap(trap);
  };

  const reset = (): void => {
    held = null;
    starT = 0;
    hornT = 0;
    starHitCooldown.clear();
    nextTrap = 0;
    for (const trap of traps) {
      trap.active = false;
      trap.life = 0;
      writeTrap(trap);
    }
    for (const pulse of hornPulses) writeHornPulse(pulse);
  };

  return {
    hasItem: () => held !== null,
    getHeld: () => held,
    obtainRandom() {
      if (held) return null;
      held = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)]!;
      return held;
    },
    use(pose) {
      if (!held) return null;
      const item = held;
      held = null;
      let affected = 0;
      if (item === 'boost') {
        kart.applyBoost(1.7, 9);
      } else if (item === 'star') {
        starT = Math.max(starT, 4.5);
      } else if (item === 'horn') {
        affected = ais.slowInRadius(pose.x, pose.z, 12, 1.6);
        hornT = 0.65;
        hornX = pose.x;
        hornY = pose.y;
        hornZ = pose.z;
      } else {
        deployBanana(pose);
      }
      return { item, affected };
    },
    update(dt, pose) {
      starT = Math.max(0, starT - dt);
      hornT = Math.max(0, hornT - dt);
      for (const pulse of hornPulses) writeHornPulse(pulse);
      for (const [id, cooldown] of starHitCooldown) {
        const next = cooldown - dt;
        if (next <= 0) starHitCooldown.delete(id);
        else starHitCooldown.set(id, next);
      }

      const aiPositions = ais.getPositions();
      if (starT > 0) {
        for (const ai of aiPositions) {
          const dx = ai.x - pose.x;
          const dz = ai.z - pose.z;
          if (dx * dx + dz * dz > 1.8 * 1.8 || starHitCooldown.has(ai.id)) continue;
          ais.applySlow(ai.id, 1.4);
          starHitCooldown.set(ai.id, 0.8);
        }
      }

      for (const trap of traps) {
        if (!trap.active) continue;
        trap.life -= dt;
        if (trap.throwT < 0.55) {
          trap.throwT = Math.min(0.55, trap.throwT + dt);
          const u = trap.throwT / 0.55;
          trap.x = trap.fromX + (trap.targetX - trap.fromX) * u;
          trap.z = trap.fromZ + (trap.targetZ - trap.fromZ) * u;
          trap.y =
            trap.fromY +
            (trap.targetY - trap.fromY) * u +
            Math.sin(u * Math.PI) * 1.15;
          trap.yaw += dt * 8;
          writeTrap(trap);
          continue;
        }
        let hitId: string | null = null;
        for (const ai of aiPositions) {
          const dx = ai.x - trap.x;
          const dz = ai.z - trap.z;
          if (dx * dx + dz * dz < 1.45 * 1.45) {
            hitId = ai.id;
            break;
          }
        }
        if (hitId) {
          ais.applySlow(hitId, 2.2);
          trap.active = false;
        } else if (trap.life <= 0) {
          trap.active = false;
        }
        writeTrap(trap);
      }
    },
    isStarActive: () => starT > 0,
    isHornActive: () => hornT > 0,
    reset,
  };
}
