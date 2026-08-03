/**
 * Offline bake: port Track + thematic scenery into race_track.glb for ForgeaX.
 * Run: node /tmp/trackbake/bake.mjs
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  buildSkylineBand,
  buildPicketFences,
  buildRoadsideFill,
  buildChinaWalls,
  buildMallInterior,
  buildBlueBridgeDense,
  buildPearlTower,
  buildYellowCurbs,
  buildBanners,
  buildTrackCenterProps,
  buildBlueApproach,
  buildLanternStrings,
  buildSeamB,
  buildAlignmentPass,
  buildBackHalfStreetscape,
  buildDriveThroughDetails,
} from './bake-scenery-fill.mjs';

// Three's browser exporter still expects FileReader when run under Node.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    result = null;
    onloadend = null;

    readAsArrayBuffer(blob) {
      return blob.arrayBuffer().then((value) => {
        this.result = value;
        this.onloadend?.({ target: this });
        return value;
      });
    }

    readAsDataURL(blob) {
      return blob.arrayBuffer().then((value) => {
        const mime = blob.type || 'application/octet-stream';
        this.result = `data:${mime};base64,${Buffer.from(value).toString('base64')}`;
        this.onloadend?.({ target: this });
        return this.result;
      });
    }
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '/Users/you/Desktop/forgeax/forgeax-studio/.forgeax/games/go-karts/assets';
const TEX_DIR =
  '/Users/you/Desktop/forgeax/claude-fable-5-93/code_rounds/round-34/code/public/assets';

const TRACK_MODULES = [
  { k: 's', len: 120.1 },
  { k: 't', a: -90, r: 39.2 },
  { k: 's', len: 56, dy: 2.6 },
  { k: 't', a: -90, r: 39.2 },
  { k: 's', len: 28 },
  { k: 't', a: 60, r: 28 },
  { k: 's', len: 22.4, dy: -2.6 },
  { k: 't', a: -60, r: 28 },
  { k: 's', len: 33.6 },
  { k: 't', a: -90, r: 39.2 },
  { k: 's', len: 102.8 },
  { k: 't', a: -90, r: 39.2 },
];

const ROAD_WIDTH = 14;

function walkModules(mods, cx, cz) {
  let x = cx,
    z = cz,
    h = 0,
    y = 0;
  const pts = [new THREE.Vector3(x, y, z)];
  for (const m of mods) {
    if (m.k === 's') {
      const steps = Math.max(1, Math.round(m.len / 7));
      for (let i = 0; i < steps; i++) {
        x += Math.sin(h) * (m.len / steps);
        z += Math.cos(h) * (m.len / steps);
        y += (m.dy || 0) / steps;
        pts.push(new THREE.Vector3(x, y, z));
      }
    } else {
      const ang = (m.a * Math.PI) / 180;
      const arc = Math.abs(ang) * m.r;
      const steps = Math.max(2, Math.round(arc / 7));
      for (let i = 0; i < steps; i++) {
        h += ang / steps;
        x += Math.sin(h) * (arc / steps);
        z += Math.cos(h) * (arc / steps);
        y += (m.dy || 0) / steps;
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  pts.pop();
  return pts;
}

function moduleLens() {
  const lens = TRACK_MODULES.map((m) =>
    m.k === 's' ? m.len : (Math.abs(m.a) * Math.PI) / 180 * m.r,
  );
  return { lens, total: lens.reduce((a, b) => a + b, 0) };
}

function moduleTRange(i) {
  const { lens, total } = moduleLens();
  const before = lens.slice(0, i).reduce((a, b) => a + b, 0);
  return [before / total, (before + lens[i]) / total];
}

function corridorTRange() {
  const { lens, total } = moduleLens();
  const before = lens.slice(0, 9).reduce((a, b) => a + b, 0);
  return [before / total, (before + lens[9] - 1.2) / total];
}

class Track {
  constructor() {
    const pts = walkModules(TRACK_MODULES, 86, -45.5);
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35);
    this.length = this.curve.getLength();
    this.roadWidth = ROAD_WIDTH;
    this.samplePts = [];
    for (let i = 0; i < 1024; i++) this.samplePts.push(this.curve.getPointAt(i / 1024));
    // Sparse mapPoints for skyline convex-hull (match original Track.mapPoints density)
    this.mapPoints = [];
    for (let i = 0; i < 128; i++) {
      const p = this.curve.getPointAt(i / 128);
      this.mapPoints.push({ x: p.x, z: p.z });
    }
    this.group = new THREE.Group();
    this.group.name = 'Track';
  }
  pointAt(t) {
    return this.curve.getPointAt(((t % 1) + 1) % 1);
  }
  tangentAt(t) {
    return this.curve
      .getTangentAt(((t % 1) + 1) % 1)
      .setY(0)
      .normalize();
  }
  sideAt(t) {
    const tan = this.tangentAt(t);
    return new THREE.Vector3(-tan.z, 0, tan.x);
  }
  nearestInfo(world) {
    let bestT = 0,
      bestD = Infinity;
    for (let i = 0; i < 512; i++) {
      const t = i / 512;
      const p = this.samplePts[Math.floor(t * 1024) % 1024];
      const d = (p.x - world.x) ** 2 + (p.z - world.z) ** 2;
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
    return { t: bestT, dist: Math.sqrt(bestD) };
  }
  signedCurvature(t) {
    const e = 0.004;
    const t1 = ((t - e) % 1 + 1) % 1;
    const t2 = (t + e) % 1;
    const d = this.curve.getTangentAt(t2).sub(this.curve.getTangentAt(t1));
    return this.sideAt(t).dot(d) / (2 * e * this.length);
  }
  ribbon(halfW, yOff, mat, inset = 0) {
    const N = 720;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = this.pointAt(t);
      const side = this.sideAt(t);
      const o = inset;
      positions.push(p.x + side.x * (halfW + o), p.y + yOff, p.z + side.z * (halfW + o));
      positions.push(p.x - side.x * (halfW - o), p.y + yOff, p.z - side.z * (halfW - o));
      const u = (t * this.length) / 8;
      uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2,
        b = i * 2 + 1,
        c = i * 2 + 2,
        d = i * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }
  build() {
    const asphalt = loadTex('tex_asphalt.png', 1, 1);
    const sidewalk = loadTex('tex_sidewalk.png', 1, 1);
    const roadMat = new THREE.MeshStandardMaterial({
      color: asphalt ? 0xe8eaf0 : 0x9aa0ae,
      map: asphalt,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    this.group.add(this.ribbon(this.roadWidth / 2 + 0.35, 0.04, roadMat));

    const swMat = new THREE.MeshStandardMaterial({
      color: sidewalk ? 0xd8d3c8 : 0xcfc9ba,
      map: sidewalk,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const hw = this.roadWidth / 2;
    for (const s of [1, -1]) {
      const N = 720;
      const positions = [];
      const uvs = [];
      const indices = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = this.pointAt(t);
        const side = this.sideAt(t);
        positions.push(
          p.x + side.x * s * (hw + 0.42),
          p.y + 0.03,
          p.z + side.z * s * (hw + 0.42),
        );
        positions.push(
          p.x + side.x * s * (hw + 2.4),
          p.y + 0.03,
          p.z + side.z * s * (hw + 2.4),
        );
        const u = (t * this.length) / 4;
        uvs.push(u, 0, u, 1);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2,
          b = i * 2 + 1,
          c = i * 2 + 2,
          d = i * 2 + 3;
        indices.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      this.group.add(new THREE.Mesh(geo, swMat));
    }

    // Curbs
    const curbA = new THREE.MeshStandardMaterial({ color: 0xffc93e, roughness: 0.65 });
    const curbB = new THREE.MeshStandardMaterial({ color: 0xffdf7a, roughness: 0.65 });
    const curbGeo = new THREE.CapsuleGeometry(0.17, 1.7, 4, 10);
    curbGeo.rotateX(Math.PI / 2);
    const CURBS = 200;
    for (let i = 0; i < CURBS; i++) {
      const t = i / CURBS;
      const p = this.pointAt(t);
      const side = this.sideAt(t);
      const tan = this.tangentAt(t);
      const rotY = Math.atan2(tan.x, tan.z);
      for (const sign of [1, -1]) {
        const curb = new THREE.Mesh(curbGeo, i % 2 === 0 ? curbA : curbB);
        curb.position.set(
          p.x + side.x * sign * (hw + 0.28),
          p.y + 0.1,
          p.z + side.z * sign * (hw + 0.28),
        );
        curb.rotation.y = rotY;
        this.group.add(curb);
      }
    }

    // Dashes
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.8 });
    const dashGeo = new THREE.BoxGeometry(0.3, 0.02, 1.7);
    const DASHES = 100;
    for (const lane of [-3.5, 0, 3.5]) {
      for (let i = 0; i < DASHES; i++) {
        const t = i / DASHES;
        const p = this.pointAt(t);
        const side = this.sideAt(t);
        const tan = this.tangentAt(t);
        const dash = new THREE.Mesh(dashGeo, dashMat);
        dash.position.set(p.x + side.x * lane, p.y + 0.08, p.z + side.z * lane);
        dash.rotation.y = Math.atan2(tan.x, tan.z);
        this.group.add(dash);
      }
    }

    // Boundary walls
    const [c0, c1] = corridorTRange();
    const lat = 7.45;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xfff1d9,
      roughness: 0.82,
      side: THREE.DoubleSide,
    });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xffc355, roughness: 0.55 });
    const N = 600;
    for (const s of [1, -1]) {
      const hs = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const k = this.signedCurvature(t);
        hs.push(Math.abs(k) > 0.045 && s * k < 0 ? 0.95 : 0.5);
      }
      for (let pass = 0; pass < 3; pass++) {
        const prev = hs.slice();
        for (let i = 0; i <= N; i++) {
          hs[i] = (prev[(i + N) % (N + 1)] + prev[i] + prev[(i + 1) % (N + 1)]) / 3;
        }
      }
      const tA = c1 + 0.012;
      const tB = c0 + 1 - 0.012;
      const positions = [];
      const indices = [];
      const topPts = [];
      let vi = 0;
      let prevIn = false;
      for (let i = 0; i <= N; i++) {
        const tw = tA + ((tB - tA) * i) / N;
        const t = tw % 1;
        const p = this.pointAt(t);
        const side = this.sideAt(t);
        const x = p.x + side.x * s * lat;
        const z = p.z + side.z * s * lat;
        positions.push(x, p.y, z, x, p.y + hs[i], z);
        topPts.push(new THREE.Vector3(x, p.y + hs[i], z));
        if (prevIn) {
          const a = vi - 2,
            b = vi - 1,
            c = vi,
            d = vi + 1;
          indices.push(a, b, c, b, d, c);
        }
        prevIn = true;
        vi += 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      this.group.add(new THREE.Mesh(geo, wallMat));
      const topCurve = new THREE.CatmullRomCurve3(topPts, false);
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(topCurve, 600, 0.16, 8, false), topMat));
    }

    // Start line — thin boxes (PlaneGeometry becomes floating sheets after merge)
    const startMat = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.85 });
    const p = this.pointAt(0);
    const tan = this.tangentAt(0);
    const side0 = this.sideAt(0);
    const line = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth, 0.04, 2.2), startMat);
    line.position.set(p.x, p.y + 0.04, p.z);
    line.rotation.y = Math.atan2(tan.x, tan.z);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x23252e, roughness: 0.85 });
    for (let i = -6; i <= 6; i++) {
      if ((i + 6) % 2 !== 0) continue;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.045, 2.2), darkMat);
      stripe.position.set(p.x + side0.x * i * 1.1, p.y + 0.045, p.z + side0.z * i * 1.1);
      stripe.rotation.y = Math.atan2(tan.x, tan.z);
      this.group.add(stripe);
    }
    this.group.add(line);

    // Guardrails (skip corridor+bridge modules 9-10)
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.5 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.6 });
    const rhw = this.roadWidth / 2 + 2.7;
    const [c0b] = moduleTRange(9);
    const [, b1] = moduleTRange(10);
    const tA = b1 + 0.004;
    const tB = c0b + 1 - 0.004;
    for (const s of [1, -1]) {
      const pts = [];
      const RN = 300;
      for (let i = 0; i <= RN; i++) {
        const t = (tA + ((tB - tA) * i) / RN) % 1;
        const p = this.pointAt(t);
        const side = this.sideAt(t);
        pts.push(new THREE.Vector3(p.x + side.x * s * rhw, p.y + 0.55, p.z + side.z * s * rhw));
      }
      const c = new THREE.CatmullRomCurve3(pts, false);
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(c, 400, 0.09, 6, false), railMat));
      const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.6, 6);
      for (let i = 0; i <= 80; i++) {
        const t = (tA + ((tB - tA) * i) / 80) % 1;
        const p = this.pointAt(t);
        const side = this.sideAt(t);
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(p.x + side.x * s * rhw, p.y + 0.3, p.z + side.z * s * rhw);
        this.group.add(post);
      }
    }
  }
}

const texCache = new Map();
function loadTex(name, rx, ry) {
  const path = join(TEX_DIR, name);
  if (!existsSync(path)) return null;
  if (texCache.has(name)) return texCache.get(name);
  // Node: create texture from file via DataTexture is heavy; use color-only fallback
  // and embed file later via ImageBitmap if available. For bake reliability use null map.
  texCache.set(name, null);
  return null;
}

function std(color, roughness = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/** Place a group at track lateral offset, facing the road centerline. */
function putAtTrack(parent, track, piece, t, sideOff, scale = 1) {
  const p = track.pointAt(t);
  const side = track.sideAt(t);
  piece.scale.setScalar(scale);
  piece.position.set(p.x + side.x * sideOff, Math.max(0, p.y), p.z + side.z * sideOff);
  piece.lookAt(p.x, piece.position.y, p.z);
  parent.add(piece);
}

/** Stone skirt under midground buildings — kills “floating white box” look. */
function addFootSkirt(g, w, d, _name = 'footing') {
  // No mid_* — ForgeaX shades untextured glTF mid mats near-black on side elevations.
  const mat = std(0xb8b0a4, 0.88);
  const h = 0.32;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, h, d + 0.7), mat);
  foot.position.y = h / 2;
  g.add(foot);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 1.15, 0.12, d + 1.15), mat);
  lip.position.y = 0.06;
  g.add(lip);
}

/**
 * Distilled createEuroHouse — midground with named materials for textured signs/awnings.
 * Face +Z; call putAtTrack to orient toward road.
 * shop: 'pizza'|'burger'|'gelato'|'cake'
 * Only sign/awning use mid_* (PNG inject). Walls/roofs stay unnamed → col_* → pack PBR.
 */
function createEuroHouse(o) {
  const g = new THREE.Group();
  const d = 6.5;
  const H0 = 2.7;
  const HF = 2.15;
  const uppers = o.stories - 1;
  const H = H0 + uppers * HF;
  const shop = o.shop ?? 'pizza';
  const wallMat = std(o.wall, 0.9);
  const trimMat = std(o.trim, 0.6);
  const glassMat = std(0x6aa8c8, 0.28);
  glassMat.metalness = 0.05;
  const roofMat = std(o.roof, 0.75);
  const doorMat = std(o.door, 0.6);
  // Named for postprocess PNG inject (do not merge with skyline solids)
  const signMat = std(0xffffff, 0.55);
  signMat.name = `mid_sign_${shop}`;
  const awnMat = std(0xffffff, 0.8);
  awnMat.name = `mid_awning_${shop}`;

  addFootSkirt(g, o.w, d);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(o.w, H, d), wallMat);
  wall.position.y = H / 2;
  g.add(wall);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.12, 0.35, d + 0.12), trimMat);
  belt.position.y = H0;
  g.add(belt);

  const roofBase = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.35, 0.7, d + 0.35), roofMat);
  roofBase.position.y = H + 0.35;
  g.add(roofBase);
  const roofRidge = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.4, 1.2, d * 0.36), roofMat);
  roofRidge.position.y = H + 1.2;
  g.add(roofRidge);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), trimMat);
  chimney.position.set(o.w * 0.24, H + 1.4, -d * 0.18);
  g.add(chimney);

  const cols = Math.max(2, Math.round((o.w - 2.4) / 2.1));
  const zF = d / 2;
  for (let f = 0; f < uppers; f++) {
    const y = H0 + (f + 0.52) * HF;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const x = (cIdx - (cols - 1) / 2) * (o.w / cols) * 0.88;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.22, 0.16), trimMat);
      frame.position.set(x, y, zF + 0.02);
      g.add(frame);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.0, 0.08), glassMat);
      glass.position.set(x, y, zF + 0.08);
      g.add(glass);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.1, 0.24), trimMat);
      sill.position.set(x, y - 0.68, zF + 0.1);
      g.add(sill);
    }
  }

  // Storefront
  const showFrame = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.44, 1.72, 0.16), trimMat);
  showFrame.position.set(o.w * 0.18, 1.42, zF + 0.02);
  g.add(showFrame);
  const showGlass = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.38, 1.5, 0.08), glassMat);
  showGlass.position.set(o.w * 0.18, 1.42, zF + 0.08);
  g.add(showGlass);
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.16), trimMat);
  doorFrame.position.set(-o.w * 0.26, 1.16, zF + 0.02);
  g.add(doorFrame);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.05, 0.1), doorMat);
  door.position.set(-o.w * 0.26, 1.06, zF + 0.09);
  g.add(door);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.7), trimMat);
  step.position.set(-o.w * 0.26, 0.07, zF + 0.3);
  g.add(step);

  // Single awning board (striped via mid_awning_* texture in postprocess)
  const awning = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.62, 0.12, 1.05), awnMat);
  awning.position.set(o.w * 0.05, 2.42, zF + 0.55);
  awning.rotation.x = 0.42;
  g.add(awning);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.14), signMat);
  sign.position.set(o.w * 0.05, 3.06, zF + 0.14);
  g.add(sign);

  return g;
}

/** Distilled createCityTower — podium + glass body; window grid ONLY on front face. */
function createCityTower(o) {
  const g = new THREE.Group();
  const band = o.band ?? 0xf4f1e9;
  const floorH = 3.0;
  const floors = Math.max(4, Math.round(o.h / floorH));
  const bodyH = floors * floorH;
  // Solids unnamed → col_* pack PBR (mid_* untextured = black side elevations in ForgeaX)
  const bandMat = std(band, 0.7);
  const glassMat = std(0xb9cfe0, 0.45);
  glassMat.metalness = 0.08;
  const paneMat = std(0x4a7aa0, 0.35);
  const doorMat = std(0x35608f, 0.35);
  const gridMat = std(0xffffff, 0.5);
  gridMat.name = 'mid_window_grid';

  addFootSkirt(g, o.w + 2.2, o.d + 2.2);

  const podH = 3.4;
  const pod = new THREE.Mesh(new THREE.BoxGeometry(o.w + 2.2, podH, o.d + 2.2), bandMat);
  pod.position.y = podH / 2;
  g.add(pod);
  const door = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.5, 2.3, 0.3), doorMat);
  door.position.set(0, 1.2, (o.d + 2.2) / 2 - 0.05);
  g.add(door);

  const body = new THREE.Mesh(new THREE.BoxGeometry(o.w, bodyH, o.d), glassMat);
  body.position.y = podH + bodyH / 2;
  g.add(body);

  // Front-only window grid plaque (avoids black UV wrap on side faces)
  const grid = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.92, bodyH * 0.92, 0.14), gridMat);
  grid.position.set(0, podH + bodyH / 2, o.d / 2 + 0.08);
  g.add(grid);

  // Sparse pane accents on +Z
  const cols = Math.max(3, Math.round(o.w / 1.7));
  const rows = floors;
  const cellW = (o.w * 0.86) / cols;
  const cellH = floorH * 0.72;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((c + r) % 5 === 0) continue;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(cellW * 0.78, cellH * 0.78, 0.12), paneMat);
      pane.position.set(
        (c - (cols - 1) / 2) * cellW,
        podH + (r + 0.5) * floorH,
        o.d / 2 + 0.16,
      );
      g.add(pane);
    }
  }

  const cornGeo = new THREE.CylinderGeometry(0.26, 0.26, bodyH, 8);
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const cc = new THREE.Mesh(cornGeo, bandMat);
    cc.position.set((sx * o.w) / 2, podH + bodyH / 2, (sz * o.d) / 2);
    g.add(cc);
  }

  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(o.w * 0.55, 1.9, o.d * 0.55),
    std(o.crown ?? band, 0.65),
  );
  crown.position.y = podH + bodyH + 0.95;
  g.add(crown);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.2, 6), std(0xe8e4da, 0.5));
  ant.position.y = podH + bodyH + 3.4;
  g.add(ant);

  return g;
}

/** Chinatown shop: red body + dark roof + yellow trim windows (not a flat red box). */
function createChinaShop(w, h, d, signName = 'mid_sign_chinatown') {
  const g = new THREE.Group();
  const red = std(0xb03a30, 0.65);
  const roof = std(0x2c3038, 0.75);
  const trim = std(0xf0c040, 0.55);
  const glass = std(0x6aa8c8, 0.3);
  const lantern = std(0xe0362a, 0.55);
  addFootSkirt(g, w, d);
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.12), red);
  body.position.y = h / 2;
  g.add(body);
  // Wood skirt band
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.85, d + 0.05), std(0x7a4a2c, 0.75));
  skirt.position.y = 0.42;
  g.add(skirt);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.45, d + 0.3), roof);
  top.position.y = h + 0.2;
  g.add(top);
  // Upturned eave tips
  for (const sx of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.55), roof);
    tip.position.set(sx * w * 0.42, h + 0.45, d * 0.35);
    tip.rotation.z = sx * -0.4;
    g.add(tip);
  }
  // Gold plaque with named texture
  const plaqueMat = std(0xffffff, 0.5);
  plaqueMat.name = signName;
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.75, 0.14), plaqueMat);
  plaque.position.set(0, h * 0.78, d / 2 + 0.08);
  g.add(plaque);
  // Front windows with wood frames
  const cols = Math.max(2, Math.round(w / 2.2));
  for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * (w / cols) * 0.85;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.12), trim);
    frame.position.set(x, h * 0.45, d / 2 + 0.04);
    g.add(frame);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.1, 0.08), glass);
    pane.position.set(x, h * 0.45, d / 2 + 0.1);
    g.add(pane);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.8, 0.12), trim);
  door.position.set(0, 0.95, d / 2 + 0.06);
  g.add(door);
  // Eave lanterns (3)
  for (const sx of [-0.35, 0, 0.35]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), std(0x3c4250));
    cord.position.set(sx * w, h + 0.05, d / 2 + 0.4);
    g.add(cord);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), lantern);
    bulb.position.set(sx * w, h - 0.28, d / 2 + 0.4);
    g.add(bulb);
  }
  return g;
}

function putTree(group, x, y, z, scale = 1, green = 0x4f9e3a) {
  // Darker foliage than lawn (0xa8d878) so postprocess color-merge won't fuse trees into grass.
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.4, 8), std(0x9c6b43, 0.9));
  trunk.position.y = 0.7;
  g.add(trunk);
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(1.35, 12, 10), std(green, 0.95));
  s1.position.y = 2.2;
  g.add(s1);
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), std(green, 0.95));
  s2.position.set(0.7, 2.9, 0.2);
  g.add(s2);
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  group.add(g);
}

function putHedge(group, track, t, lat) {
  const p = track.pointAt(t);
  const side = track.sideAt(t);
  const tan = track.tangentAt(t);
  const hedge = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 2.2, 4, 8),
    std(0x67b957, 0.92),
  );
  hedge.rotation.z = Math.PI / 2;
  hedge.position.set(p.x + side.x * lat, p.y + 0.42, p.z + side.z * lat);
  hedge.rotation.y = Math.atan2(-tan.z, tan.x);
  group.add(hedge);
}

function buildScenery(track, root) {
  const scenery = new THREE.Group();
  scenery.name = 'Scenery';

  // Euro street — detailed houses (×2.4 like MainScene), not white RoundedBoxes
  const ES = 2.4;
  const EOFF = 18.5;
  const euro = [
    [0.19, -EOFF, { stories: 4, w: 6.5, wall: 0xf6e7c8, trim: 0xfdfaf0, roof: 0xcf7250, door: 0x8a5a37, shop: 'pizza' }],
    [0.228, -EOFF, { stories: 3, w: 7, wall: 0xf2cabf, trim: 0xfff6ea, roof: 0xb97a5e, door: 0x4f9c94, shop: 'gelato' }],
    [0.266, -EOFF, { stories: 5, w: 6, wall: 0xe3c49b, trim: 0xfdfaf0, roof: 0xc2685a, door: 0x7a4a2c, shop: 'burger' }],
    [0.15, EOFF, { stories: 4, w: 7, wall: 0xf6e7c8, trim: 0xfff6ea, roof: 0xcf7250, door: 0x4f9c94, shop: 'cake' }],
  ];
  for (const [t, off, opts] of euro) {
    putAtTrack(scenery, track, createEuroHouse(opts), t, off, ES);
  }

  // City towers with window grids
  const towers = [
    [0.285, -16.5, { h: 24, w: 9, d: 9, band: 0xf4f1e9 }],
    [0.318, -17.0, { h: 33, w: 10, d: 10, band: 0xeef2f5, crown: 0x9fd0ee }],
    [0.35, -16.5, { h: 27, w: 9, d: 9, band: 0xf6ead6 }],
    [0.292, 16.25, { h: 21, w: 8.5, d: 8.5, band: 0xf4f1e9 }],
    [0.335, 16.75, { h: 28, w: 9.5, d: 9.5, band: 0xeef2f5 }],
    [0.375, -16.5, { h: 25, w: 9, d: 9, band: 0xf6ead6, crown: 0xffc98a }],
    [0.415, -17.0, { h: 31, w: 10, d: 10, band: 0xf4f1e9 }],
    [0.452, -16.25, { h: 22, w: 8.5, d: 8.5, band: 0xeef2f5 }],
  ];
  for (const [t, off, opts] of towers) {
    putAtTrack(scenery, track, createCityTower(opts), t, off, 1);
  }

  // Chinatown shops with named gold plaques
  for (const [t, lat, w, h, d, signName] of [
    [0.5625, -11.05, 6.6, 7.3, 4.8, 'mid_sign_goldenwok'],
    [0.5735, -11.05, 6.2, 7.3, 4.8, 'mid_sign_luckydragon'],
    [0.601, -11.05, 6.6, 7.3, 4.8, 'mid_sign_dimsum'],
    [0.6115, -11.05, 6.2, 7.3, 4.8, 'mid_sign_jadepalace'],
    [0.589, 11.5, 7, 4.2, 4.8, 'mid_sign_teagarden'],
    [0.617, 10.9, 6, 4.2, 4.8, 'mid_sign_baohouse'],
  ]) {
    putAtTrack(scenery, track, createChinaShop(w, h, d, signName), t, lat, 1);
  }

  // Paifang — fuller gate (stone bases, double beams, gold plaque, finials)
  {
    const t = 0.6145;
    const p = track.pointAt(t);
    const tan = track.tangentAt(t);
    const width = 20.4;
    const red = std(0xb03a30, 0.6);
    const dark = std(0x3c4250, 0.7);
    const gold = std(0xe8b23a, 0.5);
    const stone = std(0xcfc6b8, 0.85);
    const g = new THREE.Group();
    for (const s of [1, -1]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 1.1), stone);
      base.position.set((s * width) / 2, 0.28, 0);
      g.add(base);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 6.4, 12), red);
      col.position.set((s * width) / 2, 3.5, 0);
      g.add(col);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), gold);
      fin.position.set((s * width) / 2, 6.9, 0);
      g.add(fin);
    }
    const beam1 = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, 0.5, 0.55), red);
    beam1.position.y = 5.55;
    g.add(beam1);
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.35, 0.45), red);
    beam2.position.y = 6.15;
    g.add(beam2);
    const plaqueMat = std(0xffffff, 0.5);
    plaqueMat.name = 'mid_sign_chinatown';
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.95, 0.22), plaqueMat);
    plaque.position.set(0, 5.55, 0.4);
    g.add(plaque);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, 0.45, 1.7), dark);
    roof.position.y = 6.85;
    g.add(roof);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(width * 0.35, 0.35, 0.5), dark);
    ridge.position.y = 7.3;
    g.add(ridge);
    // upturned eaves as small boxes
    for (const s of [1, -1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.55), dark);
      tip.position.set((s * width) / 2 * 0.72, 7.05, 0.55);
      tip.rotation.z = s * -0.35;
      g.add(tip);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(tan.x, tan.z);
    scenery.add(g);
  }

  // Stone apron under Chinatown shops (thick boxes — kill floating lawn)
  {
    const stone = std(0xcfc6b8, 0.85);
    for (const [tA, tB, lat0, lat1] of [
      [0.5455, 0.663, -14.9, -9.45],
      [0.552, 0.663, 9.45, 13.1],
    ]) {
      const N = 14;
      for (let i = 0; i < N; i++) {
        const ta = tA + ((tB - tA) * i) / N;
        const tb = tA + ((tB - tA) * (i + 1)) / N;
        const t = (ta + tb) / 2;
        const p = track.pointAt(t);
        const pA = track.pointAt(ta);
        const pB = track.pointAt(tb);
        const side = track.sideAt(t);
        const tan = track.tangentAt(t);
        const len = Math.hypot(pB.x - pA.x, pB.z - pA.z) + 0.1;
        const midLat = (lat0 + lat1) / 2;
        const w = Math.abs(lat1 - lat0);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, len), stone);
        slab.position.set(p.x + side.x * midLat, p.y + 0.09, p.z + side.z * midLat);
        slab.rotation.y = Math.atan2(-tan.z, tan.x);
        scenery.add(slab);
      }
    }
  }

  buildLanternStrings(track, scenery);
  buildSeamB(track, scenery);

  // Mall corridor is fully built by buildMallInterior (thick boxes).
  // Do NOT add zero-thickness BufferGeometry wall ribbons — postprocess drops them.

  // Blue approach (piers + entry beam) then dense truss bridge
  buildBlueApproach(track, scenery);
  const bridgeInfo = buildBlueBridgeDense(track, scenery, moduleLens);
  console.log(
    `[bridge] tA=${bridgeInfo.tA.toFixed(3)} tB=${bridgeInfo.tB.toFixed(3)} span=${bridgeInfo.span.toFixed(1)} halfW=${bridgeInfo.halfW} panels=${bridgeInfo.panels}`,
  );
  buildPearlTower(track, scenery);

  // Trees & hedges along park / midground (world spots)
  const treeSpots = [
    [6, -4],
    [-8, 10],
    [12, 16],
    [-4, -18],
    [4, 22],
    [-18, -6],
    [20, -4],
    [-14, 20],
    [10, -28],
    [42, 16],
    [-42, 12],
    [16, 32],
    [-24, 30],
    [44, -18],
  ];
  for (const [x, z] of treeSpots) {
    let bd = Infinity;
    for (let i = 0; i < 256; i++) {
      const s = track.samplePts[Math.floor((i / 256) * 1024)];
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) bd = d;
    }
    if (Math.sqrt(bd) < 10.5) continue;
    putTree(scenery, x, 0, z, 0.9 + Math.random() * 0.4);
  }

  for (let t = 0.118; t < 0.174; t += 0.013) putHedge(scenery, track, t, 9.55);
  for (let t = 0.13; t < 0.174; t += 0.013) putHedge(scenery, track, t, -9.55);
  for (const t of [0.032, 0.044, 0.056, 0.068, 0.08, 0.918, 0.942, 0.966, 0.99]) {
    putHedge(scenery, track, t, 9.4);
  }

  // ---- Density layers from original MainScene (skyline / seams / midground / china / mall) ----
  const skyN = buildSkylineBand(track, scenery);
  const fenceN = buildPicketFences(track, scenery);
  const curbN = buildYellowCurbs(track, scenery);
  const fillN = buildRoadsideFill(track, scenery);
  const banN = buildBanners(track, scenery);
  const wallN = buildChinaWalls(track, scenery);
  const centerProps = buildTrackCenterProps(track, scenery);
  buildAlignmentPass(track, scenery);
  const backN = buildBackHalfStreetscape(track, scenery);
  const detailN = buildDriveThroughDetails(track, scenery);
  const [c0, c1] = corridorTRange();
  buildMallInterior(track, scenery, c0, c1);
  console.log(
    `[scenery] skyline=${skyN} pickets=${fenceN} curbs=${curbN} roadside=${fillN} banners=${banN} chinaWalls=${wallN} coins=${centerProps.coins} boxes=${centerProps.boxes} pads=${centerProps.pads} backHalf=${backN} details=${detailN}`,
  );

  root.add(scenery);
  return {
    coinPositions: centerProps.coinPositions,
    itemBoxPositions: centerProps.itemBoxPositions,
  };
}

function buildGround(root) {
  // Use a thin box (not PlaneGeometry): ForgeaX / glTF flatten can leave
  // rotated planes vertical after join, which makes the grass disappear.
  // Keep UNNAMED solid green → pack PBR remap. Do NOT name mid_* or inject
  // textures here: ForgeaX often shows white film when glTF tex fails to bind.
  const grass = new THREE.Mesh(
    new THREE.BoxGeometry(500, 0.2, 500),
    std(0xa8d878, 0.95),
  );
  grass.position.y = -0.1;
  grass.name = 'Grass';
  root.add(grass);
}

/** Landmark placements for scene.pack.json (existing prop GLBs). */
function landmarkPlacements(track) {
  const at = (t, lat, rotExtra = 0) => {
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    // lookAt track center → yaw; ForgeaX quat later
    const x = p.x + side.x * lat;
    const z = p.z + side.z * lat;
    const yaw = Math.atan2(p.x - x, p.z - z) + rotExtra;
    return { x, y: p.y, z, yaw };
  };
  return {
    PropClocktower: { ...at(0.05, 16.0), scale: 1.0, targetH: 17 },
    PropBridge: { x: -5, y: 0, z: 167, yaw: 0, scale: 1.0, targetH: 88 },
    PropShop0: { ...at(0.548, -12), scale: 1.0, targetH: 12.5 },
    PropShop1: { ...at(0.588, -12), scale: 1.0, targetH: 13.9 },
    PropShop2: { ...at(0.624, -12), scale: 1.0, targetH: 12.5 },
    PropDrum: { ...at(0.6, -9.8), scale: 1.0, targetH: 2.3 },
    PropBench0: { ...at(0.09, 10.2), scale: 1.0, targetH: 1.05 },
    PropBench1: { ...at(0.13, -10.2), scale: 1.0, targetH: 1.05 },
    PropBench2: { ...at(0.95, 10.0), scale: 1.0, targetH: 1.05 },
    PropTower0: { ...at(0.3, 38), scale: 1.0, targetH: 24 },
    PropTower1: { ...at(0.345, -44), scale: 1.0, targetH: 30 },
    PropTower2: { ...at(0.395, 42), scale: 1.0, targetH: 28 },
    PropTower3: { ...at(0.445, -50), scale: 1.0, targetH: 36 },
    PropTower4: { ...at(0.48, 40), scale: 1.0, targetH: 28 },
    PropTower5: { ...at(0.82, -36), scale: 1.0, targetH: 21 },
    PropTower6: { ...at(0.85, 37), scale: 1.0, targetH: 28 },
    PropTower7: { ...at(0.88, -34), scale: 1.0, targetH: 17 },
    // Keep |lat| ≥ roadHalf+4.5 so prop_tree canopy (~1.2m×scale) never sits on asphalt.
    PropTree0: { ...at(0.08, 14.5), scale: 1.0, targetH: 3.4 },
    PropTree1: { ...at(0.15, -14.5), scale: 1.0, targetH: 4.1 },
    PropTree2: { ...at(0.35, 15.0), scale: 1.0, targetH: 3.4 },
    PropTree3: { ...at(0.22, 14.0), scale: 1.0, targetH: 3.8 },
    PropTree4: { ...at(0.4, -14.0), scale: 1.0, targetH: 4.2 },
    PropTree5: { ...at(0.7, 14.0), scale: 1.0, targetH: 3.6 },
    PropTree6: { ...at(0.02, -14.5), scale: 1.0, targetH: 3.7 },
    PropTree7: { ...at(0.5, 15.5), scale: 1.0, targetH: 4.0 },
    PropTree8: { ...at(0.62, -15.0), scale: 1.0, targetH: 3.9 },
    PropTree9: { ...at(0.78, 14.5), scale: 1.0, targetH: 4.3 },
    PropTree10: { ...at(0.9, -14.5), scale: 1.0, targetH: 3.5 },
    PropTree11: { ...at(0.96, 15.0), scale: 1.0, targetH: 4.1 },
    // 14 main lamps alternating sides (original density)
    ...Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => {
        const t = i / 14 + 0.02;
        const lat = (i % 2 === 0 ? 1 : -1) * (ROAD_WIDTH / 2 + 3.6);
        return [`PropLamp${i}`, { ...at(t, lat), scale: 1.0, targetH: 4.2 }];
      }),
    ),
    // Robots kept OFF asphalt — prop_robot GLB reads as a pole/sign in-lane
    PropRobot0: { ...at(0.3, 10.8), scale: 1.0, targetH: 1.5 },
    PropRobot1: { ...at(0.58, -10.8), scale: 1.0, targetH: 1.5 },
    PropBarrier0: { ...at(0.47, ROAD_WIDTH / 2 + 3.4), scale: 1.0, targetH: 1.2 },
  };
}

async function main() {
  const root = new THREE.Group();
  root.name = 'RaceWorld';

  const track = new Track();
  track.build();
  root.add(track.group);
  // Solid-color ground + procedural streetscape. Postprocess only textures
  // asphalt/sidewalk (not grass/wood) so trees stay separate from the lawn.
  buildGround(root);
  const { coinPositions, itemBoxPositions } = buildScenery(track, root);

  const placements = landmarkPlacements(track);
  const spawn = (() => {
    const t = 0.004;
    const p = track.pointAt(t);
    const side = track.sideAt(t);
    const tan = track.tangentAt(t);
    return {
      x: p.x + side.x * -2.6,
      y: p.y,
      z: p.z + side.z * -2.6,
      heading: Math.atan2(tan.x, tan.z),
    };
  })();

  writeFileSync(
    join(OUT_DIR, 'track-landmarks.json'),
    JSON.stringify(
      {
        spawn,
        placements,
        corrTRange: corridorTRange(),
        coins: coinPositions,
        itemBoxes: itemBoxPositions,
      },
      null,
      2,
    ),
  );

  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => resolve(Buffer.from(result)),
      (err) => reject(err),
      { binary: true, onlyVisible: true },
    );
  });

  const rawPath = join(OUT_DIR, '_race_track_raw.glb');
  writeFileSync(rawPath, glb);
  console.log('Wrote', rawPath, 'bytes', glb.length);
  console.log('Spawn', spawn);
  console.log('Landmarks', Object.keys(placements).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
