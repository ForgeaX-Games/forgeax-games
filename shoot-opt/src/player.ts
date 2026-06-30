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
import { Transform, MeshFilter, MeshRenderer, HANDLE_CUBE, quat } from '@forgeax/engine-runtime';
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
    { component: Transform, data: { posZ: SZ, quatX: qFwd[0], quatY: qFwd[1], quatZ: qFwd[2], quatW: qFwd[3], scaleX: 0.5, scaleY: 1.6, scaleZ: 0.5 } },
    { component: MeshFilter, data: { assetHandle: geo.coneSharp } },
    { component: MeshRenderer, data: { materials: [mat.hull] } },
    { component: Player, data: { speed: SPEED } },
  ).unwrap();

  // ── 2. MID FUSELAGE ──
  part(0, 0, 0.9,
    { component: Transform, data: { posX: 0, posZ: SZ+0.9, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.44, scaleY: 0.7, scaleZ: 0.44 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.hullLight] } });

  // ── 3. REAR FUSELAGE ──
  part(0, 0, 1.5,
    { component: Transform, data: { posX: 0, posZ: SZ+1.5, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.hull] } });

  // ── 4. COCKPIT CANOPY ──
  part(0, 0.22, 0.15,
    { component: Transform, data: { posX: 0, posY: 0.22, posZ: SZ+0.15, scaleX: 0.28, scaleY: 0.15, scaleZ: 0.48 } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.cockpit] } });

  // ── 5. DORSAL SPINE ──
  part(0, 0.18, 0.8,
    { component: Transform, data: { posX: 0, posY: 0.18, posZ: SZ+0.8, scaleX: 0.06, scaleY: 0.08, scaleZ: 0.9 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.stripe] } });

  // ── 6-7. MAIN DELTA WINGS ──
  const wQL = quat.create(); quat.fromAxisAngle(wQL, [0, 1, 0], 0.18);
  part(-1.3, -0.02, 0.55,
    { component: Transform, data: { posX: -1.3, posY: -0.02, posZ: SZ+0.55, quatX: wQL[0], quatY: wQL[1], quatZ: wQL[2], quatW: wQL[3], scaleX: 2.2, scaleY: 0.05, scaleZ: 0.8 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });
  const wQR = quat.create(); quat.fromAxisAngle(wQR, [0, 1, 0], -0.18);
  part(1.3, -0.02, 0.55,
    { component: Transform, data: { posX: 1.3, posY: -0.02, posZ: SZ+0.55, quatX: wQR[0], quatY: wQR[1], quatZ: wQR[2], quatW: wQR[3], scaleX: 2.2, scaleY: 0.05, scaleZ: 0.8 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });

  // ── 8-9. CANARD WINGS ──
  part(-0.5, 0.02, -0.1,
    { component: Transform, data: { posX: -0.5, posY: 0.02, posZ: SZ-0.1, scaleX: 0.7, scaleY: 0.04, scaleZ: 0.3 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });
  part(0.5, 0.02, -0.1,
    { component: Transform, data: { posX: 0.5, posY: 0.02, posZ: SZ-0.1, scaleX: 0.7, scaleY: 0.04, scaleZ: 0.3 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.wing] } });

  // ── 10-11. VERTICAL STABILIZERS ──
  part(-0.3, 0.35, 1.6,
    { component: Transform, data: { posX: -0.3, posY: 0.35, posZ: SZ+1.6, scaleX: 0.05, scaleY: 0.5, scaleZ: 0.35 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.hull] } });
  part(0.3, 0.35, 1.6,
    { component: Transform, data: { posX: 0.3, posY: 0.35, posZ: SZ+1.6, scaleX: 0.05, scaleY: 0.5, scaleZ: 0.35 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.hull] } });

  // ── 12-13. FIN TIPS ──
  part(-0.3, 0.6, 1.55,
    { component: Transform, data: { posX: -0.3, posY: 0.6, posZ: SZ+1.55, scaleX: 0.04, scaleY: 0.06, scaleZ: 0.12 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.finTip] } });
  part(0.3, 0.6, 1.55,
    { component: Transform, data: { posX: 0.3, posY: 0.6, posZ: SZ+1.55, scaleX: 0.04, scaleY: 0.06, scaleZ: 0.12 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.finTip] } });

  // ── 14-15. ENGINE NACELLES ──
  part(-0.45, -0.04, 1.25,
    { component: Transform, data: { posX: -0.45, posY: -0.04, posZ: SZ+1.25, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.32, scaleY: 0.6, scaleZ: 0.32 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.engine] } });
  part(0.45, -0.04, 1.25,
    { component: Transform, data: { posX: 0.45, posY: -0.04, posZ: SZ+1.25, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.32, scaleY: 0.6, scaleZ: 0.32 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.engine] } });

  // ── 16-17. NOZZLE RIMS ──
  part(-0.45, -0.04, 1.6,
    { component: Transform, data: { posX: -0.45, posY: -0.04, posZ: SZ+1.6, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.36, scaleY: 0.08, scaleZ: 0.36 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.nozzle] } });
  part(0.45, -0.04, 1.6,
    { component: Transform, data: { posX: 0.45, posY: -0.04, posZ: SZ+1.6, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.36, scaleY: 0.08, scaleZ: 0.36 } },
    { component: MeshFilter, data: { assetHandle: geo.cylinder } },
    { component: MeshRenderer, data: { materials: [mat.nozzle] } });

  // ── 18-19. THRUSTER CORE (white-hot) ──
  part(-0.45, -0.04, 1.75,
    { component: Transform, data: { posX: -0.45, posY: -0.04, posZ: SZ+1.75, scaleX: 0.18, scaleY: 0.18, scaleZ: 0.35 } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.thrustCore] } },
    { component: Thruster, data: { phase: 0 } });
  part(0.45, -0.04, 1.75,
    { component: Transform, data: { posX: 0.45, posY: -0.04, posZ: SZ+1.75, scaleX: 0.18, scaleY: 0.18, scaleZ: 0.35 } },
    { component: MeshFilter, data: { assetHandle: geo.sphere } },
    { component: MeshRenderer, data: { materials: [mat.thrustCore] } },
    { component: Thruster, data: { phase: Math.PI } });

  // ── 20-21. THRUSTER OUTER HALO ──
  part(-0.45, -0.04, 1.85,
    { component: Transform, data: { posX: -0.45, posY: -0.04, posZ: SZ+1.85, scaleX: 0.28, scaleY: 0.28, scaleZ: 0.45 } },
    { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
    { component: MeshRenderer, data: { materials: [mat.thrustOuter] } },
    { component: Thruster, data: { phase: 0.5 } });
  part(0.45, -0.04, 1.85,
    { component: Transform, data: { posX: 0.45, posY: -0.04, posZ: SZ+1.85, scaleX: 0.28, scaleY: 0.28, scaleZ: 0.45 } },
    { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
    { component: MeshRenderer, data: { materials: [mat.thrustOuter] } },
    { component: Thruster, data: { phase: Math.PI + 0.5 } });

  // ── 22-23. NAVIGATION LIGHTS (port red / starboard green) ──
  part(-2.3, 0.0, 0.65,
    { component: Transform, data: { posX: -2.3, posZ: SZ+0.65, scaleX: 0.08, scaleY: 0.06, scaleZ: 0.08 } },
    { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
    { component: MeshRenderer, data: { materials: [mat.navRed] } });
  part(2.3, 0.0, 0.65,
    { component: Transform, data: { posX: 2.3, posZ: SZ+0.65, scaleX: 0.08, scaleY: 0.06, scaleZ: 0.08 } },
    { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
    { component: MeshRenderer, data: { materials: [mat.navGreen] } });

  // ── 24-25. WING STRIPE ACCENTS ──
  part(-1.6, 0.03, 0.7,
    { component: Transform, data: { posX: -1.6, posY: 0.03, posZ: SZ+0.7, scaleX: 0.8, scaleY: 0.06, scaleZ: 0.06 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.stripe] } });
  part(1.6, 0.03, 0.7,
    { component: Transform, data: { posX: 1.6, posY: 0.03, posZ: SZ+0.7, scaleX: 0.8, scaleY: 0.06, scaleZ: 0.06 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.stripe] } });

  // ── 26-27. PANEL LINES ──
  part(0, 0.12, 0.45,
    { component: Transform, data: { posX: 0, posY: 0.12, posZ: SZ+0.45, scaleX: 0.5, scaleY: 0.015, scaleZ: 0.015 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.panelLine] } });
  part(0, 0.12, 1.0,
    { component: Transform, data: { posX: 0, posY: 0.12, posZ: SZ+1.0, scaleX: 0.45, scaleY: 0.015, scaleZ: 0.015 } },
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.panelLine] } });

  // ── 28-29. WEAPON PODS (under-wing) ──
  part(-0.9, -0.12, 0.6,
    { component: Transform, data: { posX: -0.9, posY: -0.12, posZ: SZ+0.6, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.12, scaleY: 0.35, scaleZ: 0.12 } },
    { component: MeshFilter, data: { assetHandle: geo.cylSm } },
    { component: MeshRenderer, data: { materials: [mat.weaponPod] } });
  part(0.9, -0.12, 0.6,
    { component: Transform, data: { posX: 0.9, posY: -0.12, posZ: SZ+0.6, quatX: qCylZ[0], quatY: qCylZ[1], quatZ: qCylZ[2], quatW: qCylZ[3], scaleX: 0.12, scaleY: 0.35, scaleZ: 0.12 } },
    { component: MeshFilter, data: { assetHandle: geo.cylSm } },
    { component: MeshRenderer, data: { materials: [mat.weaponPod] } });

  return { entity, parts };
}
