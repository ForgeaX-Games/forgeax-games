/**
 * PLAYER — 主角精锐战机 "苍鹰" (Azure Falcon)
 *
 * 29 个精细零件的科幻战斗机, 包含:
 * 尖锐机鼻 / 多段机身 / 座舱 / 脊背光带 / 大三角翼 / 鸭翼 /
 * 双垂尾 / 尾翼灯 / 引擎舱 / 喷嘴 / 白热推进核心 / 蓝色外晕 /
 * 航行灯 / 翼面光条 / 面板线 / 武器挂架
 *
 * // 这架小飞机可是花了很多心思打磨的哦~ ♪
 */
import { Transform, MeshFilter, MeshRenderer, quat } from '@forgeax/engine-runtime';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { defineComponent, type EntityHandleHandle } from '@forgeax/engine-ecs';
import type { World } from '@forgeax/engine-ecs';
import type { Geo, Mat } from './setup';

export const Player = defineComponent('Player', { speed: 'f32' });
export const Thruster = defineComponent('Thruster', { phase: 'f32' });

export interface PlayerShip {
  entity: EntityHandle;
  /** [entity, offsetX, offsetY, offsetZ] per decorative part */
  parts: [EntityHandle, number, number, number][];
}

export function spawnPlayer(world: World, geo: Geo, mat: Mat, startZ: number): PlayerShip {
  const parts: [EntityHandle, number, number, number][] = [];
  const SPEED = 13;

  // Helper
  function part(ox: number, oy: number, oz: number, ...bundles: any[]) {
    const e = (world.spawn as any)(...bundles).unwrap() as EntityHandle;
    parts.push([e, ox, oy, oz]);
    return e;
  }

  // Quaternions
  const qFwd = quat.create(); quat.fromAxisAngle(qFwd, [1, 0, 0], Math.PI / 2);
  const qCylZ = quat.create(); quat.fromAxisAngle(qCylZ, [1, 0, 0], Math.PI / 2);
  const SZ = startZ;

  // ── 1. NOSE CONE ──
  const entity = world.spawn(
    { component: Transform, data: { pos: [0, 0, SZ], quat: [qFwd[0], qFwd[1], qFwd[2], qFwd[3]], scale: [0.5, 1.6, 0.5] } },
    { component: MeshFilter, data: { assetHandle: geo.coneSharp } },
    { component: MeshRenderer, data: { materials: [mat.hull] } },
    { component: Player, data: { speed: SPEED } },
  ).unwrap();

  // ── 2. MID FUSELAGE ──
  part(0, 0, 0.9,
    { component: Transform, data: { pos: [0, 0, SZ+0.9], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.44, 0.7, 0.44] } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.hullLight] } });

  // ── 3. REAR FUSELAGE ──
  part(0, 0, 1.5,
    { component: Transform, data: { pos: [0, 0, SZ+1.5], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.5, 0.5, 0.5] } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.hull] } });

  // ── 4. COCKPIT CANOPY ──
  part(0, 0.22, 0.15,
    { component: Transform, data: { pos: [0, 0.22, SZ+0.15], scale: [0.28, 0.15, 0.48] } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.cockpit] } });

  // ── 5. DORSAL SPINE ──
  part(0, 0.18, 0.8,
    { component: Transform, data: { pos: [0, 0.18, SZ+0.8], scale: [0.06, 0.08, 0.9] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.stripe] } });

  // ── 6-7. MAIN DELTA WINGS ──
  const wQL = quat.create(); quat.fromAxisAngle(wQL, [0, 1, 0], 0.18);
  part(-1.3, -0.02, 0.55,
    { component: Transform, data: { pos: [-1.3, -0.02, SZ+0.55], quat: [wQL[0], wQL[1], wQL[2], wQL[3]], scale: [2.2, 0.05, 0.8] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });
  const wQR = quat.create(); quat.fromAxisAngle(wQR, [0, 1, 0], -0.18);
  part(1.3, -0.02, 0.55,
    { component: Transform, data: { pos: [1.3, -0.02, SZ+0.55], quat: [wQR[0], wQR[1], wQR[2], wQR[3]], scale: [2.2, 0.05, 0.8] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });

  // ── 8-9. CANARD WINGS ──
  part(-0.5, 0.02, -0.1,
    { component: Transform, data: { pos: [-0.5, 0.02, SZ-0.1], scale: [0.7, 0.04, 0.3] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });
  part(0.5, 0.02, -0.1,
    { component: Transform, data: { pos: [0.5, 0.02, SZ-0.1], scale: [0.7, 0.04, 0.3] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });

  // ── 10-11. VERTICAL STABILIZERS ──
  part(-0.3, 0.35, 1.6,
    { component: Transform, data: { pos: [-0.3, 0.35, SZ+1.6], scale: [0.05, 0.5, 0.35] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.hull] } });
  part(0.3, 0.35, 1.6,
    { component: Transform, data: { pos: [0.3, 0.35, SZ+1.6], scale: [0.05, 0.5, 0.35] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.hull] } });

  // ── 12-13. FIN TIPS ──
  part(-0.3, 0.6, 1.55,
    { component: Transform, data: { pos: [-0.3, 0.6, SZ+1.55], scale: [0.04, 0.06, 0.12] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.finTip] } });
  part(0.3, 0.6, 1.55,
    { component: Transform, data: { pos: [0.3, 0.6, SZ+1.55], scale: [0.04, 0.06, 0.12] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.finTip] } });

  // ── 14-15. ENGINE NACELLES ──
  part(-0.45, -0.04, 1.25,
    { component: Transform, data: { pos: [-0.45, -0.04, SZ+1.25], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.32, 0.6, 0.32] } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.engine] } });
  part(0.45, -0.04, 1.25,
    { component: Transform, data: { pos: [0.45, -0.04, SZ+1.25], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.32, 0.6, 0.32] } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.engine] } });

  // ── 16-17. NOZZLE RIMS ──
  part(-0.45, -0.04, 1.6,
    { component: Transform, data: { pos: [-0.45, -0.04, SZ+1.6], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.36, 0.08, 0.36] } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.nozzle] } });
  part(0.45, -0.04, 1.6,
    { component: Transform, data: { pos: [0.45, -0.04, SZ+1.6], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.36, 0.08, 0.36] } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.nozzle] } });

  // ── 18-19. THRUSTER CORE (white-hot) ──
  part(-0.45, -0.04, 1.75,
    { component: Transform, data: { pos: [-0.45, -0.04, SZ+1.75], scale: [0.18, 0.18, 0.35] } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.thrustCore] } },
    { component: Thruster, data: { phase: 0 } });
  part(0.45, -0.04, 1.75,
    { component: Transform, data: { pos: [0.45, -0.04, SZ+1.75], scale: [0.18, 0.18, 0.35] } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.thrustCore] } },
    { component: Thruster, data: { phase: Math.PI } });

  // ── 20-21. THRUSTER OUTER HALO ──
  part(-0.45, -0.04, 1.85,
    { component: Transform, data: { pos: [-0.45, -0.04, SZ+1.85], scale: [0.28, 0.28, 0.45] } },
    { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
    { component: MeshRenderer, data: { materials: [mat.thrustOuter] } },
    { component: Thruster, data: { phase: 0.5 } });
  part(0.45, -0.04, 1.85,
    { component: Transform, data: { pos: [0.45, -0.04, SZ+1.85], scale: [0.28, 0.28, 0.45] } },
    { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
    { component: MeshRenderer, data: { materials: [mat.thrustOuter] } },
    { component: Thruster, data: { phase: Math.PI + 0.5 } });

  // ── 22-23. NAVIGATION LIGHTS (port red / starboard green) ──
  part(-2.3, 0.0, 0.65,
    { component: Transform, data: { pos: [-2.3, 0, SZ+0.65], scale: [0.08, 0.06, 0.08] } },
    { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
    { component: MeshRenderer, data: { materials: [mat.navRed] } });
  part(2.3, 0.0, 0.65,
    { component: Transform, data: { pos: [2.3, 0, SZ+0.65], scale: [0.08, 0.06, 0.08] } },
    { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
    { component: MeshRenderer, data: { materials: [mat.navGreen] } });

  // ── 24-25. WING STRIPE ACCENTS ──
  part(-1.6, 0.03, 0.7,
    { component: Transform, data: { pos: [-1.6, 0.03, SZ+0.7], scale: [0.8, 0.06, 0.06] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.stripe] } });
  part(1.6, 0.03, 0.7,
    { component: Transform, data: { pos: [1.6, 0.03, SZ+0.7], scale: [0.8, 0.06, 0.06] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.stripe] } });

  // ── 26-27. PANEL LINES ──
  part(0, 0.12, 0.45,
    { component: Transform, data: { pos: [0, 0.12, SZ+0.45], scale: [0.5, 0.015, 0.015] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.panelLine] } });
  part(0, 0.12, 1.0,
    { component: Transform, data: { pos: [0, 0.12, SZ+1.0], scale: [0.45, 0.015, 0.015] } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.panelLine] } });

  // ── 28-29. WEAPON PODS (under-wing) ──
  part(-0.9, -0.12, 0.6,
    { component: Transform, data: { pos: [-0.9, -0.12, SZ+0.6], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.12, 0.35, 0.12] } },
    { component: MeshFilter, data: { assetHandle: geo.cylSm } },
    { component: MeshRenderer, data: { materials: [mat.weaponPod] } });
  part(0.9, -0.12, 0.6,
    { component: Transform, data: { pos: [0.9, -0.12, SZ+0.6], quat: [qCylZ[0], qCylZ[1], qCylZ[2], qCylZ[3]], scale: [0.12, 0.35, 0.12] } },
    { component: MeshFilter, data: { assetHandle: geo.cylSm } },
    { component: MeshRenderer, data: { materials: [mat.weaponPod] } });

  return { entity, parts };
}
