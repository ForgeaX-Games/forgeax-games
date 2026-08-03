/**
 * Dense fill layers distilled from MainScene: SkylineBand, roadside hedges/fences,
 * China walls, mall floor/shops, picket fences, planter trees along empty t-ranges.
 * Pure geometry / solid colors (no canvas emissive) for ForgeaX bake.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const std = (color, roughness = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

const rnd = (i, salt = 0) => {
  const x = Math.sin(i * 7.13 + salt * 3.71 + 1.7) * 43758.5453;
  return x - Math.floor(x);
};

function themeAt(t) {
  if (t < 0.1) return 'park';
  if (t < 0.27) return 'euro';
  if (t < 0.49) return 'city';
  if (t < 0.66) return 'china';
  if (t < 0.755) return 'mall';
  if (t < 0.905) return 'harbor';
  return 'park';
}

function box(w, h, d, mat, y = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  return m;
}

/** Compact hip roof — eaves must stay ≤ wall footprint or they read as sky plates. */
function hipRoof(w, h, d, mat, yBase) {
  const g = new THREE.Group();
  const eaves = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, Math.max(0.55, h * 0.4), d * 0.92), mat);
  eaves.position.y = yBase + Math.max(0.28, h * 0.2);
  g.add(eaves);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, Math.max(0.8, h * 0.7), d * 0.36), mat);
  ridge.position.y = yBase + Math.max(0.7, h * 0.55);
  g.add(ridge);
  return g;
}

/** Far-ring skyline (~50–60 low-poly theme buildings). Needs track.mapPoints + nearestInfo. */
export function buildSkylineBand(track, parent) {
  const group = new THREE.Group();
  group.name = 'SkylineBand';

  const beige = [std(0xf6e7c8), std(0xf2cabf), std(0xe9d9b8), std(0xf0dcc4)];
  const terra = [std(0xcf7250), std(0xc2685a)];
  const pale = [std(0xdfe7ee), std(0xd3dde8), std(0xe8eef4)];
  const paleAccent = std(0xbcc9d6);
  const chinaRed = [std(0xc94b4c), std(0xb43e3f)];
  const gold = std(0xe8b04b);
  const cream = std(0xf3e3d3);
  const awningA = std(0xff9e7d);
  const awningB = std(0x7dd4ff);
  const harborWall = [std(0xaebfd0), std(0x9fb2c4)];
  const harborRed = std(0xd0495a);
  const treeGreen = std(0x5da868);
  const trunkBrown = std(0x8a6243);
  const win = std(0x5a6a7a, 0.5);
  const D = 6;

  const euro = (i, w) => {
    const g = new THREE.Group();
    const h = 10 + rnd(i, 1) * 5;
    g.add(box(w, h, D, beige[i % 4]));
    g.add(hipRoof(w + 0.8, 2.6 + rnd(i, 2) * 1.6, D + 0.8, terra[i % 2], h));
    g.add(box(w * 0.62, 0.55, 0.12, win, h * 0.44));
    g.children[g.children.length - 1].position.z = D / 2 + 0.04;
    g.add(box(w * 0.62, 0.55, 0.12, win, h * 0.7));
    g.children[g.children.length - 1].position.z = D / 2 + 0.04;
    return g;
  };
  const city = (i, w) => {
    const g = new THREE.Group();
    const h = 15 + rnd(i, 1) * 9;
    g.add(box(w * 0.92, h, D, pale[i % 3]));
    g.add(box(w * 0.52, 2.2, D * 0.7, paleAccent, h + 1.1));
    for (const s of [-1, 1]) {
      const strip = box(0.85, h * 0.62, 0.1, win, h * 0.46);
      strip.position.set(s * w * 0.2, h * 0.46, D / 2 + 0.04);
      g.add(strip);
    }
    return g;
  };
  const china = (i, w) => {
    const g = new THREE.Group();
    const h = 9 + rnd(i, 1) * 4;
    g.add(box(w, h, D, chinaRed[i % 2]));
    // Small ridge only — large gold slabs (w+2.4) read as floating brown plates in sky.
    g.add(box(w * 0.7, 0.7, D * 0.55, gold, h + 0.35));
    g.add(box(w * 0.35, 0.4, D * 0.4, gold, h * 0.55));
    return g;
  };
  const mall = (i, w) => {
    const g = new THREE.Group();
    const h = 8 + rnd(i, 1) * 4;
    g.add(box(w, h, D, cream));
    const awning = box(w * 0.9, 0.4, 1.7, i % 2 === 0 ? awningA : awningB, 4);
    awning.position.z = D / 2 + 0.75;
    g.add(awning);
    return g;
  };
  const harbor = (i, w) => {
    const g = new THREE.Group();
    const h = 6 + rnd(i, 1) * 4;
    g.add(box(w, h, D, harborWall[i % 2]));
    g.add(box(w, 0.7, D + 0.1, harborRed, h - 1));
    return g;
  };
  const park = (i, w) => {
    const g = new THREE.Group();
    const h = 7 + rnd(i, 1) * 3;
    g.add(box(w * 0.72, h, D, beige[(i + 2) % 4]));
    g.add(hipRoof(w * 0.72 + 0.8, 2.4, D + 0.8, terra[i % 2], h));
    const tx = (rnd(i, 6) > 0.5 ? 1 : -1) * w * 0.62;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 4.4, 7), trunkBrown);
    trunk.position.set(tx, 2.2, 0);
    g.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(3.1, 10, 9), treeGreen);
    crown.position.set(tx, 6.4, 0);
    g.add(crown);
    return g;
  };
  const builders = { park, euro, city, china, mall, harbor };

  const centroid = new THREE.Vector3();
  for (const mp of track.mapPoints) centroid.add(new THREE.Vector3(mp.x, 0, mp.z));
  centroid.divideScalar(track.mapPoints.length);
  // Push skyline far; desaturate so midground EuroHouse owns the near street.
  const OFFSET = 55;
  const atmos = (mats) => {
    for (const m of mats) {
      if (!m?.color) continue;
      m.color.offsetHSL(0.02, -0.18, -0.08);
    }
  };
  atmos([...beige, ...terra, ...pale, paleAccent, ...chinaRed, gold, cream, awningA, awningB, ...harborWall, harborRed]);
  const radial = (ang) => {
    const dx = Math.cos(ang),
      dz = Math.sin(ang);
    let m = 0;
    for (const mp of track.mapPoints) {
      m = Math.max(m, (mp.x - centroid.x) * dx + (mp.z - centroid.z) * dz);
    }
    return m + OFFSET;
  };
  const M = 160;
  const ring = [];
  for (let i = 0; i < M; i++) {
    const a = (i / M) * Math.PI * 2;
    const r = radial(a);
    ring.push(new THREE.Vector3(centroid.x + Math.cos(a) * r, 0, centroid.z + Math.sin(a) * r));
  }

  const exclude = [{ x: -5, z: 167, r: 28 }];
  let acc = 0;
  let slot = 0;
  let need = 6.5;
  for (let i = 0; i < M; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % M];
    acc += p0.distanceTo(p1);
    if (acc < need) continue;
    acc = 0;
    need = 7.0 + rnd(slot, 9) * 2.8;
    slot += 1;
    const P = p1;
    if (exclude.some((e) => Math.hypot(P.x - e.x, P.z - e.z) < e.r)) continue;
    const near = track.nearestInfo(P);
    const tt = (((near.t + (rnd(slot, 4) - 0.5) * 0.045) % 1) + 1) % 1;
    const theme = themeAt(tt);
    const wSlot = need + 2.5;
    const b = builders[theme](slot, wSlot);
    const tp = track.pointAt(near.t);
    b.position.copy(P);
    b.rotation.y = Math.atan2(tp.x - P.x, tp.z - P.z);
    group.add(b);
  }
  parent.add(group);
  return group.children.length;
}

/** White picket fence segments along park start/end. */
export function buildPicketFences(track, parent) {
  const white = std(0xfdfaf0, 0.7);
  let n = 0;
  for (const [t0, t1, lat] of [
    [0.028, 0.108, 8.2],
    [0.028, 0.108, -8.2],
    [0.918, 0.99, 8.2],
  ]) {
    const steps = 11;
    for (let i = 0; i < steps; i++) {
      const t = t0 + ((t1 - t0) * i) / (steps - 1);
      const p = track.pointAt(t);
      const side = track.sideAt(t);
      const tan = track.tangentAt(t);
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), white);
        post.position.set(-0.45 + k * 0.3, 0.48, 0);
        g.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.08), white);
      rail.position.y = 0.72;
      g.add(rail);
      g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
      g.rotation.y = Math.atan2(-tan.z, tan.x);
      parent.add(g);
      n++;
    }
  }
  return n;
}

/** Dense hedges + trees + flower beds filling near-track midground (both sides). */
export function buildRoadsideFill(track, parent) {
  const hedgeMat = std(0x67b957, 0.92);
  const flowerCols = [0xff6f91, 0xffd23e, 0xff8a3d, 0xf25fd0, 0xff5a6e, 0xffe27a];
  let n = 0;
  const hedgeAt = (t, lat) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2.2, 4, 8), hedgeMat);
    h.rotation.z = Math.PI / 2;
    h.position.set(p.x + side.x * lat, p.y + 0.42, p.z + side.z * lat);
    h.rotation.y = Math.atan2(-tan.z, tan.x);
    parent.add(h);
    n++;
  };
  const treeAt = (t, lat, scale = 1) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.4, 8), std(0x9c6b43, 0.9)));
    g.children[0].position.y = 0.7;
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(1.35, 10, 8), std(0x4f9e3a, 0.95));
    s1.position.y = 2.2;
    g.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), std(0x5faf4a, 0.95));
    s2.position.set(0.35, 2.55, 0.1);
    g.add(s2);
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    g.scale.setScalar(scale);
    parent.add(g);
    n++;
  };
  const flowerAt = (t, lat) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const x = p.x + side.x * lat;
    const z = p.z + side.z * lat;
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.18, 0.34, 14), std(0xd8cba8, 0.9));
    rim.position.y = 0.17;
    g.add(rim);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), std(0x7ecb5f, 0.9));
    bush.position.y = 0.42;
    bush.scale.y = 0.55;
    g.add(bush);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const f = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 7, 6),
        std(flowerCols[i % flowerCols.length], 0.55),
      );
      f.position.set(Math.cos(a) * 0.58, 0.72, Math.sin(a) * 0.58);
      g.add(f);
    }
    g.position.set(x, p.y, z);
    parent.add(g);
    n++;
  };

  // Park start — both sides dense (fills the empty lawn in screenshots)
  for (let t = 0.02; t < 0.115; t += 0.008) {
    hedgeAt(t, 9.35);
    hedgeAt(t, -9.35);
  }
  for (let t = 0.028; t < 0.11; t += 0.016) {
    treeAt(t, 11.2, 0.95 + rnd(Math.floor(t * 200), 1) * 0.2);
    treeAt(t, -11.2, 0.9 + rnd(Math.floor(t * 200), 2) * 0.25);
  }
  for (const t of [0.032, 0.042, 0.052, 0.062, 0.072, 0.082, 0.092, 0.102, 0.112]) {
    flowerAt(t, 10.3);
    flowerAt(t, -10.3);
  }
  for (const t of [0.04, 0.06, 0.08, 0.1]) {
    flowerAt(t, 12.4);
    flowerAt(t, -12.4);
  }

  // Approach / midground A
  for (let t = 0.115; t < 0.178; t += 0.006) hedgeAt(t, 9.55);
  for (let t = 0.118; t < 0.178; t += 0.007) hedgeAt(t, -9.55);
  for (let t = 0.12; t < 0.175; t += 0.014) {
    treeAt(t, 11.4, 0.95);
    treeAt(t, -11.4, 1.0);
  }
  for (const t of [0.122, 0.132, 0.142, 0.152, 0.162, 0.172]) {
    flowerAt(t, 10.3);
    flowerAt(t, -10.4);
  }

  // Euro bend inner/outer fill (between curb and houses)
  for (const t of [0.188, 0.2, 0.207, 0.22, 0.24, 0.256, 0.272]) hedgeAt(t, 9.6);
  for (const t of [0.19, 0.21, 0.23, 0.25, 0.265]) hedgeAt(t, -9.7);
  for (const t of [0.209, 0.228, 0.247, 0.266]) treeAt(t, -10.0, 1.0);
  for (const t of [0.196, 0.215, 0.245, 0.262]) flowerAt(t, 11.2);
  for (const t of [0.2, 0.235, 0.26]) flowerAt(t, -11.0);
  for (const t of [0.205, 0.24, 0.27]) treeAt(t, 12.8, 1.15);

  // City — denser roadside color pops (recording lawns looked empty).
  for (let t = 0.29; t < 0.47; t += 0.018) {
    flowerAt(t, 10.0);
    flowerAt(t, -10.2);
  }

  // S-curve / midground B
  for (let t = 0.483; t < 0.545; t += 0.008) {
    hedgeAt(t, 9.2);
    hedgeAt(t, -9.2);
  }
  for (let t = 0.49; t < 0.54; t += 0.015) {
    treeAt(t, 10.5, 1.05);
    treeAt(t, -10.5, 1.0);
  }

  // Chinatown + mall apron — hedges ONLY at road edge, not on stone apron
  for (let t = 0.54; t < 0.66; t += 0.018) {
    hedgeAt(t, 9.15);
    hedgeAt(t, -9.15);
  }
  for (let t = 0.55; t < 0.64; t += 0.025) {
    treeAt(t, 12.2, 1.0);
    treeAt(t, -12.2, 1.0);
    flowerAt(t, 11.0);
    flowerAt(t, -11.0);
  }

  // Mall corridor exterior — plant OUTSIDE tunnel walls (|lat|≥12), fill the empty lawn
  for (let t = 0.66; t < 0.755; t += 0.012) {
    hedgeAt(t, 12.4);
    hedgeAt(t, -12.4);
  }
  for (let t = 0.665; t < 0.75; t += 0.02) {
    treeAt(t, 14.2, 1.05);
    treeAt(t, -14.2, 1.0);
  }
  for (const t of [0.675, 0.7, 0.725, 0.745]) {
    flowerAt(t, 13.2);
    flowerAt(t, -13.2);
  }

  // Harbor / blue-bridge flanks — never plant on deck (|lat|<11); fill both shores
  for (let t = 0.76; t < 0.905; t += 0.014) {
    hedgeAt(t, 12.6);
    hedgeAt(t, -12.6);
  }
  for (let t = 0.765; t < 0.9; t += 0.022) {
    treeAt(t, 14.8, 1.1);
    treeAt(t, -14.8, 1.05);
  }
  for (const t of [0.78, 0.81, 0.84, 0.87, 0.9]) {
    flowerAt(t, 13.5);
    flowerAt(t, -13.5);
  }

  // After mall — only beyond bridge, not on bridge deck
  for (let t = 0.91; t < 0.998; t += 0.014) {
    treeAt(t, 10.2, 1.05);
    treeAt(t, -10.2, 1.05);
    hedgeAt(t, 9.1);
    hedgeAt(t, -9.1);
  }

  // End park
  for (let t = 0.918; t < 0.998; t += 0.01) {
    hedgeAt(t, 9.4);
    hedgeAt(t, -9.4);
  }
  for (const t of [0.93, 0.95, 0.97, 0.99]) {
    treeAt(t, 11.0, 1.0);
    treeAt(t, -11.0, 0.95);
  }
  for (const t of [0.94, 0.98]) {
    flowerAt(t, 10.5);
    flowerAt(t, -10.5);
  }

  return n;
}

/** Yellow rounded curb — denser FULL-LOOP bite belt (both sides). */
export function buildYellowCurbs(track, parent) {
  const ybMat = std(0xffc93e, 0.62);
  const whiteMat = std(0xf5f0e6, 0.7);
  let n = 0;
  const place = (t, lat, mat = ybMat) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    const b = new THREE.Mesh(new RoundedBoxGeometry(2.15, 0.46, 0.34, 2, 0.12), mat);
    b.position.set(p.x + side.x * lat, p.y + 0.23, p.z + side.z * lat);
    b.rotation.y = Math.atan2(-tan.z, tan.x);
    parent.add(b);
    n++;
  };
  // Continuous both sides around the loop — skip mall corridor (original hides curbs there)
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    if (t >= 0.66 && t <= 0.755) continue; // indoor corridor
    if (t > 0.76 && t < 0.9) {
      // bridge: keep outer only
      place(t, -7.55, whiteMat);
      place(t, 7.55, whiteMat);
      continue;
    }
    const mat = t > 0.28 && t < 0.48 ? whiteMat : ybMat;
    place(t, -7.5, mat);
    place(t, 7.5, mat);
  }
  return n;
}

/** Start gate + city paw banner (BoxGeometry — PlaneGeometry vanishes after bake). */
export function buildBanners(track, parent) {
  const cream = std(0xfff6ea, 0.7);
  const poleRed = std(0xff5a6e, 0.6);
  let n = 0;

  // Start banner gate at t≈0 — cloth gets race_banner.png via mid_banner_start
  {
    const p = track.pointAt(0);
    const tan = track.tangentAt(0);
    const hw = track.roadWidth / 2;
    const g = new THREE.Group();
    for (const s of [1, -1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 8.6, 10), poleRed);
      pole.position.set(s * (hw + 2.9), 4.3, 0);
      g.add(pole);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), cream);
      cap.position.set(s * (hw + 2.9), 8.7, 0);
      g.add(cap);
    }
    const startCloth = std(0xe04848, 0.8);
    startCloth.name = 'mid_banner_start';
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 7.2, 3.0, 0.22), startCloth);
    cloth.position.y = 6.9;
    g.add(cloth);
    g.position.set(p.x, p.y, p.z);
    // +X across road, +Z along tangent — same as original buildBannerGate
    g.rotation.y = Math.atan2(tan.x, tan.z);
    parent.add(g);
    n++;
  }

  // City paw banner — WHITE poles + gold finials (createPawBanner)
  // MUST use atan2(tan.x, tan.z) like original; atan2(-tz, tx) puts poles on the asphalt.
  {
    const t = 0.336;
    const p = track.pointAt(t);
    const tan = track.tangentAt(t);
    const hw = track.roadWidth / 2;
    // Span clear of asphalt (hw=7 → poles at ±9.2)
    const width = hw * 2 + 4.4;
    const g = new THREE.Group();
    const white = std(0xfdfaf2, 0.5);
    const gold = std(0xe8b23a, 0.45);
    gold.metalness = 0.2;
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 5.6, 10), white);
      pole.position.set((s * width) / 2, 2.8, 0);
      g.add(pole);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), gold);
      fin.position.set((s * width) / 2, 5.75, 0);
      g.add(fin);
    }
    const pawCloth = std(0xe04848, 0.8);
    pawCloth.name = 'mid_banner_paw';
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(width - 0.5, 1.35, 0.18), pawCloth);
    cloth.position.y = 4.75;
    g.add(cloth);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(tan.x, tan.z);
    parent.add(g);
    n++;
  }
  return n;
}

/** China red wall fillers between shops — low apron walls like original (h≈1.5). */
export function buildChinaWalls(track, parent) {
  const red = std(0xb03a30, 0.65);
  const dark = std(0x3c4250, 0.7);
  const white = std(0xf5f0ea, 0.75);
  let n = 0;
  for (const [t, lat, len] of [
    [0.555, -11.4, 4.5],
    [0.568, -11.4, 4.2],
    [0.58, -11.4, 4.0],
    [0.595, -11.4, 4.2],
    [0.608, -11.4, 4.0],
    [0.62, -11.4, 4.5],
    [0.5545, 11.2, 3.8],
    [0.5655, 11.2, 3.8],
  ]) {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new RoundedBoxGeometry(len, 1.45, 0.55, 2, 0.08), red);
    wall.position.y = 0.72;
    g.add(wall);
    const line = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, 0.08, 0.12), white);
    line.position.set(0, 1.05, 0.28);
    g.add(line);
    const cap = new THREE.Mesh(new RoundedBoxGeometry(len + 0.35, 0.22, 0.75, 2, 0.05), dark);
    cap.position.y = 1.55;
    g.add(cap);
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    g.rotation.y = Math.atan2(-tan.z, tan.x);
    parent.add(g);
    n++;
  }
  return n;
}

/**
 * Continuous thick wall following track curve — ONE mesh (no box-segment gaps).
 */
function addThickWallRibbon(track, parent, t0, t1, lat, y0, y1, thickness, mat, N = 40) {
  const pos = [];
  const idx = [];
  const half = thickness / 2;
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const p = track.pointAt(t);
    const s = track.sideAt(t);
    const xi = p.x + s.x * (lat - half);
    const zi = p.z + s.z * (lat - half);
    const xo = p.x + s.x * (lat + half);
    const zo = p.z + s.z * (lat + half);
    const yb = p.y + y0;
    const yt = p.y + y1;
    pos.push(xi, yb, zi, xo, yb, zo, xo, yt, zo, xi, yt, zi);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
    idx.push(a + 3, a + 2, b + 2, a + 3, b + 2, b + 3);
    idx.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
    idx.push(a, a + 3, b + 3, a, b + 3, b);
  }
  const L = N * 4;
  idx.push(0, 1, 2, 0, 2, 3);
  idx.push(L, L + 3, L + 2, L, L + 2, L + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  parent.add(new THREE.Mesh(geo, mat));
}

function addThickFloorRibbon(track, parent, t0, t1, halfW, y, thick, mat, N = 40) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const p = track.pointAt(t);
    const s = track.sideAt(t);
    const y0 = p.y + y;
    const y1 = p.y + y + thick;
    pos.push(
      p.x + s.x * -halfW, y0, p.z + s.z * -halfW,
      p.x + s.x * halfW, y0, p.z + s.z * halfW,
      p.x + s.x * halfW, y1, p.z + s.z * halfW,
      p.x + s.x * -halfW, y1, p.z + s.z * -halfW,
    );
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
    idx.push(a + 3, b + 3, b + 2, a + 3, b + 2, a + 2);
    idx.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
    idx.push(a, b, b + 3, a, b + 3, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  parent.add(new THREE.Mesh(geo, mat));
}

/**
 * Mall corridor — continuous thick ribbons (not fragmented box segments).
 */
export function buildMallInterior(track, parent, t0, t1) {
  const CEIL_Y = 5.7;
  const WALL_LAT = 9.6;
  const N = 40;
  const wood = std(0xd9b98c, 0.62); wood.name = 'mid_mall_wood';
  const conc = std(0xd6d7db, 0.88); conc.name = 'mid_mall_concrete';
  const skirt = std(0x5b544e, 0.8); skirt.name = 'mid_mall_skirt';
  const ceil = std(0xf2ead9, 0.9); ceil.name = 'mid_mall_ceil';
  const beamMat = std(0xb98a5a, 0.6); beamMat.name = 'mid_mall_beam';
  const stripMat = std(0xfff0d2, 0.5); stripMat.name = 'mid_mall_strip';
  const portalMat = std(0xc98f5e, 0.55); portalMat.name = 'mid_mall_portal';
  const floorMat = std(0xcfc8c0, 0.55); floorMat.name = 'mid_mall_floor';
  const viewMat = std(0xffffff, 0.95); viewMat.name = 'mid_mall_view';
  const shopWood = std(0xa9744a, 0.7); shopWood.name = 'mid_mall_shopwood';
  const shopWin = std(0xfff3d8, 0.4); shopWin.name = 'mid_mall_shopwin';

  const centroid = new THREE.Vector3();
  for (const mp of track.mapPoints) centroid.add(new THREE.Vector3(mp.x, 0, mp.z));
  centroid.divideScalar(track.mapPoints.length);
  const tm = (t0 + t1) / 2;
  const pm = track.pointAt(tm);
  const sm = track.sideAt(tm);
  const out = sm.dot(pm.clone().sub(centroid).setY(0).normalize()) > 0 ? 1 : -1;

  addThickFloorRibbon(track, parent, t0, t1, WALL_LAT - 0.15, 0.02, 0.16, floorMat, N);
  addThickFloorRibbon(track, parent, t0, t1, WALL_LAT + 0.35, CEIL_Y - 0.05, 0.35, ceil, N);

  const oi = out * WALL_LAT;
  addThickWallRibbon(track, parent, t0, t1, oi, 0, 1.0, 0.5, wood, N);
  addThickWallRibbon(track, parent, t0, t1, oi, 4.5, CEIL_Y, 0.5, wood, N);
  addThickWallRibbon(track, parent, t0, t1, out * (WALL_LAT - 0.05), 2.55, 2.85, 0.28, wood, N);
  for (let i = 0; i <= 6; i++) {
    const t = t0 + ((t1 - t0) * i) / 6;
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.5, 0.2), wood);
    mull.position.set(p.x + side.x * oi, p.y + 2.75, p.z + side.z * oi);
    parent.add(mull);
  }
  addThickWallRibbon(track, parent, t0, t1, out * (WALL_LAT + 2.5), 0.1, 6.8, 0.35, viewMat, N);

  const ii = -out * WALL_LAT;
  addThickWallRibbon(track, parent, t0, t1, ii, 0, CEIL_Y, 0.5, conc, N);
  addThickWallRibbon(track, parent, t0, t1, -out * (WALL_LAT - 0.08), 0, 0.28, 0.32, skirt, N);

  for (const [frac, awnCol, signName] of [[0.22, 0xff7d5c, 'mid_sign_toys'], [0.5, 0x64b96a, 'mid_sign_cafe'], [0.78, 0x5c9dff, 'mid_sign_gifts']]) {
    const t = t0 + (t1 - t0) * frac;
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const lat = -out * (WALL_LAT - 0.28);
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.2, 0.5), shopWood);
    frame.position.y = 1.6;
    g.add(frame);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.14), shopWin);
    win.position.set(0, 1.65, 0.28);
    g.add(win);
    const awnA = std(0xffffff, 0.65);
    const awnB = std(awnCol, 0.65);
    for (let k = 0; k < 5; k++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.9), k % 2 ? awnA : awnB);
      stripe.position.set(-1.4 + k * 0.7, 2.7, 0.55);
      stripe.rotation.x = 0.4;
      g.add(stripe);
    }
    const signMat = std(0xffffff, 0.5);
    signMat.name = signName;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 0.14), signMat);
    sign.position.set(0, 3.6, 0.2);
    g.add(sign);
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    const toC = new THREE.Vector3(-side.x * Math.sign(lat || 1), 0, -side.z * Math.sign(lat || 1));
    g.rotation.y = Math.atan2(toC.x, toC.z);
    parent.add(g);
  }

  for (let i = 0; i <= 5; i++) {
    const t = t0 + ((t1 - t0) * i) / 5;
    const p = track.pointAt(t);
    const tan = track.tangentAt(t);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(WALL_LAT * 2 + 0.5, 0.32, 0.48), beamMat);
    beam.position.set(p.x, p.y + CEIL_Y - 0.22, p.z);
    beam.rotation.y = Math.atan2(-tan.x, -tan.z);
    parent.add(beam);
  }
  for (const lat of [-3.5, 3.5]) {
    addThickWallRibbon(track, parent, t0 + 0.005, t1 - 0.005, lat, CEIL_Y - 0.18, CEIL_Y - 0.04, 0.28, stripMat, 28);
  }

  for (const [t, signName] of [[t0, 'mid_sign_petmall'], [t1, 'mid_sign_seeyou']]) {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    const rotY = Math.atan2(-tan.x, -tan.z);
    for (const sg of [1, -1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, CEIL_Y + 0.4, 10), portalMat);
      col.position.set(p.x + side.x * sg * (WALL_LAT + 0.25), p.y + (CEIL_Y + 0.4) / 2, p.z + side.z * sg * (WALL_LAT + 0.25));
      parent.add(col);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(WALL_LAT * 2 + 1.2, 1.0, 0.65), portalMat);
    top.position.set(p.x, p.y + CEIL_Y + 0.5, p.z);
    top.rotation.y = rotY;
    parent.add(top);
    const sMat = std(0xffffff, 0.5);
    sMat.name = signName;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.3, 0.2), sMat);
    sign.position.set(p.x, p.y + CEIL_Y + 0.55, p.z);
    sign.rotation.y = rotY;
    sign.translateZ(0.4);
    parent.add(sign);
  }
  return { out, t0, t1 };
}

/** Blue entry beam just before the steel bridge (MainScene seam C). */
export function buildBlueApproach(track, parent) {
  const blue = std(0x3f7fd9, 0.42);
  blue.metalness = 0.18;
  const blueDark = std(0x3068b8, 0.46);
  blueDark.metalness = 0.18;
  const yellow = std(0xffc93e, 0.55);
  const pier = std(0xcfcabd, 0.85);

  // Concrete piers at corridor exit
  for (const lat of [-10.25, 10.25]) {
    const t = 0.7505;
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    g.add(box(1.15, 3.4, 1.15, pier));
    const cap = box(1.4, 0.25, 1.4, pier, 3.5);
    g.add(cap);
    const base = box(1.5, 0.2, 1.5, pier, 0.1);
    g.add(base);
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    parent.add(g);
  }

  // Blue entry beam across road @ t≈0.758
  {
    const t = 0.758;
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    const g = new THREE.Group();
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.5, 5.6, 0.5, 2, 0.1), blueDark);
      post.position.set(s * 10.2, 2.8, 0);
      g.add(post);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), yellow);
      fin.position.set(s * 10.2, 5.75, 0);
      g.add(fin);
    }
    const beam = new THREE.Mesh(new RoundedBoxGeometry(20.8, 0.55, 0.55, 2, 0.12), blue);
    beam.position.y = 5.35;
    g.add(beam);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(tan.x, tan.z);
    parent.add(g);
  }
}

/**
 * Full blue iron truss bridge — matches createBlueBridge(span, 9.9).
 * Uses module index 10 ±1.8m for t-range (same as MainScene.buildBlueBridge).
 */
export function buildBlueBridgeDense(track, parent, moduleLensFn) {
  let tA = 0.757;
  let tB = 0.905;
  if (typeof moduleLensFn === 'function') {
    const { lens, total } = moduleLensFn();
    const before = lens.slice(0, 10).reduce((a, b) => a + b, 0);
    tA = (before + 1.8) / total;
    tB = (before + lens[10] - 1.8) / total;
  }
  const A = track.pointAt(tA);
  const B = track.pointAt(tB);
  const span = Math.hypot(B.x - A.x, B.z - A.z);
  const mid = new THREE.Vector3((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  const yaw = Math.atan2(B.x - A.x, B.z - A.z);

  const blue = std(0x3f7fd9, 0.42);
  blue.metalness = 0.18;
  blue.name = 'mid_bridge_blue';
  const blueDark = std(0x3068b8, 0.46);
  blueDark.metalness = 0.18;
  blueDark.name = 'mid_bridge_dark';
  const yellow = std(0xffce3a, 0.55);
  yellow.name = 'mid_bridge_yellow';
  const hazY = std(0xffd23e, 0.55);
  const hazB = std(0x23252e, 0.6);

  const halfW = 9.9; // original createBlueBridge half-width
  const g = new THREE.Group();
  const yBot = 0.75;
  const yTop = 5.4;
  const panels = Math.max(3, Math.round(span / 5.8));
  const panelLen = span / panels;
  const gussetGeo = new THREE.SphereGeometry(0.28, 10, 8);

  for (const sx of [1, -1]) {
    const x = sx * halfW;
    for (const y of [yBot, yTop]) {
      const chord = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.55, span + 0.6, 3, 0.15), blue);
      chord.position.set(x, y, 0);
      g.add(chord);
    }
    for (let i = 0; i <= panels; i++) {
      const z = -span / 2 + i * panelLen;
      const v = new THREE.Mesh(new RoundedBoxGeometry(0.45, yTop - yBot, 0.45, 3, 0.12), blue);
      v.position.set(x, (yBot + yTop) / 2, z);
      g.add(v);
      for (const y of [yBot, yTop]) {
        const s = new THREE.Mesh(gussetGeo, blueDark);
        s.position.set(x, y, z);
        g.add(s);
      }
      if (i < panels) {
        const diagLen = Math.hypot(yTop - yBot, panelLen);
        const d = new THREE.Mesh(new RoundedBoxGeometry(0.4, diagLen, 0.4, 3, 0.11), blueDark);
        d.position.set(x, (yBot + yTop) / 2, z + panelLen / 2);
        d.rotation.x = (i % 2 === 0 ? 1 : -1) * Math.atan2(panelLen, yTop - yBot);
        g.add(d);
      }
      if (sx === 1 && i % 2 === 0) {
        const c = new THREE.Mesh(new RoundedBoxGeometry(halfW * 2, 0.5, 0.5, 3, 0.13), blue);
        c.position.set(0, yTop, z);
        g.add(c);
      }
    }
    // Hazard blocks along lower chord (Box stand-in for Plane strip)
    const nHaz = Math.max(8, Math.round(span / 2.2));
    for (let i = 0; i < nHaz; i++) {
      const z = -span / 2 + ((i + 0.5) / nHaz) * span;
      const hz = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, span / nHaz - 0.08), i % 2 ? hazY : hazB);
      hz.position.set(sx * (halfW + 0.35), yBot, z);
      g.add(hz);
    }
  }

  // End portal towers
  for (const sz of [1, -1]) {
    const z = sz * (span / 2 + 0.9);
    for (const sx of [1, -1]) {
      const col = new THREE.Mesh(new RoundedBoxGeometry(1.35, 7.8, 1.35, 3, 0.3), blue);
      col.position.set(sx * halfW, 3.9, z);
      g.add(col);
      // yellow/black tower base bands
      for (let k = 0; k < 4; k++) {
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(0.38, 0.9, 1.52),
          k % 2 ? hazY : hazB,
        );
        band.position.set(sx * halfW - 0.57 + k * 0.38, 1.1, z);
        g.add(band);
      }
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), yellow);
      fin.position.set(sx * halfW, 7.95, z);
      g.add(fin);
    }
    const beam = new THREE.Mesh(new RoundedBoxGeometry(halfW * 2 + 1.8, 1.5, 1.5, 3, 0.32), blue);
    beam.position.set(0, 7.4, z);
    g.add(beam);
  }

  // Green chevron boards as solid boxes (no Plane / emissive)
  const chev = std(0x1a3a2a, 0.55);
  const chevArrow = std(0x4ef58c, 0.45);
  for (let i = 2; i < panels; i += 4) {
    const z = -span / 2 + i * panelLen;
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.18), chev);
    board.position.set(0, yTop + 0.2, z - 0.35);
    g.add(board);
    for (let k = 0; k < 3; k++) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.12), chevArrow);
      a.position.set(-0.7 + k * 0.7, yTop + 0.2, z - 0.22);
      a.rotation.z = 0.55;
      g.add(a);
    }
  }
  {
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.4, 0.2), chev);
    board.position.set(0, 6.55, -span / 2 - 1.35);
    g.add(board);
    for (let k = 0; k < 5; k++) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.12), chevArrow);
      a.position.set(-2.0 + k * 1.0, 6.55, -span / 2 - 1.22);
      a.rotation.z = 0.55;
      g.add(a);
    }
  }

  g.position.copy(mid);
  g.rotation.y = yaw;
  parent.add(g);
  return { tA, tB, span, halfW, panels };
}

/** Pearl tower landmark near city bend. */
export function buildPearlTower(track, parent) {
  const t = 0.4;
  const p = track.pointAt(t);
  const side = track.sideAt(t);
  const g = new THREE.Group();
  const pink = std(0xff9eb8, 0.55);
  const white = std(0xf5f0ea, 0.7);
  for (const ang of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 18, 8), white);
    leg.position.set(Math.cos(ang) * 3.2, 9, Math.sin(ang) * 3.2);
    leg.rotation.z = Math.cos(ang) * 0.25;
    leg.rotation.x = Math.sin(ang) * 0.25;
    g.add(leg);
  }
  const ball1 = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), pink);
  ball1.position.y = 14;
  g.add(ball1);
  const ball2 = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 10), pink);
  ball2.position.y = 22;
  g.add(ball2);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 8, 8), white);
  tip.position.y = 28;
  g.add(tip);
  g.position.set(p.x + side.x * -44, 0, p.z + side.z * -44);
  parent.add(g);
}

/**
 * Track-center visual props: yellow boost pads.
 * Coins and item boxes are NOT baked — positions go to landmarks so runtime
 * collectibles can hide and respawn independently.
 * No cyan emissive (ForgeaX shows those as cyan slabs). Pads use thick boxes, not planes.
 */
export function buildTrackCenterProps(track, parent) {
  const padMat = std(0xffd23e, 0.55);
  padMat.name = 'mid_boost_pad';
  const arrowMat = std(0xff8a3d, 0.5);
  arrowMat.name = 'mid_boost_arrow';

  const coinPositions = [];
  const itemBoxPositions = [];
  let boxes = 0,
    pads = 0;

  // Coin spawn points — 14 stations × 3 lanes (entities built in scene.pack)
  for (const t of [0.05, 0.11, 0.2, 0.27, 0.32, 0.38, 0.45, 0.52, 0.58, 0.66, 0.72, 0.79, 0.86, 0.93]) {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    for (const off of [-3.4, 0, 3.4]) {
      coinPositions.push({
        x: p.x + side.x * off,
        y: p.y + 0.9,
        z: p.z + side.z * off,
        yaw: Math.atan2(tan.x, tan.z),
      });
    }
  }

  // Item boxes — emitted as independent scene entities by build-scene.
  for (const t of [0.04, 0.12, 0.22, 0.25, 0.36, 0.45, 0.55, 0.62, 0.76, 0.85, 0.95]) {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    for (const off of [-2.8, 2.8]) {
      itemBoxPositions.push({
        x: p.x + side.x * off,
        y: p.y + 1.0,
        z: p.z + side.z * off,
        yaw: Math.atan2(tan.x, tan.z),
      });
      boxes++;
    }
  }

  // Boost pads — thick yellow box + chevron arrows (BoxGeometry only)
  for (const t of [0.07, 0.15, 0.24, 0.4, 0.5, 0.65, 0.8, 0.9]) {
    const p = track.pointAt(t);
    const tan = track.tangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 4.4), padMat);
    pad.position.y = 0.08;
    g.add(pad);
    // Chevron points along local +Z, which is the track tangent after yaw.
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 1.4), arrowMat);
      bar.position.set(s * 0.45, 0.12, -0.2);
      bar.rotation.y = s * 0.55;
      g.add(bar);
    }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), arrowMat);
    tip.position.set(0, 0.12, 0.7);
    g.add(tip);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = yaw;
    parent.add(g);
    pads++;
  }

  return {
    coins: coinPositions.length,
    coinPositions,
    boxes,
    itemBoxPositions,
    pads,
  };
}

/** Chinatown lantern strings across the road (MainScene 0.5875 / 0.6225). */
export function buildLanternStrings(track, parent) {
  const red = std(0xe0362a, 0.5);
  red.name = 'mid_lantern';
  const wireMat = std(0x2c2c34, 0.6);
  let n = 0;
  for (const [t, width, y] of [
    [0.5875, 19.2, 5.7],
    [0.6225, 18.6, 5.65],
  ]) {
    const p = track.pointAt(t);
    const tan = track.tangentAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    const count = 7;
    // single wire cylinder across (no bead scatter)
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, width, 6), wireMat);
    wire.rotation.z = Math.PI / 2;
    wire.position.y = 0;
    g.add(wire);
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const sag = Math.sin(u * Math.PI) * 0.45;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), red);
      bulb.position.set((u - 0.5) * width, -sag - 0.35, 0);
      g.add(bulb);
    }
    g.position.set(p.x, p.y + y, p.z);
    // Wire along local X must span ACROSS road (+X = side). atan2(-tz,tx) puts +X on tangent.
    g.rotation.y = Math.atan2(tan.x, tan.z);
    parent.add(g);
    n++;
  }
  return n;
}

/** Seam B: transit shops pinch + overhead awnings into the mall. */
export function buildSeamB(track, parent) {
  const pinch = [
    [0.63, 13.1, 0xe2574c, 'mid_sign_noodle'],
    [0.643, 11.7, 0x3f9d6b, 'mid_sign_teahouse'],
    [0.654, 10.4, 0xe59a2f, 'mid_sign_baobao'],
  ];
  for (const [t, latAbs, awn, signName] of pinch) {
    for (const sgn of [-1, 1]) {
      const p = track.pointAt(t);
      const side = track.sideAt(t);
      const g = new THREE.Group();
      const wood = std(0x9a7148, 0.8);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 5.4, 0.55), wood);
      wall.position.y = 2.7;
      g.add(wall);
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.1, 0.12), std(0xffe9bd, 0.35));
      win.position.set(0, 2.1, 0.3);
      g.add(win);
      const awnA = std(0xfdf7ec, 0.65);
      const awnB = std(awn, 0.65);
      for (let k = 0; k < 7; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.12, 0.9), k % 2 ? awnA : awnB);
        s.position.set(-2.25 + k * 0.75, 3.4, 0.55);
        s.rotation.x = 0.45;
        g.add(s);
      }
      const signMat = std(0xffffff, 0.55);
      signMat.name = signName;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.85, 0.14), signMat);
      sign.position.set(0, 4.4, 0.32);
      g.add(sign);
      const lat = sgn * latAbs;
      g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
      g.lookAt(p.x, g.position.y, p.z);
      parent.add(g);
    }
  }
  // Overhead striped awnings across road — poles MUST sit off asphalt
  for (const [t, width, y, col] of [
    [0.647, 18, 5.9, 0xe2574c],
    [0.657, 16.5, 5.75, 0x3f9d6b],
  ]) {
    const p = track.pointAt(t);
    const tan = track.tangentAt(t);
    const hw = track.roadWidth / 2;
    // Keep posts clear of curb (hw+2.2 ≈ 9.2)
    const span = Math.max(width, hw * 2 + 4.4);
    const g = new THREE.Group();
    const wood = std(0x8a6440, 0.8);
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, y, 8), wood);
      post.position.set((s * span) / 2, y / 2, 0);
      g.add(post);
    }
    const awnA = std(0xfdf7ec, 0.7);
    const awnB = std(col, 0.7);
    for (let k = 0; k < 14; k++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(span / 14, 0.18, 1.6), k % 2 ? awnA : awnB);
      stripe.position.set(-span / 2 + (k + 0.5) * (span / 14), y, 0);
      g.add(stripe);
    }
    g.position.set(p.x, p.y, p.z);
    // Same as start/city banners: +X across road. Wrong atan2(-tz,tx) planted brown posts on asphalt.
    g.rotation.y = Math.atan2(tan.x, tan.z);
    parent.add(g);
  }
}

/**
 * Minimal roadside accents only — NO euro stone over road, NO scattered check cells,
 * NO GO/chevron clutter. City rails as short continuous-looking pieces.
 */
export function buildAlignmentPass(track, parent) {
  const railWhite = std(0xfdfaf2, 0.5);
  railWhite.name = 'mid_city_rail';
  const railBlue = std(0x4d8fd6, 0.55);
  railBlue.name = 'mid_city_rail_post';
  const placeRail = (t, lat) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    const g = new THREE.Group();
    const r1 = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.34, 0.22, 2, 0.1), railWhite);
    r1.position.y = 0.72;
    g.add(r1);
    const r2 = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.22, 0.18, 2, 0.08), railWhite);
    r2.position.y = 0.38;
    g.add(r2);
    for (const x of [-0.95, 0.95]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.9, 0.26, 2, 0.08), railBlue);
      post.position.set(x, 0.45, 0);
      g.add(post);
    }
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    g.rotation.y = Math.atan2(-tan.z, tan.x);
    parent.add(g);
  };
  // Full original city-rail density (outer bend)
  for (let i = 0; i < 9; i++) placeRail(0.362 + i * 0.0105, -7.65);
  for (let i = 0; i < 5; i++) placeRail(0.4835 + i * 0.0105, -7.65);

  // Planter trees — restore original city density
  const potMat = std(0xfdf8ee, 0.6); potMat.name = 'mid_planter_pot';
  const rimMat = std(0xffb35c, 0.6); rimMat.name = 'mid_planter_rim';
  const greens = [0x7ecb5f, 0x66bb6a, 0x9ed36a];
  for (const [t, lat] of [
    [0.283, 8.9], [0.283, -8.9], [0.312, 8.9], [0.34, 8.9], [0.34, -8.9],
    [0.37, 8.7], [0.46, 8.8], [0.475, -8.8], [0.30, -8.9], [0.38, -8.9], [0.42, 8.9],
  ]) {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const leaf = std(greens[Math.round(t * 1000) % 3], 0.85);
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.75, 12), potMat);
    pot.position.y = 0.375;
    g.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 8, 16), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.72;
    g.add(rim);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.7, 8), std(0x9a6b45));
    trunk.position.y = 1.0;
    g.add(trunk);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), leaf);
    ball.position.y = 1.95;
    g.add(ball);
    g.position.set(p.x + side.x * lat, Math.max(0, p.y), p.z + side.z * lat);
    parent.add(g);
  }
}

/**
 * Midground warehouses / sheds along harbor + mall exterior lawn.
 * Fills the empty green void past chinatown (screenshot: BBQ → open lawn → distant towers).
 * Always |lat| ≥ 13 so nothing sits on asphalt or bridge deck.
 */
export function buildBackHalfStreetscape(track, parent) {
  const walls = [std(0xb8c4d0, 0.85), std(0xa8b6c4, 0.85), std(0xc5cdd6, 0.82)];
  const roofs = [std(0xd0495a, 0.7), std(0x4a6a88, 0.7), std(0xc2685a, 0.75)];
  const cream = std(0xf0e6d6, 0.8);
  const awning = [std(0xff9e7d, 0.65), std(0x7dd4ff, 0.65), std(0xffd23e, 0.65)];
  let n = 0;

  const placeShed = (t, lat, w, h, d, wi) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), walls[wi % walls.length]);
    body.position.y = h / 2;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.45, d + 0.3), roofs[wi % roofs.length]);
    roof.position.y = h + 0.2;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.35, h * 0.55, 0.12), std(0x5a6570, 0.7));
    door.position.set(0, h * 0.3, d / 2 + 0.05);
    g.add(door);
    g.position.set(p.x + side.x * lat, Math.max(0, p.y), p.z + side.z * lat);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  };

  const placeMallBlock = (t, lat, w, h, d, ai) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cream);
    body.position.y = h / 2;
    g.add(body);
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.35, 1.2), awning[ai % awning.length]);
    aw.position.set(0, 3.2, d / 2 + 0.5);
    g.add(aw);
    const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 1.6, 0.1), std(0x6a7a8a, 0.4));
    win.position.set(0, 2.2, d / 2 + 0.04);
    g.add(win);
    g.position.set(p.x + side.x * lat, Math.max(0, p.y), p.z + side.z * lat);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  };

  // Mall exterior lawn (both sides) — visible when exiting chinatown
  const mallSlots = [
    [0.668, 14.5, 5.5, 6.5, 4.2],
    [0.685, -14.8, 6.0, 7.0, 4.5],
    [0.702, 15.2, 5.2, 6.2, 4.0],
    [0.72, -15.0, 5.8, 7.2, 4.4],
    [0.738, 14.6, 5.4, 6.8, 4.1],
  ];
  mallSlots.forEach(([t, lat, w, h, d], i) => placeMallBlock(t, lat, w, h, d, i));

  // Harbor warehouses flanking the blue bridge
  const harborSlots = [
    [0.77, 16.5, 7.5, 5.5, 5.0],
    [0.79, -16.8, 8.0, 6.0, 5.2],
    [0.815, 17.2, 7.0, 5.8, 4.8],
    [0.84, -17.0, 8.5, 6.5, 5.5],
    [0.865, 16.4, 7.2, 5.4, 5.0],
    [0.885, -16.6, 7.8, 6.2, 5.1],
  ];
  harborSlots.forEach(([t, lat, w, h, d], i) => placeShed(t, lat, w, h, d, i));

  // Extra chinatown outer ring — fill the open lawn beside BBQ / shops
  for (const [t, lat, w, h, d] of [
    [0.575, 14.8, 5.0, 6.5, 4.0],
    [0.595, 15.5, 5.5, 7.0, 4.2],
    [0.635, 15.0, 5.2, 6.2, 4.0],
    [0.56, -15.2, 5.0, 6.8, 4.1],
  ]) {
    placeShed(t, lat, w, h, d, Math.floor(t * 100));
  }

  return n;
}

/**
 * High-visibility drive-through landmarks from original MainScene / reference recording:
 * billboards, GO/chevron signs, park pond + cottage row, bridge finish checker, referee.
 * No PlaneGeometry; textured panels use mid_* names for postprocess inject.
 */
export function buildDriveThroughDetails(track, parent) {
  let n = 0;
  const hw = track.roadWidth / 2;

  const placeBillboard = (t, lat, yOff, matName) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    const W = 7.6;
    const H = 5.1;
    const LIFT = 3.2;
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(W + 0.7, H + 0.7, 0.55, 3, 0.22),
      std(0xf4f1e9, 0.6),
    );
    frame.position.y = LIFT + H / 2;
    g.add(frame);
    const panelMat = std(0xffffff, 0.7);
    panelMat.name = matName;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.18), panelMat);
    panel.position.set(0, LIFT + H / 2, 0.32);
    g.add(panel);
    const legMat = std(0xcfd4dc, 0.55);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, LIFT + 0.4, 10), legMat);
      leg.position.set(s * W * 0.32, (LIFT + 0.4) / 2, -0.1);
      g.add(leg);
    }
    for (const x of [-W * 0.3, 0, W * 0.3]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), legMat);
      arm.position.set(x, LIFT + H + 0.65, 0.35);
      arm.rotation.x = 0.7;
      g.add(arm);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), std(0xfff2cc, 0.4));
      lamp.position.set(x, LIFT + H + 0.95, 0.62);
      g.add(lamp);
    }
    g.position.set(p.x + side.x * lat, Math.max(0, p.y - 0.15) + yOff, p.z + side.z * lat);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  };
  placeBillboard(0.318, -11.8, 3.4, 'mid_billboard_corgi');
  placeBillboard(0.415, -11.8, 3.4, 'mid_billboard_panda');

  const placeGo = (t, lat) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.3, 8), std(0xf6f3ec, 0.5));
    pole.position.y = 1.15;
    g.add(pole);
    const plateMat = std(0xffffff, 0.55);
    plateMat.name = 'mid_sign_go';
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.12), plateMat);
    plate.position.y = 2.5;
    g.add(plate);
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  };
  placeGo(0.017, hw + 3.2);
  placeGo(0.115, -(hw + 3.2));

  const placeChevron = (t, lat) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    for (const x of [-0.6, 0.6]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 8), std(0xf6f3ec, 0.5));
      pole.position.set(x, 0.75, 0);
      g.add(pole);
    }
    const boardMat = std(0xffffff, 0.55);
    boardMat.name = 'mid_sign_chevron';
    const board = new THREE.Mesh(new RoundedBoxGeometry(2.0, 1.02, 0.14, 2, 0.04), boardMat);
    board.position.y = 1.9;
    g.add(board);
    g.position.set(p.x + side.x * lat, p.y, p.z + side.z * lat);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  };
  placeChevron(0.235, hw + 3.5);
  placeChevron(0.255, -(hw + 3.5));

  // Park pond
  {
    const candidates = [[0, 0], [8, 6], [-10, -6], [0, 14], [18, -8], [-16, 8]];
    let pondPos = null;
    for (const [x, z] of candidates) {
      const cand = new THREE.Vector3(x, 0, z);
      if (track.nearestInfo(cand).dist > 12.7) {
        pondPos = cand;
        break;
      }
    }
    if (!pondPos) {
      outer: for (let x = -20; x <= 20; x += 4) {
        for (let z = -10; z <= 40; z += 4) {
          const cand = new THREE.Vector3(x, 0, z);
          if (track.nearestInfo(cand).dist > 12.7) {
            pondPos = cand;
            break outer;
          }
        }
      }
    }
    if (pondPos) {
      const R = 5.2;
      const water = std(0x5eb8d8, 0.35);
      water.metalness = 0.15;
      water.name = 'mid_pond_water';
      const waterMesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.12, 28), water);
      waterMesh.position.set(pondPos.x, 0.06, pondPos.z);
      parent.add(waterMesh);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.28, 8, 28), std(0xcfc6b8, 0.85));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(pondPos.x, 0.12, pondPos.z);
      parent.add(rim);
      n += 2;
    }
  }

  // Park cottage row
  const cottageMat = std(0xf0dcc4, 0.85);
  const roofMat = std(0xc2685a, 0.75);
  const winMat = std(0x5a6a7a, 0.5);
  for (const [t, lat] of [
    [0.035, -13.5], [0.055, -13.5], [0.075, -13.5], [0.095, -13.5],
    [0.04, 14.2], [0.065, 14.2], [0.09, 14.2],
    [0.94, -13.2], [0.96, -13.2], [0.93, 13.5], [0.97, 13.5],
  ]) {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.6, 3.4), cottageMat);
    body.position.y = 1.8;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.55, 3.9), roofMat);
    roof.position.y = 3.85;
    g.add(roof);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.1), winMat);
    win.position.set(0, 2.0, 1.75);
    g.add(win);
    const tree = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), std(0x5faf4a, 0.9));
    tree.position.set(2.4, 1.4, 1.2);
    g.add(tree);
    g.position.set(p.x + side.x * lat, Math.max(0, p.y), p.z + side.z * lat);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  }

  // Soft sky clouds
  for (const [x, y, z, sx, sy] of [
    [40, 55, -30, 18, 5], [-55, 48, 20, 22, 6], [10, 62, 80, 16, 4.5],
    [-20, 50, 140, 20, 5.5], [70, 58, 60, 14, 4],
  ]) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), std(0xffffff, 1.0));
    cloud.position.set(x, y, z);
    cloud.scale.set(sx, sy, sx * 0.7);
    parent.add(cloud);
    n++;
  }

  // Bridge exit checkered finish band
  {
    const tB = 0.905;
    const t0 = tB - 0.017;
    const t1 = tB - 0.004;
    const light = std(0xf5f2ea, 0.8);
    const dark = std(0x23252e, 0.8);
    const cols = 10;
    const rows = 2;
    for (let row = 0; row < rows; row++) {
      const t = t0 + ((t1 - t0) * (row + 0.5)) / rows;
      const p = track.pointAt(t);
      const side = track.sideAt(t);
      const tan = track.tangentAt(t);
      const cellW = (hw * 2 - 0.4) / cols;
      const depth = 1.35;
      for (let col = 0; col < cols; col++) {
        const lat = -hw + 0.2 + (col + 0.5) * cellW;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(cellW * 0.92, 0.1, depth),
          (col + row) % 2 === 0 ? light : dark,
        );
        mesh.position.set(p.x + side.x * lat, p.y + 0.06, p.z + side.z * lat);
        mesh.rotation.y = Math.atan2(tan.x, tan.z);
        parent.add(mesh);
        n++;
      }
    }
  }

  // Robot referee at bridge approach
  {
    const tRef = 0.745;
    const p = track.pointAt(tRef);
    const side = track.sideAt(tRef);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 12), std(0xf4f4f4, 0.4));
    body.position.y = 1.1;
    g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), std(0x4a7ab0, 0.35));
    eye.position.set(0, 1.25, 0.7);
    g.add(eye);
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.12), std(0x2a2e38, 0.5));
    led.position.set(0, 2.35, 0.2);
    g.add(led);
    const digitMat = std(0xffffff, 0.4);
    digitMat.name = 'mid_sign_go';
    const digit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.08), digitMat);
    digit.position.set(0, 2.35, 0.28);
    g.add(digit);
    g.position.set(p.x + side.x * 9.4, p.y, p.z + side.z * 9.4);
    g.lookAt(p.x, g.position.y, p.z);
    parent.add(g);
    n++;
  }

  // Paifang center lantern cascade
  {
    const t = 0.6145;
    const p = track.pointAt(t);
    const red = std(0xe0362a, 0.5);
    red.name = 'mid_lantern';
    const gold = std(0xe8b23a, 0.45);
    for (let i = 0; i < 5; i++) {
      const y = 5.2 - i * 0.55;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), red);
      bulb.position.set(p.x, p.y + y, p.z);
      parent.add(bulb);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 0.12, 8), gold);
      cap.position.set(p.x, p.y + y + 0.28, p.z);
      parent.add(cap);
      n += 2;
    }
  }

  return n;
}

