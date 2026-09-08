// 场景装配:地形/路/植被/岩石/栅栏/建筑群/远景,全部实体在此 spawn。
import { Camera, DirectionalLight, Instances, Materials, MeshFilter, MeshRenderer, Skylight } from '@forgeax/engine-render';

/** yaw 四元数(spawn 辅助) */
function yawQuat(yaw: number): [number, number, number, number] {
  const q = quat.create();
  quat.fromAxisAngle(q, [0, 1, 0], yaw);
  return [q[0], q[1], q[2], q[3]];
}

/** 平躺木板(散件) */
function plankM(buf: MeshBuf, x: number, y: number, z: number, yaw: number, len: number): void {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const hw = 0.12, hl = len / 2, th = 0.03;
  const pts: [number, number][] = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  const top = pts.map(([px, pz]) => buf.vert(x + px * cs + pz * sn, y + th, z - px * sn + pz * cs, 0, 0, [0, 1, 0]));
  buf.quad(top[0], top[1], top[2], top[3]);
  const bot = pts.map(([px, pz]) => buf.vert(x + px * cs + pz * sn, y, z - px * sn + pz * cs, 0, 0));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    buf.quad(bot[i], bot[j], top[j], top[i]);
  }
}

// 预乘 alpha 混合(与引擎 SPRITE_PREMULTIPLIED_ALPHA_BLEND 等价;子路径导入有 bundler 风险,内联)
const PREMUL_BLEND = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
} as const;
import { Transform } from '@forgeax/engine-scene';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { quat } from '@forgeax/engine-math';
import type { Handle, MeshAsset, MaterialAsset } from '@forgeax/engine-types';
import type { World } from '@forgeax/engine-ecs';
import { blob, C, MeshBuf, SUN_COLOR, SUN_DIR, SUN_INTENSITY, SKY_COLOR, SKY_INTENSITY, composeYaw, mulberry, softBox, type RGBA } from './lib';
import { groundHeight, pathDistance, PATH_PTS, PATH_W, TERRACE_CENTER, TERRACE_R, TERRACE_Y, HOUSE_BASE_Y, clampToBounds } from './terrain';
import { houseGeometry, buildWallAndTerrace, type BoxCollider } from './building';
import { barrelMesh, boardMesh, bottleMesh, bushBuf, chairMesh, crateMesh, flowerBuf, flowerMesh, grassCardMesh, grassTuftMesh, lampGlassMesh, lampMesh, lupineBuf, lupineMesh, paperMesh, potMesh, rockBuf, ropeCoilMesh, tableMesh, treeCanopyBuf, treeCanopy, treeTrunkBuf, treeTrunk, tube } from './props';
import { domeMesh, farTreeBand, fogCylinder, mountainRange, skyTexture } from './sky';
import { branchedTrunk, hexBox } from './meshlib2';
import type { TexSet } from './textures';

export interface SceneStats {
  meshTris: number;
  instancedTris: number;
  entities: number;
  skyTex: string;
  texFailures?: string;
}

type MatName = keyof typeof C | 'sky';

export function buildSceneSync(world: World, renderer: { store: { uploadTexture?: unknown; ensureResident?: unknown } }, tex: TexSet): SceneStats {
  const stats: SceneStats = { meshTris: 0, instancedTris: 0, entities: 0, skyTex: 'pending' };
  const rnd = mulberry(99);

  // ---- 材质注册 ----
  type MatH = Handle<'MaterialAsset', 'shared'>;
  type MeshH = Handle<'MeshAsset', 'shared'>;
  const matCache = new Map<string, MatH>();
  const mat = (name: MatName, opts?: { rough?: number; unlit?: boolean; glow?: number; noCull?: boolean; noShadow?: boolean; cutoff?: number; tex?: number; nrm?: number; color?: RGBA }): MatH => {
    const key = `${name}:${JSON.stringify(opts ?? {})}`;
    let h = matCache.get(key);
    if (h !== undefined) return h;
    const rgba = (opts?.color ?? (C as Record<string, readonly number[]>)[name] ?? [1, 0, 1, 1]) as [number, number, number, number];
    const asset: MaterialAsset = opts?.glow !== undefined
      ? Materials.standard({
        baseColor: [0, 0, 0, 1],
        emissive: [rgba[0], rgba[1], rgba[2]],
        emissiveIntensity: opts.glow,
        castShadow: false,
      })
      : opts?.unlit
      ? Materials.unlit([rgba[0], rgba[1], rgba[2], rgba[3]], {
        castShadow: false,
        ...(opts?.tex !== undefined ? { baseColorTexture: opts.tex } : {}),
      })
      : Materials.standard({
        baseColor: [rgba[0], rgba[1], rgba[2], rgba[3]],
        roughness: opts?.rough ?? 0.92,
        metallic: 0,
        ...(opts?.tex !== undefined ? { baseColorTexture: opts.tex } : {}),
        ...(opts?.nrm !== undefined ? { normalTexture: opts.nrm } : {}),
        ...(opts?.cutoff !== undefined ? { alphaCutoff: opts.cutoff } : {}),
        ...(opts?.noShadow ? { castShadow: false } : {}),
        ...(opts?.noCull ? { renderState: { cullMode: 'none' as const } } : {}),
      });
    h = world.allocSharedRef('MaterialAsset', asset);
    matCache.set(key, h);
    return h;
  };

  const meshHandles = new Map<MeshAsset, MeshH>();
  const meshRef = (m: MeshAsset): MeshH => {
    let h = meshHandles.get(m);
    if (h === undefined) { h = world.allocSharedRef('MeshAsset', m); meshHandles.set(m, h); }
    return h;
  };

  const spawn = (m: MeshAsset, matH: MatH, x: number, y: number, z: number, yaw = 0, scale = 1): void => {
    const q: [number, number, number, number] = [0, 0, 0, 1];
    if (yaw !== 0) { const qq = quat.create(); quat.fromAxisAngle(qq, [0, 1, 0], yaw); q[0] = qq[0]; q[1] = qq[1]; q[2] = qq[2]; q[3] = qq[3]; }
    world.spawn(
      { component: Transform, data: { pos: [x, y, z], quat: q, scale: [scale, scale, scale] } },
      { component: MeshFilter, data: { assetHandle: meshRef(m) } },
      { component: MeshRenderer, data: { materials: [matH] } },
    ).unwrap();
    stats.entities++;
  };

  const spawnInstanced = (m: MeshAsset, matH: MatH, transforms: Float32Array, cx: number, cz: number): void => {
    world.spawn(
      { component: Transform, data: { pos: [cx, 0, cz] } },
      { component: MeshFilter, data: { assetHandle: meshRef(m) } },
      { component: MeshRenderer, data: { materials: [matH] } },
      { component: Instances, data: { transforms } },
    ).unwrap();
    stats.entities++;
  };

  // ---- 光照 ----
  world.spawn({
    component: DirectionalLight,
    data: {
      direction: [SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]],
      color: [SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]],
      intensity: SUN_INTENSITY,
      castShadow: true, mapSize: 4096, shadowDistance: 130,
      normalBias: 0.10, depthBias: 0.003,
    },
  }).unwrap();
  world.spawn({
    component: Skylight,
    data: { color: [SKY_COLOR[0], SKY_COLOR[1], SKY_COLOR[2]], intensity: SKY_INTENSITY },
  }).unwrap();

  // ---- 地形 ----
  {
    const buf = new MeshBuf();
    const X0 = -80, X1 = 80, Z0 = -100, Z1 = 40, NX = 120, NZ = 105;
    const idx: number[][] = [];
    for (let j = 0; j <= NZ; j++) {
      const row: number[] = [];
      for (let i = 0; i <= NX; i++) {
        const x = X0 + (i / NX) * (X1 - X0);
        const z = Z0 + (j / NZ) * (Z1 - Z0);
        row.push(buf.vert(x, groundHeight(x, z), z, (x + 80) / 160, (z + 100) / 140));
      }
      idx.push(row);
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) buf.quad(idx[j][i], idx[j + 1][i], idx[j + 1][i + 1], idx[j][i + 1]);
    spawn(buf.build(), tex.ground !== undefined ? mat('grass', { tex: tex.ground, nrm: tex.groundN, color: [1, 1, 1, 1] }) : mat('grass'), 0, 0, 0);
  }

  // ---- 路缘卵石(叙事细节) ----
  {
    const pk = rockBuf(87);
    const merged = new MeshBuf();
    for (let i = 0; i + 1 < PATH_PTS.length; i++) {
      const [ax, az] = PATH_PTS[i], [bx, bz] = PATH_PTS[i + 1];
      const segL = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(segL / 2.6));
      for (let k = 0; k < n; k++) {
        const t = (k + rnd()) / n;
        const px2 = ax + (bx - ax) * t, pz2 = az + (bz - az) * t;
        const dx = (bx - ax) / segL, dz = (bz - az) / segL;
        const side = rnd() < 0.5 ? -1 : 1;
        const off = PATH_W / 2 + 0.2 + rnd() * 0.5;
        const x = px2 - dz * off * side, z = pz2 + dx * off * side;
        const sc = 0.10 + rnd() * 0.16;
        merged.append(pk, x, groundHeight(x, z) + sc * 0.2, z, sc, rnd() * 6.28, sc * 0.8, sc);
      }
    }
    spawn(merged.build(), mat('rock', { rough: 0.95 }), 0, 0, 0);
  }

  // ---- 围墙 + 露台 + 石阶 ----
  const colliders: BoxCollider[] = [];
  {
    const wt = buildWallAndTerrace();
    for (const p of wt.pieces) {
      let opts: Record<string, unknown> | undefined;
      if (p.mat === 'wallStone' && tex.stone !== undefined) opts = { tex: tex.stone, nrm: tex.stoneN, color: [1, 1, 1, 1] };
      else if (p.mat === 'wallFrame' && tex.stone !== undefined) opts = { tex: tex.stone, nrm: tex.stoneN, color: [1.0, 0.97, 0.90, 1] };
      else if (p.mat === 'terraceStone' && tex.stone !== undefined) opts = { tex: tex.stone, nrm: tex.stoneN, color: [1.0, 0.96, 0.94, 1] };
      spawn(p.buf.build(), mat(p.mat as MatName, opts as never), 0, 0, 0);
    }
    colliders.push(...wt.colliders);
    // 压顶上的陶罐紫花(A11)
    const pot = potMesh();
    let placed = 0;
    for (const [px, py, pz] of wt.postTops) {
      // 只放南向弧(view_01 可见)的 4 个
      if (pz > -20 && placed < 4) {
        spawn(pot, mat('pot'), px, py - 0.28, pz, rnd() * 3);
        spawn(lupineMesh(600 + placed * 7), mat('flowerPurple'), px, py + 0.34, pz, rnd() * 3, 1.4);
        placed++;
      }
    }
  }

  // ---- 主楼 ----
  const HOUSE: [number, number, number] = [7.5, HOUSE_BASE_Y, -45];
  const HOUSE_YAW = 0.22;
  {
    for (const p of houseGeometry()) {
      let opts: Record<string, unknown> | undefined;
      if (p.mat === 'glass') opts = { rough: 0.15 };
      else if (p.mat === 'houseWall' && tex.plaster !== undefined) opts = { tex: tex.plaster, nrm: tex.plasterN, color: [1, 1, 1, 1] };
      else if (p.mat === 'roofRed' && tex.roof !== undefined) opts = { tex: tex.roof, color: [1, 1, 1, 1], rough: 0.85 };
      else if (p.mat === 'masonry' && tex.stone !== undefined) opts = { tex: tex.stone, nrm: tex.stoneN, color: [1, 1, 1, 1] };
      else if (p.mat === 'canopyMid' && tex.canopy !== undefined) opts = { tex: tex.canopy, color: [0.28, 0.55, 0.24, 1] };
      else if (p.mat === 'terraceStone' && tex.stone !== undefined) opts = { tex: tex.stone, nrm: tex.stoneN, color: [1.0, 0.96, 0.94, 1] };
      if (p.mat === 'glow') {
        const gm = Materials.standard({ baseColor: [0.9, 0.72, 0.35, 1], emissive: [1.0, 0.78, 0.4], emissiveIntensity: 1.4, roughness: 0.5, metallic: 0, castShadow: false });
        const gh = world.allocSharedRef('MaterialAsset', gm);
        world.spawn(
          { component: Transform, data: { pos: [HOUSE[0], HOUSE[1], HOUSE[2]], quat: yawQuat(HOUSE_YAW), scale: [1.28, 1.28, 1.28] } },
          { component: MeshFilter, data: { assetHandle: meshRef(p.buf.build()) } },
          { component: MeshRenderer, data: { materials: [gh] } },
        ).unwrap();
        stats.entities++;
        continue;
      }
      spawn(p.buf.build(), mat(p.mat as MatName, opts as never), HOUSE[0], HOUSE[1], HOUSE[2], HOUSE_YAW, 1.28);
    }
    // 台基(hexBox 统一石纹密度)+ 顶部腰线环
    const plinth = new MeshBuf();
    {
      const hw = 8.7, hh = 3.25, hd = 7.6, K = 1 / 1.6;
      const c: [number, number, number][] = [
        [-hw, -hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [-hw, -hh, -hd],
        [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd],
      ];
      hexBox(plinth, c, 2 * hh * K);
      // 腰线(顶缘外挑 12cm 环)
      const cor = new MeshBuf();
      const c2: [number, number, number][] = [
        [-hw - 0.12, -0.14, hd + 0.12], [hw + 0.12, -0.14, hd + 0.12], [hw + 0.12, -0.14, -hd - 0.12], [-hw - 0.12, -0.14, -hd - 0.12],
        [-hw - 0.12, 0.14, hd + 0.12], [hw + 0.12, 0.14, hd + 0.12], [hw + 0.12, 0.14, -hd - 0.12], [-hw - 0.12, 0.14, -hd - 0.12],
      ];
      hexBox(cor, c2, 0.5);
      plinth.append(cor, 0, hh - 0.05, 0);
    }
    spawn(plinth.build(), tex.stone !== undefined ? mat('masonry', { tex: tex.stone, nrm: tex.stoneN, color: [1, 1, 1, 1] }) : mat('masonry'), HOUSE[0] + 1.2 * Math.sin(HOUSE_YAW), HOUSE_BASE_Y - 3.2, HOUSE[2] + 1.2 * Math.cos(HOUSE_YAW), HOUSE_YAW);
    {
      const cy = Math.cos(HOUSE_YAW), sy = Math.sin(HOUSE_YAW);
      const S = 1.28;
      const loc = (lx: number, lz: number): [number, number] => [HOUSE[0] + lx * S * cy + lz * S * sy, HOUSE[2] - lx * S * sy + lz * S * cy];
      const [mx, mz] = loc(0, 0);
      colliders.push({ pos: [mx, HOUSE_BASE_Y + 2, mz], half: [7.6, 8, 4.9], yaw: HOUSE_YAW });
      const [wx, wz] = loc(-3.1, 2.4);
      colliders.push({ pos: [wx, HOUSE_BASE_Y + 2, wz], half: [3.6, 8, 4.3], yaw: HOUSE_YAW });
      const [tx2, tz2] = loc(4.2, 2.3);
      colliders.push({ pos: [tx2, HOUSE_BASE_Y + 3, tz2], half: [2.6, 9, 2.6], yaw: HOUSE_YAW });
    }
  }

  // ---- 台基周圈锚接(灌木咬边 + 岩块) ----
  {
    const bb = bushBuf(31);
    const merged = new MeshBuf();
    for (const [bx2, bz2, bs] of [[1.0, -37.2, 0.9], [4.2, -36.4, 0.7], [10.5, -36.8, 0.85], [14.6, -38.5, 0.7], [0.2, -40.5, 0.75], [15.8, -42.5, 0.8]] as const) {
      merged.append(bb, bx2, groundHeight(bx2, bz2) + 0.1, bz2, bs, rnd() * 6.28, bs * 0.85, bs);
    }
    spawn(merged.build(), tex.canopy !== undefined ? mat('canopyLight', { tex: tex.canopy, color: [0.35, 0.65, 0.27, 1] }) : mat('canopyLight'), 0, 0, 0);
    const rk = rockBuf(53);
    const mr = new MeshBuf();
    mr.append(rk, 2.6, groundHeight(2.6, -36.2) + 0.15, -36.2, 0.7, 1.2, 0.6, 0.7);
    mr.append(rk, 13.2, groundHeight(13.2, -37.5) + 0.12, -37.5, 0.55, 2.8, 0.5, 0.55);
    spawn(mr.build(), mat('rock', { rough: 0.95 }), 0, 0, 0);
  }
  // 门侧陶罐花 ×2(门廊台阶两旁)
  {
    const potM = potMesh();
    for (const [px2, pz2, sd] of [[4.6, -33.2, 71], [7.6, -32.6, 72]] as const) {
      const gy2 = groundHeight(px2, pz2);
      spawn(potM, mat('pot'), px2, gy2, pz2, rnd() * 3, 1.15);
      spawn(lupineMesh(sd), mat('flowerPurple'), px2, gy2 + 0.72, pz2, rnd() * 3, 1.3);
    }
  }

  // ---- 露台上的物件(A3 告示牌 + 木箱 + 桶) + 灯柱(A12) ----
  {
    const bx = 0.5, bz = -29.5;
    spawn(boardMesh(), mat('woodLight'), bx, TERRACE_Y, bz, -0.5);
    const paper = paperMesh(), paperM = mat('paper', { noCull: true });
    const pr = mulberry(4);
    for (let i = 0; i < 5; i++) {
      const ox = (pr() - 0.5) * 1.6, oy = 1.15 + pr() * 0.75;
      // 贴在板面(板 yaw=-0.5,法线 (sin,cos) 方向偏移)
      spawn(paper, paperM, bx + Math.cos(-0.5) * ox + Math.sin(-0.5) * 0.08, TERRACE_Y + oy, bz - Math.sin(-0.5) * ox + Math.cos(-0.5) * 0.08, -0.5, 0.9 + pr() * 0.5);
    }
    colliders.push({ pos: [bx, TERRACE_Y + 1, bz], half: [1.2, 1.2, 0.2], yaw: -0.5 });
    const crate = crateMesh();
    for (const [cx, cy, cz, s, yw] of [
      [-1.8, 0.42, -30.6, 0.85, 0.3], [-1.7, 1.22, -30.7, 0.72, 0.9], [-0.9, 0.36, -29.6, 0.72, 0.1],
      [5.6, 0.42, -28.8, 0.85, 1.2],
    ] as const) {
      spawn(crate, mat('woodLight'), cx, TERRACE_Y + cy - 0.42 + s / 2, cz, yw, s);
      colliders.push({ pos: [cx, TERRACE_Y + 0.5, cz], half: [s / 2, 0.8, s / 2], yaw: yw });
    }
    spawn(barrelMesh(), mat('woodDark'), 6.8, TERRACE_Y, -29.6, 0.4);
    spawn(tableMesh(), mat('woodLight'), 2.8, TERRACE_Y, -31.5, 0.3);
    spawn(chairMesh(), mat('woodLight'), 1.9, TERRACE_Y, -31.0, 2.4);
    spawn(chairMesh(), mat('woodLight'), 3.8, TERRACE_Y, -32.0, -0.7);
    colliders.push({ pos: [2.8, TERRACE_Y + 0.5, -31.5], half: [0.6, 0.8, 0.6], yaw: 0 });
    // 叙事散件
    spawn(ropeCoilMesh(), mat('woodLight'), -1.6, TERRACE_Y + 0.86, -30.5, 0.8);        // 木箱顶绳圈
    spawn(bottleMesh(1), mat('glass', { rough: 0.25, color: [0.45, 0.68, 0.60, 1] }), 2.6, TERRACE_Y + 0.78, -31.4, 0);
    spawn(bottleMesh(2), mat('glass', { rough: 0.25, color: [0.52, 0.60, 0.42, 1] }), 3.0, TERRACE_Y + 0.78, -31.7, 0.7);
    {
      const pl = new MeshBuf();
      const prd = mulberry(64);
      for (let i = 0; i < 3; i++) {
        plankM(pl, 1.5 + prd() * 3.5, TERRACE_Y + 0.035, -27.0 - prd() * 2.2, prd() * 6.28, 0.9 + prd() * 0.5);
      }
      spawn(pl.build(), mat('woodLight'), 0, 0, 0);
    }
    {
      const lv = new MeshBuf();
      const lrd = mulberry(65);
      for (let i = 0; i < 16; i++) {
        const lx = -2 + lrd() * 12, lz = -33 + lrd() * 6;
        const a = lrd() * 6.28, sz2 = 0.05 + lrd() * 0.05;
        const c0 = lv.vert(lx, TERRACE_Y + 0.045, lz, 0, 0, [0, 1, 0]);
        const c1 = lv.vert(lx + Math.cos(a) * sz2, TERRACE_Y + 0.045, lz + Math.sin(a) * sz2, 1, 0, [0, 1, 0]);
        const c2 = lv.vert(lx + Math.cos(a + 2.1) * sz2, TERRACE_Y + 0.05, lz + Math.sin(a + 2.1) * sz2, 0, 1, [0, 1, 0]);
        lv.tri(c0, c1, c2);
      }
      spawn(lv.build(), mat('canopyLight', { noShadow: true }), 0, 0, 0);
    }
    {
      const pp = new MeshBuf();
      const q = [
        pp.vert(-0.12, 0, -0.16, 0, 0, [0, 1, 0]), pp.vert(0.12, 0, -0.15, 1, 0, [0, 1, 0]),
        pp.vert(0.13, 0.01, 0.16, 1, 1, [0, 1, 0]), pp.vert(-0.11, 0.005, 0.17, 0, 1, [0, 1, 0]),
      ];
      pp.quad(q[0], q[1], q[2], q[3]);
      spawn(pp.build(), mat('paper', { noCull: true, noShadow: true }), 4.4, TERRACE_Y + 0.04, -29.8, 1.2);
    }
    spawn(lampMesh(), mat('woodDark'), 12.6, TERRACE_Y, -39.5, 2.6);
    {
      const gm = Materials.standard({ baseColor: [0.9, 0.7, 0.3, 1], emissive: [1.0, 0.75, 0.35], emissiveIntensity: 1.6, roughness: 0.4, metallic: 0 });
      const gh = world.allocSharedRef('MaterialAsset', gm);
      const lantX = 12.6 - 0.75 * Math.cos(2.6), lantZ = -39.5 + 0.75 * Math.sin(2.6); // 灯杆末端(append 旋转约定)
      world.spawn(
        { component: Transform, data: { pos: [lantX, TERRACE_Y + 2.55, lantZ] } },
        { component: MeshFilter, data: { assetHandle: meshRef(lampGlassMesh()) } },
        { component: MeshRenderer, data: { materials: [gh] } },
      ).unwrap();
      stats.entities++;
    }
    colliders.push({ pos: [12.6, TERRACE_Y + 1.2, -39.5], half: [0.12, 1.3, 0.12], yaw: 0 });
  }

  // ---- 前景大树(A6) + 歪栅栏(A7) + 路边栅栏 ----
  {
    {
      const gy = groundHeight(-4.4, -5.8) - 0.1;
      const tb = new MeshBuf();
      const tips = branchedTrunk(tb, 997, 6.0, 0.55);
      spawn(tb.build(), tex.bark !== undefined ? mat('trunk', { tex: tex.bark, color: [1, 1, 1, 1] }) : mat('trunk'), -4.4, gy, -5.8, 0);
      const cbuf = new MeshBuf();
      const lb = new MeshBuf(); blob(lb, 1.6, 1.15, 1.6, 311, 0.20, 12, 8);
      const hr = mulberry(881);
      for (const t of tips) cbuf.append(lb, t[0] * 0.85, t[1] + 0.55, t[2] * 0.85, 1.05 + hr() * 0.55, hr() * 6.28);
      // 冠芯大团(把枝端全部包进冠里)
      const maxY = tips.reduce((m, t) => Math.max(m, t[1]), 0);
      cbuf.append(lb, -0.4, maxY * 0.92, -0.2, 1.6, 1.2);
      cbuf.append(lb, 0.9, maxY * 0.80, 0.5, 1.2, 3.4);
      cbuf.append(lb, -1.4, maxY * 0.78, 0.4, 1.1, 5.1);
      spawn(cbuf.build(), tex.canopy !== undefined ? mat('canopyMid', { noShadow: true, tex: tex.canopy, color: [0.27, 0.54, 0.23, 1] }) : mat('canopyMid', { noShadow: true }), -4.4, gy, -5.8, 0);
    }
    colliders.push({ pos: [-4.4, groundHeight(-4.4, -5.8) + 2, -5.8], half: [0.5, 3, 0.5], yaw: 0 });

    // 连续栅栏链:散段各自为政读作碎片,改为柱+双横杆沿折线连通、逐柱贴地
    const fenceM = mat('woodLight');
    const chain = (pts: readonly (readonly [number, number])[]): void => {
      const posts: [number, number][] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        const nSeg = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.1));
        for (let k = 0; k < nSeg; k++) posts.push([x0 + (x1 - x0) * k / nSeg, z0 + (z1 - z0) * k / nSeg]);
      }
      posts.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
      const top = posts.map(([x, z]) => groundHeight(x, z));
      const buf = new MeshBuf();
      for (let i = 0; i < posts.length; i++) {
        const [x, z] = posts[i];
        tube(buf, [x, top[i] - 0.25, z], [x, top[i] + 1.06, z], 0.062, 0.052, 6);
      }
      for (let i = 0; i + 1 < posts.length; i++) {
        const [x0, z0] = posts[i], [x1, z1] = posts[i + 1];
        for (const h of [0.58, 0.96]) tube(buf, [x0, top[i] + h, z0], [x1, top[i + 1] + h, z1], 0.042, 0.042, 5);
      }
      spawn(buf.build(), fenceM, 0, 0, 0);
    };
    chain([[-0.8, -4.3], [0.8, -4.7], [3.0, -5.6], [5.2, -6.8], [7.4, -8.3]]);           // 前景弧(路东,A7)
    chain([[-6.3, -3.2], [-8.2, -7.5], [-10.4, -12.5], [-12.6, -17.5], [-13.8, -21.8]]); // 西侧牧道栏
    chain([[5.0, 10.8], [7.0, 9.7], [9.2, 8.5]]);                                        // 身后段
  }

  // ---- 树(3 变体实例化) ----
  {
    const places: [number, number, number, number][][] = [[], [], []]; // x,z,yaw,scale
    const put = (x: number, z: number, s: number): void => {
      places[Math.floor(rnd() * 3)].push([x, z, rnd() * 6.28, s]);
    };
    // 北树墙(楼后偏东成丛;左中留出雪山视界)
    for (let i = 0; i < 8; i++) {
      const px = -4 + i * 4.8 + rnd() * 2.5;
      const skyline = px > 1 && px < 16; // 屋顶剪影区:后移+缩小,给天空留窗口
      put(px, (skyline ? -64 : -56) - rnd() * 6, (skyline ? 1.0 : 1.35) + rnd() * 0.65);
    }
    for (let i = 0; i < 6; i++) put(2 + i * 6.2 + rnd() * 3, -66 - rnd() * 8, 1.7 + rnd() * 0.75);
    // 西北远丛(小,不挡山)
    for (let i = 0; i < 5; i++) put(-42 + i * 7 + rnd() * 3, -66 - rnd() * 10, 1.0 + rnd() * 0.5);
    // 东坡树丛(楼右)
    for (const [x, z] of [[19, -33], [24, -39], [28, -30], [33, -42], [23, -48], [30, -52], [36, -33], [40, -44]] as const) put(x + rnd(), z + rnd(), 0.9 + rnd() * 0.7);
    put(18, -26, 1.7); put(26, -31, 1.85);
    // 西侧散树
    for (const [x, z] of [[-28, -37], [-38, -46], [-49, -39], [-33, -58], [-45, -62], [-56, -50], [-24, -48], [-60, -40], [-52, -72]] as const) put(x, z, 0.6 + rnd() * 0.5);
    // 中远小树
    for (let i = 0; i < 9; i++) put(-65 + rnd() * 110, -74 - rnd() * 20, 0.7 + rnd() * 0.5);
    // 南缘收边
    for (let i = 0; i < 6; i++) put(-40 + rnd() * 75, 20 + rnd() * 10, 0.9 + rnd() * 0.6);
    const trunksAll = new MeshBuf();
    const tops = new MeshBuf();
    const topBlob = new MeshBuf();
    blob(topBlob, 1.1, 0.75, 1.1, 71, 0.3, 8, 5);
    const leafA = new MeshBuf(); blob(leafA, 1.15, 0.85, 1.15, 301, 0.22, 11, 7);
    const leafB = new MeshBuf(); blob(leafB, 0.85, 0.62, 0.85, 307, 0.26, 10, 6);
    const canopyByMat: Record<string, MeshBuf> = { canopyMid: new MeshBuf(), canopyDark: new MeshBuf() };
    let heroSeed = 0;
    for (let v = 0; v < 3; v++) {
      const list = places[v];
      if (list.length === 0) continue;
      const trunkBuf = treeTrunkBuf(20 + v, 2.5), canopyBuf = treeCanopyBuf(30 + v * 3, 2.3);
      const target = canopyByMat[v === 1 ? 'canopyDark' : 'canopyMid'];
      for (const [x, z, yw, sc] of list) {
        const y = groundHeight(x, z) - 0.15;
        if (sc >= 1.5) {
          // hero:分枝树干 + 末梢冠团
          const hbuf = new MeshBuf();
          const tips = branchedTrunk(hbuf, 700 + heroSeed * 13, 3.4 * sc, 0.24 * sc);
          trunksAll.append(hbuf, x, y, z, 1, yw);
          const hr = mulberry(800 + heroSeed * 7);
          const maxY = tips.reduce((m, t) => Math.max(m, t[1]), 0);
          for (const t of tips) {
            const cs = sc * (0.82 + hr() * 0.30);
            const buf2 = hr() < 0.5 ? leafA : leafB;
            const isTop = t[1] > maxY * 0.72;
            (isTop ? tops : target).append(buf2, x + t[0] * 0.88, y + t[1] + 0.22 * cs, z + t[2] * 0.88, cs, hr() * 6.28);
          }
          // 两个中心大团补冠芯
          target.append(leafA, x, y + maxY * 0.72, z, sc * 0.95, hr() * 6.28);
          tops.append(leafB, x - 0.5 * sc, y + maxY * 0.98, z + 0.3 * sc, sc * 0.7, hr() * 6.28);
          heroSeed++;
        } else {
          trunksAll.append(trunkBuf, x, y, z, sc, yw);
          target.append(canopyBuf, x, y + (2.5 + 0.55) * sc, z, sc * 1.15, yw, sc, sc * 1.15);
          tops.append(topBlob, x - 0.7 * sc, y + (2.5 + 1.35) * sc, z + 0.5 * sc, sc, yw);
        }
      }
    }
    spawn(trunksAll.build(), tex.bark !== undefined ? mat('trunk', { tex: tex.bark, color: [1, 1, 1, 1] }) : mat('trunk'), 0, 0, 0);
    spawn(canopyByMat.canopyMid.build(), tex.canopy !== undefined ? mat('canopyMid', { tex: tex.canopy, color: [0.27, 0.54, 0.23, 1] }) : mat('canopyMid'), 0, 0, 0);
    spawn(canopyByMat.canopyDark.build(), tex.canopy !== undefined ? mat('canopyDark', { tex: tex.canopy, color: [0.19, 0.41, 0.18, 1] }) : mat('canopyDark'), 0, 0, 0);
    spawn(tops.build(), tex.canopy !== undefined ? mat('canopyLight', { tex: tex.canopy, color: [0.35, 0.65, 0.27, 1] }) : mat('canopyLight'), 0, 0, 0);
  }

  // ---- 灌木(墙前一排 + 散布) ----
  {
    const bush = bushBuf(8);
    const pts: [number, number, number][] = [];
    // 挡土墙根部 + 花园坡(view_01:墙前后灌木团)
    for (let a = -34; a <= 58; a += 13) {
      const rad = (a * Math.PI) / 180;
      const x = -Math.sin(rad) * 10.1;
      const z = -24 + Math.cos(rad) * 10.1;
      pts.push([x, z, 0.7 + rnd() * 0.8]);
    }
    for (const [gx, gz] of [[-3, -21], [4, -20.5], [8, -23], [-6, -27], [9, -30], [-2, -25]] as const) {
      pts.push([gx, gz, 0.6 + rnd() * 0.7]);
    }
    for (let i = 0; i < 10; i++) pts.push([-45 + rnd() * 80, -30 + rnd() * 45, 0.6 + rnd() * 0.8]);
    const merged = new MeshBuf();
    // 统一让路:灌木半径 ~1m,路半宽 1.7m,轴距 <2.8 必然侵占路面
    for (const [x, z, sc] of pts) {
      if (pathDistance(x, z) < 2.8) continue;
      merged.append(bush, x, groundHeight(x, z) + 0.15 * sc, z, sc, rnd() * 6.28, sc * (0.8 + rnd() * 0.4), sc);
    }
    spawn(merged.build(), tex.canopy !== undefined ? mat('canopyLight', { tex: tex.canopy, color: [0.35, 0.65, 0.27, 1] }) : mat('canopyLight'), 0, 0, 0);
  }

  // ---- 岩石 ----
  {
    const rock = rockBuf(5);
    // 东岩壁(A9):大块层叠
    const big: [number, number, number, number][] = [
      [27, -30, 3.2, 0.2], [30, -34, 4.4, 1.4], [26.5, -27, 2.2, 2.8], [33, -39, 5.2, 0.8], [29, -31.5, 2.6, 4.4],
    ];
    // 草甸小石(view_01 左中)
    const small: [number, number, number, number][] = [];
    for (let i = 0; i < 14; i++) small.push([-30 + rnd() * 45, -28 + rnd() * 40, 0.3 + rnd() * 0.55, rnd() * 6.28]);
    small.push([-5.9, -4.6, 0.5, 1], [-12, -13, 0.7, 2], [10.5, -12, 0.6, 0.5]);
    const all = [...big, ...small];
    const merged = new MeshBuf();
    for (const [x, z, sc, yw] of all) {
      if (pathDistance(x, z) < 2.6) continue; // 石头不压路
      merged.append(rock, x, groundHeight(x, z) + sc * 0.22, z, sc, yw, sc, sc * (0.8 + rnd() * 0.4));
    }
    spawn(merged.build(), mat('rock', { rough: 0.95 }), 0, 0, 0);
    for (const [x, z, s] of big) colliders.push({ pos: [x, groundHeight(x, z) + s * 0.3, z], half: [s * 0.8, s * 0.6, s * 0.7], yaw: 0 });
  }

  // ---- 草簇(实例化,避开路面和露台) ----
  {
    const useCard = tex.grassCard !== undefined;
    const tuft = useCard ? grassCardMesh() : grassTuftMesh();
    const cardMat = (tint: RGBA): MatH => useCard
      ? mat('grass', { tex: tex.grassCard, cutoff: 0.5, noCull: true, noShadow: true, color: tint })
      : mat('grass', { noCull: true, color: tint });
    // 景观分区(叙事):0=庭院草坪(修剪,短疏) 1=放牧草甸 2=田缘高草带(框景)
    const zoneOf = (x: number, z: number): number => {
      const dTer = Math.hypot(x - TERRACE_CENTER[0], z - TERRACE_CENTER[1]);
      if (dTer < 16 || pathDistance(x, z) < 3.2) return 0;
      if (x < -40 || x > 34 || z < -54 || z > 14) return 2;
      return 1;
    };
    const list: number[] = [];
    let n = 0;
    for (let i = 0; i < 22000 && n < 8100; i++) {
      const x = -52 + rnd() * 96, z = -58 + rnd() * 82;
      const dTer = Math.hypot(x - TERRACE_CENTER[0], z - TERRACE_CENTER[1]);
      if (dTer < TERRACE_R + 1.2) continue;
      if (Math.abs(x - 7.5) < 9.5 && Math.abs(z + 45) < 6.5) continue; // 台基
      if (Math.abs(Math.hypot(x - 0, z + 24) - 8.5) < 0.8) continue;   // 挡土墙立面
      if (pathDistance(x, z) < 2.7) continue; // 路半宽 1.7 + 草卡半宽 ~0.65 + 余量
      const y = groundHeight(x, z);
      if (y > 7) continue;
      const zn = zoneOf(x, z);
      if (zn === 0 && rnd() < 0.62) continue; // 草坪:修剪过,稀疏
      const zK = zn === 0 ? 0.5 : zn === 2 ? 1.45 : 1.12;
      const nearK = Math.max(0.5, Math.min(1, Math.hypot(x, z) / 12));
      list.push(x, y - 0.05, z, rnd() * 6.28, (0.55 + rnd() * 0.75) * nearK * zK);
      n++;
    }
    // 单个 Instances 实体上限 4096 实例(managed-buffer 262144 字节),拆两半。
    // 注意:引擎按"实体位置+基础网格包围盒"做视锥剔除,锚点必须放在草区中心,
    // 且实例平移要减去锚点(渲染位置 = 锚 + 局部),否则整批草被剔或整体错位。
    const GAX = 0, GAZ = -18;
    const half = Math.ceil(n / 2);
    for (let part = 0; part < 2; part++) {
      const cnt = part === 0 ? half : n - half;
      if (cnt <= 0) continue;
      const tf = new Float32Array(cnt * 16);
      for (let i = 0; i < cnt; i++) {
        const j = part * half + i;
        composeYaw(tf, i * 16, list[j * 5] - GAX, list[j * 5 + 1], list[j * 5 + 2] - GAZ, list[j * 5 + 3], list[j * 5 + 4], list[j * 5 + 4], list[j * 5 + 4]);
      }
      spawnInstanced(tuft, cardMat([1, 1, 1, 1]), tf, GAX, GAZ);
    }
    stats.instancedTris += n * 5;
    // 干草斑(暖黄绿,成片;只落草甸/边缘带,庭院草坪保持修剪感)
    const dryList: number[] = [];
    let dn = 0;
    for (let c = 0; c < 22; c++) {
      const cx = -46 + rnd() * 84, cz = -52 + rnd() * 72;
      if (pathDistance(cx, cz) < 5 || Math.hypot(cx - TERRACE_CENTER[0], cz - TERRACE_CENTER[1]) < 20) continue;
      for (let k = 0; k < 24; k++) {
        const x = cx + (rnd() - 0.5) * 5, z = cz + (rnd() - 0.5) * 5;
        const y = groundHeight(x, z);
        if (y > 7) continue;
        if (zoneOf(x, z) === 0) continue;
        if (Math.abs(x - 7.5) < 9.5 && Math.abs(z + 45) < 6.5) continue;
        if (Math.hypot(x, z) < 13) continue; // 近景干草太高挡路
        dryList.push(x, y - 0.05, z, rnd() * 6.28, 1.0 + rnd() * 0.9);
        dn++;
      }
    }
    const dtf = new Float32Array(dn * 16);
    for (let i = 0; i < dn; i++) composeYaw(dtf, i * 16, dryList[i * 5] - GAX, dryList[i * 5 + 1], dryList[i * 5 + 2] - GAZ, dryList[i * 5 + 3], dryList[i * 5 + 4], dryList[i * 5 + 4], dryList[i * 5 + 4]);
    spawnInstanced(tuft, useCard ? mat('grassDry', { tex: tex.grassCard, cutoff: 0.5, noCull: true, noShadow: true, color: [1, 0.9, 0.6, 1] }) : mat('grassDry', { noCull: true }), dtf, GAX, GAZ);
    stats.instancedTris += dn * 5;
    // 近景特写草(REFERENCE:前景 v0.85+ 草叶清晰)
    const nearList: number[] = [];
    let nn = 0;
    for (let i = 0; i < 2200 && nn < 850; i++) {
      const x = -8 + rnd() * 18, z = -9 + rnd() * 10;
      if (pathDistance(x, z) < 2.5) continue;
      if (Math.hypot(x, z) < 2.5) continue; // 相机脚下留空
      nearList.push(x, groundHeight(x, z) - 0.05, z, rnd() * 6.28, 0.75 + rnd() * 0.6);
      nn++;
    }
    const ntf = new Float32Array(nn * 16);
    for (let i = 0; i < nn; i++) composeYaw(ntf, i * 16, nearList[i * 5] - 2, nearList[i * 5 + 1], nearList[i * 5 + 2] + 4, nearList[i * 5 + 3], nearList[i * 5 + 4], nearList[i * 5 + 4], nearList[i * 5 + 4]);
    spawnInstanced(tuft, cardMat([1, 1, 1, 1]), ntf, 2, -4);
  }

  // ---- 花(景观规划:路缘蓝花带 / 草甸橙花丛 / 林缘白花 / 门口紫花重点) ----
  {
    const gauss = (): number => (rnd() + rnd() + rnd()) / 1.5 - 1; // 近似高斯 [-1,1]
    type Drift = { buf: MeshBuf; matN: MatName; count: number; s: number; sample: () => readonly [number, number] | null };
    // 橙花丛中心(草甸里成组;东侧两丛入画右,前景两丛)
    const orangeClumps: [number, number][] = [[19, -13], [27, -22], [-17, -7], [13, 5], [-8, 9]];
    // 紫花重点:路终点接台阶处 + 挡土墙缺口
    const purpleSpots: [number, number][] = [[6.5, -31.5], [-9.8, -21.5]];
    const drifts: Drift[] = [
      { // 蓝花:沿小路两侧 2.3-4.2m 的伴路花带(全程)
        buf: flowerBuf('round', 1), matN: 'flowerBlue', count: 340, s: 0.9,
        sample: () => {
          const x = -16 + rnd() * 28, z = -36 + rnd() * 50;
          const pd = pathDistance(x, z);
          return pd > 2.3 && pd < 4.2 ? [x, z] : null;
        },
      },
      { // 橙花:草甸固定花丛(拉长的高斯团,有主方向)
        buf: flowerBuf('round', 2), matN: 'flowerOrange', count: 260, s: 1.0,
        sample: () => {
          const c = orangeClumps[Math.floor(rnd() * orangeClumps.length)];
          return [c[0] + gauss() * 3.4, c[1] + gauss() * 2.0];
        },
      },
      { // 白花(伞形小白花):只在林缘,不再散在田中央
        buf: flowerBuf('round', 4), matN: 'flowerWhite', count: 120, s: 1.4,
        sample: () => {
          const east = rnd() < 0.6;
          const x = east ? 26 + rnd() * 12 : -42 + rnd() * 8;
          const z = -50 + rnd() * 58;
          return [x, z];
        },
      },
      { // 紫花:门口/墙缺口重点栽植
        buf: lupineBuf(3), matN: 'flowerPurple', count: 26, s: 1.1,
        sample: () => {
          const c = purpleSpots[Math.floor(rnd() * purpleSpots.length)];
          return [c[0] + gauss() * 1.6, c[1] + gauss() * 1.3];
        },
      },
    ];
    for (const g of drifts) {
      const merged = new MeshBuf();
      let placed = 0, guard = 0;
      while (placed < g.count && guard++ < g.count * 10) {
        const p = g.sample();
        if (p === null) continue;
        const [x, z] = p;
        const y = groundHeight(x, z);
        if (y > 6.5) continue;
        if (pathDistance(x, z) < 2.1) continue;
        if (Math.hypot(x - TERRACE_CENTER[0], z - TERRACE_CENTER[1]) < TERRACE_R + 1) continue;
        if (Math.abs(x - 7.5) < 9.5 && Math.abs(z + 45) < 6.5) continue; // 台基
        merged.append(g.buf, x, y, z, g.s * (0.8 + rnd() * 0.5), rnd() * 6.28, g.s * (0.8 + rnd() * 0.5), g.s * (0.8 + rnd() * 0.5));
        placed++;
      }
      spawn(merged.build(), mat(g.matN), 0, 0, 0);
    }
  }

  // ---- 田园叙事道具:圆草捆 / 菜园 / 晾衣绳 ----
  {
    // 圆草捆:横轴圆柱 + 端面盘,秸秆感靠半径抖动
    const baleMesh = (seed: number): MeshAsset => {
      const buf = new MeshBuf();
      const r0 = mulberry(seed);
      const R = 0.92, HW = 0.72, SEG = 18;
      const xs = [-HW, -HW * 0.94, -HW * 0.5, 0, HW * 0.5, HW * 0.94, HW];
      const rs = [R * 0.55, R * 0.96, R, R, R, R * 0.96, R * 0.55];
      const rows: number[][] = [];
      for (let j = 0; j < xs.length; j++) {
        const row: number[] = [];
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * Math.PI * 2;
          const rr = rs[j] * (1 + (r0() - 0.5) * 0.05);
          row.push(buf.vert(xs[j], Math.cos(a) * rr, Math.sin(a) * rr, i / SEG * 3, j / xs.length));
        }
        rows.push(row);
      }
      for (let j = 0; j + 1 < rows.length; j++) {
        for (let i = 0; i < SEG; i++) buf.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
      }
      // 端面盘(螺旋卷的正面;双面发,免得绕序判断错被剔除)
      for (const x of [-HW, HW]) {
        const c = buf.vert(x, 0, 0, 0.5, 0.5);
        for (let i = 0; i < SEG; i++) {
          const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
          const v0 = buf.vert(x, Math.cos(a0) * R * 0.58, Math.sin(a0) * R * 0.58, 0.5 + Math.cos(a0) * 0.4, 0.5 + Math.sin(a0) * 0.4);
          const v1 = buf.vert(x, Math.cos(a1) * R * 0.58, Math.sin(a1) * R * 0.58, 0.5 + Math.cos(a1) * 0.4, 0.5 + Math.sin(a1) * 0.4);
          buf.tri(c, v0, v1);
          buf.tri(c, v1, v0);
        }
      }
      return buf.build();
    };
    const bales: [number, number, number][] = [[22.5, -16.5, 0.6], [25.8, -14.2, 2.1], [21.0, -20.5, 1.2]];
    for (let i = 0; i < bales.length; i++) {
      const [bx, bz, byaw] = bales[i];
      spawn(baleMesh(910 + i * 13), mat('hay', { rough: 0.95, tex: tex.plaster }), bx, groundHeight(bx, bz) + 0.82, bz, byaw);
    }

    // 菜园:泥土垄 ×4 + 卷心菜球,路弯外侧(左中景)
    {
      const GX = -16.5, GZ = -29, GYAW = 0.3;
      const soil = new MeshBuf(), veg = new MeshBuf();
      const cs = Math.cos(GYAW), sn = Math.sin(GYAW);
      const rg = mulberry(4407);
      for (let r = 0; r < 4; r++) {
        const off = (r - 1.5) * 0.95;
        const cx = GX + sn * off, cz = GZ + cs * off; // 垄排列方向 ⊥ 垄长向
        // 垄拆 5 段逐段贴地(整根只贴中心在坡上会两端悬空)
        for (let sSeg = 0; sSeg < 5; sSeg++) {
          const st = (sSeg / 4 - 0.5) * 3.5;
          const sx = cx + cs * st, sz = cz - sn * st;
          const ridge = new MeshBuf();
          softBox(ridge, 0.98, 0.30, 0.60, 0.10);
          soil.append(ridge, sx, groundHeight(sx, sz) + 0.08, sz, 1, GYAW, 1, 1);
        }
        for (let k = 0; k < 6; k++) {
          const t = (k / 5 - 0.5) * 3.8;
          const px = cx + cs * t, pz = cz - sn * t;
          const cab = new MeshBuf();
          blob(cab, 0.19, 0.15, 0.19, 5000 + r * 31 + k, 0.18, 8, 5);
          veg.append(cab, px + (rg() - 0.5) * 0.12, groundHeight(px, pz) + 0.30, pz + (rg() - 0.5) * 0.12, 0.8 + rg() * 0.5, rg() * 6.28, 0.8 + rg() * 0.4, 0.8 + rg() * 0.5);
        }
      }
      spawn(soil.build(), mat('soil', { rough: 1.0 }), 0, 0, 0);
      spawn(veg.build(), mat('cabbage', { rough: 0.85 }), 0, 0, 0);
    }

    // 晾衣绳:双木杆 + 悬链绳 + 三件挂布(房西侧草坪,主视角楼左)
    {
      const pA: [number, number] = [1.6, -41.3], pB: [number, number] = [-4.2, -38.3];
      const yA = groundHeight(pA[0], pA[1]), yB = groundHeight(pB[0], pB[1]);
      const hA = 2.85, hB = 2.65;
      const buf = new MeshBuf();
      tube(buf, [pA[0], yA - 0.2, pA[1]], [pA[0], yA + hA + 0.08, pA[1]], 0.055, 0.045, 7);
      tube(buf, [pB[0], yB - 0.2, pB[1]], [pB[0], yB + hB + 0.08, pB[1]], 0.055, 0.045, 7);
      // 横杆头
      tube(buf, [pA[0] - 0.22, yA + hA, pA[1]], [pA[0] + 0.22, yA + hA, pA[1]], 0.035, 0.035, 5);
      tube(buf, [pB[0] - 0.22, yB + hB, pB[1]], [pB[0] + 0.22, yB + hB, pB[1]], 0.035, 0.035, 5);
      spawn(buf.build(), mat('woodDark', { rough: 0.9 }), 0, 0, 0);
      const top = (t: number): [number, number, number] => [
        pA[0] + (pB[0] - pA[0]) * t,
        (yA + hA) + ((yB + hB) - (yA + hA)) * t - 0.22 * 4 * t * (1 - t),
        pA[1] + (pB[1] - pA[1]) * t,
      ];
      const rope = new MeshBuf();
      for (let s = 0; s < 6; s++) tube(rope, top(s / 6), top((s + 1) / 6), 0.014, 0.014, 4);
      spawn(rope.build(), mat('paper', { rough: 0.9 }), 0, 0, 0);
      // 挂布:顶边贴绳,底边微摆(双面)
      const dirX = pB[0] - pA[0], dirZ = pB[1] - pA[1];
      const dl = Math.hypot(dirX, dirZ);
      const ux = dirX / dl, uz = dirZ / dl;
      const cloths: [number, number, number, MatName][] = [
        [0.28, 0.62, 0.78, 'flowerWhite'], [0.5, 0.55, 0.62, 'flowerBlue'], [0.72, 0.5, 0.55, 'flowerOrange'],
      ];
      for (const [t, w, h, cn] of cloths) {
        const cbuf = new MeshBuf();
        const c0 = top(t - w / dl / 2), c1 = top(t + w / dl / 2);
        const sway = 0.10;
        const a = cbuf.vert(c0[0], c0[1], c0[2], 0, 0);
        const b = cbuf.vert(c1[0], c1[1], c1[2], 1, 0);
        const c2 = cbuf.vert(c1[0] + uz * sway, c1[1] - h, c1[2] - ux * sway, 1, 1);
        const d = cbuf.vert(c0[0] + uz * sway, c0[1] - h, c0[2] - ux * sway, 0, 1);
        cbuf.quad(a, b, c2, d);
        spawn(cbuf.build(), mat(cn, { noCull: true, rough: 0.95 }), 0, 0, 0);
      }
    }
  }

  // ---- 远景:远树带 / 远草原盘 / 雪山 ----
  {
    spawn(farTreeBand(2, 420, 15), mat('farTrees', { unlit: true }), -40, 2, -135);
    spawn(farTreeBand(9, 300, 11), mat('farTrees', { unlit: true }), 120, 1, -160, 0.3);
    // 远草原环带(填地平线;内缘藏在地形边界外、低于地形,别盖住近景)
    const disk = new MeshBuf();
    const segD = 26;
    const ringI: number[] = [], ringO: number[] = [];
    for (let i = 0; i <= segD; i++) {
      const a = (i / segD) * Math.PI * 2;
      ringI.push(disk.vert(Math.cos(a) * 95, -2.5, Math.sin(a) * 95, 0.5, 0, [0, 1, 0]));
      ringO.push(disk.vert(Math.cos(a) * 640, 1.5 + Math.sin(a * 3) * 2, Math.sin(a) * 640, 0.5, 1, [0, 1, 0]));
    }
    for (let i = 0; i < segD; i++) disk.quad(ringO[i], ringI[i], ringI[i + 1], ringO[i + 1]);
    spawn(disk.build(), mat('farMeadow', { unlit: true }), 0, 0, 0);
    // 雪山群(A8 主群 NW:主峰对 u0.17;次群 E,推断)
    const m1 = mountainRange(31, 1000, -6, 130, [
      [-55, 245, 190], [-215, 170, 160], [95, 172, 150], [235, 130, 130],
      [-345, 125, 140], [-135, 105, 90], [25, 96, 80], [-440, 80, 110], [330, 84, 110],
    ]);
    const m2 = mountainRange(77, 560, -6, 110, [[-80, 115, 150], [60, 94, 120], [180, 77, 110], [-190, 64, 90]]);
    for (const [m, mx, mz] of [[m1, -180, -730], [m2, 400, -680]] as const) {
      spawn(m.lit, mat('mtnLit', { unlit: true, tex: tex.mtn }), mx, 0, mz);
      spawn(m.shade, mat('mtnShade', { unlit: true, tex: tex.mtn }), mx, 0, mz);
      spawn(m.snowLit, mat('snowLit', { unlit: true, tex: tex.mtn }), mx, 0, mz);
      spawn(m.snowShade, mat('snowShade', { unlit: true, tex: tex.mtn }), mx, 0, mz);
    }
    // 山麓带(压住山脚,ref 峰下有蓝绿丘带)
    spawn(farTreeBand(13, 800, 55), mat('mtnShade', { unlit: true, tex: tex.mtn }), -220, -2, -470);
  }

  // ---- 雾幕(HDR 域几何大气透视;每层 alpha 低,层层叠出距离感) ----
  if (tex.fog !== undefined) {
    const shells: [number, number, number][] = [[30, 0.22, 24], [55, 0.55, 24], [85, 0.75, 26], [130, 1.0, 34], [200, 1.0, 44]];
    for (const [r, strength, topH] of shells) {
      const asset = Materials.unlit([strength, strength, strength, strength], {
        baseColorTexture: tex.fog,
        castShadow: false,
        queue: 3000,
        renderState: { cullMode: 'none', depthWriteEnabled: false, blend: PREMUL_BLEND },
      });
      const h = world.allocSharedRef('MaterialAsset', asset);
      const meshH = world.allocSharedRef('MeshAsset', fogCylinder(r, -2.5, topH));
      world.spawn(
        { component: Transform, data: { pos: [0, 0, -12] } },
        { component: MeshFilter, data: { assetHandle: meshH } },
        { component: MeshRenderer, data: { materials: [h] } },
      ).unwrap();
      stats.entities++;
    }
  }

  // ---- 碰撞体实体 ----
  for (const c of colliders) {
    const q = quat.create();
    quat.fromAxisAngle(q, [0, 1, 0], c.yaw);
    world.spawn(
      { component: Transform, data: { pos: c.pos, quat: [q[0], q[1], q[2], q[3]] } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtents: c.half } },
    ).unwrap();
    stats.entities++;
  }

  stats.meshTris = 0; // 由 lib.TRI_COUNT 汇总,main 里填
  return stats;
}

/** 天空穹顶:贴图异步上传;失败则退化为纯色 unlit(stats 记录) */
export async function buildSky(world: World, renderer: {
  store: {
    uploadTexture?: (h: unknown, pod: unknown, dec: unknown) => Promise<{ ok: boolean }>;
  };
}, stats: SceneStats): Promise<void> {
  const dome = domeMesh(1050);
  const tex = skyTexture();
  let matAsset: MaterialAsset;
  const texH = world.allocSharedRef('TextureAsset', tex);
  let ok = false;
  try {
    const texPod = tex as unknown as { data: Uint8Array; width: number; height: number };
    const up = await renderer.store.uploadTexture?.(texH, tex, {
      bytes: texPod.data, width: texPod.width, height: texPod.height,
      mime: 'image/png', colorSpace: 'srgb', mipmap: false,
    });
    ok = up?.ok === true;
  } catch { ok = false; }
  stats.skyTex = ok ? 'ok' : 'fallback';
  const { unwrapHandle } = await import('@forgeax/engine-types');
  matAsset = ok
    ? Materials.unlit([1, 1, 1, 1], {
      baseColorTexture: unwrapHandle(texH as never),
      castShadow: false,
      renderState: { cullMode: 'none', depthWriteEnabled: false },
    })
    : Materials.unlit([0.48, 0.76, 0.98, 1], { castShadow: false, renderState: { cullMode: 'none', depthWriteEnabled: false } });
  const matH = world.allocSharedRef('MaterialAsset', matAsset);
  const meshH = world.allocSharedRef('MeshAsset', dome);
  world.spawn(
    { component: Transform, data: { pos: [0, 0, 0] } },
    { component: MeshFilter, data: { assetHandle: meshH } },
    { component: MeshRenderer, data: { materials: [matH] } },
  ).unwrap();
  stats.entities++;
}

export { clampToBounds, groundHeight, Camera };
