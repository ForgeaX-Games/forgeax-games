// One-shot generator for fps's authored scene.json (the SSOT static arena).
//
//   bun run packages/games/fps/tools/gen-scene.ts
//
// It is a faithful PORT of the arena that used to be hard-coded in main.ts's
// start(): the exact same coordinates, scales, materials and collision shapes —
// only it emits a @forgeax/scene SceneDocument instead of spawning into a world.
// After this seeds scene.json, that file is the SSOT: the editor (✎ Edit) owns
// it and main.ts (▶ Play) instantiates it. Re-run only to regenerate from scratch
// (it OVERWRITES scene.json, discarding editor changes) — normally you edit in
// the editor, not here.
//
// HDR convention (matches @forgeax/scene + the PBR/light shaders, which compute
// emissive×emissiveIntensity and premultiply lightColor×intensity): emissive and
// light colors are stored as a NORMALIZED hue hex + a magnitude in
// emissiveIntensity / light.intensity, so >1 channels round-trip losslessly while
// staying editable with an ordinary color picker.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Vec3 = [number, number, number];
interface MaterialData {
  albedo: string; roughness: number; metallic: number;
  emissive?: string; emissiveIntensity?: number; shading: 'standard' | 'unlit';
}
interface Collider { shape: 'box' | 'cylinder'; radius?: number }
type Components = Record<string, unknown>;

// ── doc builder ───────────────────────────────────────────────────────────────
let nextId = 1;
const entities: Record<number, { id: number; name: string; parent: number | null; components: Components }> = {};
const order: number[] = [];
function add(name: string, parent: number | null, components: Components): number {
  const id = nextId++;
  entities[id] = { id, name, parent, components };
  order.push(id);
  return id;
}
const group = (name: string, parent: number | null = null): number => add(name, parent, {});

// ── color / material helpers (port of main.ts `std`) ───────────────────────────
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const h2 = (v: number): string => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
const rgbToHex = ([r, g, b]: Vec3): string => `#${h2(r)}${h2(g)}${h2(b)}`;
/** normalized-hue hex + HDR magnitude (max channel). */
function hdr([r, g, b]: Vec3): { hex: string; mag: number } {
  const mag = Math.max(r, g, b);
  if (mag <= 0) return { hex: '#000000', mag: 0 };
  return { hex: rgbToHex([r / mag, g / mag, b / mag]), mag };
}
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
function std(rgb: Vec3, rough = 0.6, metal = 0, emis?: Vec3, ei = 1): MaterialData {
  const m: MaterialData = { albedo: rgbToHex(rgb), roughness: rough, metallic: metal, shading: 'standard' };
  if (emis) { const e = hdr(emis); m.emissive = e.hex; m.emissiveIntensity = r4(e.mag * ei); }
  return m;
}

// ── geometry emitters (port of main.ts `box` / `spawnMesh`) ────────────────────
function box(parent: number, name: string, mat: MaterialData, px: number, py: number, pz: number, sx: number, sy: number, sz: number, collider?: Collider): number {
  const components: Components = {
    Transform: { x: r4(px), y: r4(py), z: r4(pz), scaleX: r4(sx), scaleY: r4(sy), scaleZ: r4(sz) },
    Mesh: { kind: 'cube' },
    Material: mat,
  };
  if (collider) components.Collider = collider;
  return add(name, parent, components);
}
function meshE(parent: number, name: string, kind: 'sphere' | 'cylinder', mat: MaterialData, px: number, py: number, pz: number, sx: number, sy: number, sz: number, collider?: Collider): number {
  const components: Components = {
    Transform: { x: r4(px), y: r4(py), z: r4(pz), scaleX: r4(sx), scaleY: r4(sy), scaleZ: r4(sz) },
    Mesh: { kind },
    Material: mat,
  };
  if (collider) components.Collider = collider;
  return add(name, parent, components);
}

// ── materials (verbatim from main.ts) ──────────────────────────────────────────
const matFloor = std([0.07, 0.08, 0.10], 0.95);
const matFloorTrim = std([0.11, 0.12, 0.15], 0.8, 0.2);
const matWall = std([0.14, 0.15, 0.18], 0.85, 0.1);
const matWallTrim = std([0.20, 0.21, 0.25], 0.55, 0.4);
const matCrate = std([0.42, 0.30, 0.14], 0.7);
const matBarrel = std([0.30, 0.34, 0.20], 0.5, 0.6);
const matPillar = std([0.18, 0.19, 0.23], 0.55, 0.35);
const matNeonBlue = std([0.1, 0.4, 0.9], 0.4, 0, [0.1, 0.55, 1.4], 1);
const matNeonAmber = std([0.9, 0.55, 0.1], 0.4, 0, [1.5, 0.7, 0.1], 1);
const matConcrete = std([0.16, 0.17, 0.20], 0.92, 0.05);
const matMetalWall = std([0.22, 0.24, 0.29], 0.5, 0.55);
const matRoof = std([0.10, 0.11, 0.14], 0.7, 0.3);
const matWindow = std([0.2, 0.45, 0.7], 0.3, 0.1, [0.35, 0.8, 1.6], 1);
const matWindowAmber = std([0.7, 0.5, 0.2], 0.3, 0.1, [1.6, 0.9, 0.25], 1);
const matDoorTrim = std([0.6, 0.45, 0.1], 0.4, 0.3, [1.2, 0.7, 0.1], 1);

// ════════════════════════════════════════════════════════════════════════════
//  ARENA — same sequence as main.ts L113-247
// ════════════════════════════════════════════════════════════════════════════
const HALF = 24;
const root = group('Arena');

// ── floor ──
const gFloor = group('Floor', root);
box(gFloor, 'Floor', matFloor, 0, -0.1, 0, HALF * 2, 0.2, HALF * 2);
for (let i = -2; i <= 2; i++) {
  box(gFloor, `FloorTrim X${i}`, matFloorTrim, i * 9, 0.01, 0, 0.25, 0.04, HALF * 2 - 2);
  box(gFloor, `FloorTrim Z${i}`, matFloorTrim, 0, 0.01, i * 9, HALF * 2 - 2, 0.04, 0.25);
}

// ── neon strips ──
const gNeon = group('Neon', root);
box(gNeon, 'Neon N', matNeonBlue, 0, 2.7, HALF - 0.35, HALF * 2 - 2, 0.12, 0.08);
box(gNeon, 'Neon S', matNeonBlue, 0, 2.7, -HALF + 0.35, HALF * 2 - 2, 0.12, 0.08);
box(gNeon, 'Neon E', matNeonAmber, HALF - 0.35, 2.7, 0, 0.08, 0.12, HALF * 2 - 2);
box(gNeon, 'Neon W', matNeonAmber, -HALF + 0.35, 2.7, 0, 0.08, 0.12, HALF * 2 - 2);

// ── perimeter walls (NO collider — player is clamped to BOUND in code) ──
const gWalls = group('Walls', root);
box(gWalls, 'Wall N', matWall, 0, 1.6, HALF, HALF * 2, 3.4, 0.6);
box(gWalls, 'Wall S', matWall, 0, 1.6, -HALF, HALF * 2, 3.4, 0.6);
box(gWalls, 'Wall E', matWall, HALF, 1.6, 0, 0.6, 3.4, HALF * 2);
box(gWalls, 'Wall W', matWall, -HALF, 1.6, 0, 0.6, 3.4, HALF * 2);
box(gWalls, 'WallTrim N', matWallTrim, 0, 3.35, HALF, HALF * 2, 0.3, 0.7);
box(gWalls, 'WallTrim S', matWallTrim, 0, 3.35, -HALF, HALF * 2, 0.3, 0.7);
box(gWalls, 'WallTrim E', matWallTrim, HALF, 3.35, 0, 0.7, 0.3, HALF * 2);
box(gWalls, 'WallTrim W', matWallTrim, -HALF, 3.35, 0, 0.7, 0.3, HALF * 2);

// ── cover props (crate/barrel/pillar → cylinder colliders) ──
const gCover = group('Cover', root);
let nCrate = 0, nBarrel = 0, nPillar = 0;
const crate = (x: number, z: number, s = 1.7): void => {
  box(gCover, `Crate ${++nCrate}`, matCrate, x, s / 2, z, s, s, s, { shape: 'cylinder', radius: r4(s * 0.72) });
};
const barrel = (x: number, z: number): void => {
  const g = group(`Barrel ${++nBarrel}`, gCover);
  meshE(g, 'body', 'cylinder', matBarrel, x, 0.6, z, 1.0, 1.2, 1.0, { shape: 'cylinder', radius: 0.62 });
  meshE(g, 'cap', 'sphere', matBarrel, x, 1.18, z, 0.5, 0.18, 0.5);
};
const pillar = (x: number, z: number): void => {
  const g = group(`Pillar ${++nPillar}`, gCover);
  box(g, 'shaft', matPillar, x, 1.7, z, 1.2, 3.4, 1.2, { shape: 'cylinder', radius: 0.92 });
  box(g, 'cap', matWallTrim, x, 3.45, z, 1.4, 0.25, 1.4);
};
crate(-6, -5); crate(-4.4, -6.4, 1.3); crate(7, 4); crate(8.4, 5.3, 1.2);
crate(-9, 8); crate(10, -9); crate(2.5, 12); crate(-13, -3, 2.1);
barrel(-5.2, -3.6); barrel(8.6, 3.0); barrel(3, 13.2); barrel(-11.2, -4.3); barrel(11.5, -7.4);
pillar(0, 0); pillar(-14, 13); pillar(14, -13); pillar(15, 14); pillar(-15, -14);

// ── buildings ──
const gBuild = group('Buildings', root);
type Side = 'n' | 's' | 'e' | 'w';
// wallSeg: a solid wall box that is ALSO a box collider (half-extents from scale).
const wallSeg = (parent: number, name: string, cx: number, cz: number, sx: number, sz: number, h: number, m: MaterialData): void => {
  box(parent, name, m, cx, h / 2, cz, sx, h, sz, { shape: 'box' });
};
let nBuilding = 0;
const building = (cx: number, cz: number, w: number, d: number, h: number, door: Side, wallMat: MaterialData, winMat: MaterialData): void => {
  const g = group(`Building ${++nBuilding}`, gBuild);
  const t = 0.5, doorW = 2.4, hw = w / 2, hd = d / 2;
  const wallX = (z: number, hasDoor: boolean, tag: string): void => {
    if (!hasDoor) { wallSeg(g, `wall ${tag}`, cx, z, w, t, h, wallMat); return; }
    const side = (w - doorW) / 2;
    wallSeg(g, `wall ${tag} L`, cx - (doorW / 2 + side / 2), z, side, t, h, wallMat);
    wallSeg(g, `wall ${tag} R`, cx + (doorW / 2 + side / 2), z, side, t, h, wallMat);
    box(g, `doorTrim ${tag}`, matDoorTrim, cx, h - 0.25, z, doorW, 0.3, t * 1.05);
  };
  const wallZ = (x: number, hasDoor: boolean, tag: string): void => {
    if (!hasDoor) { wallSeg(g, `wall ${tag}`, x, cz, t, d, h, wallMat); return; }
    const side = (d - doorW) / 2;
    wallSeg(g, `wall ${tag} L`, x, cz - (doorW / 2 + side / 2), t, side, h, wallMat);
    wallSeg(g, `wall ${tag} R`, x, cz + (doorW / 2 + side / 2), t, side, h, wallMat);
    box(g, `doorTrim ${tag}`, matDoorTrim, x, h - 0.25, cz, t * 1.05, 0.3, doorW);
  };
  wallX(cz + hd, door === 'n', 'N');
  wallX(cz - hd, door === 's', 'S');
  wallZ(cx + hw, door === 'e', 'E');
  wallZ(cx - hw, door === 'w', 'W');
  box(g, 'window N', winMat, cx, h * 0.6, cz + hd + 0.02, w * 0.66, 0.55, 0.05);
  box(g, 'window S', winMat, cx, h * 0.6, cz - hd - 0.02, w * 0.66, 0.55, 0.05);
  box(g, 'roof', matRoof, cx, h + 0.12, cz, w + 0.3, 0.24, d + 0.3);
  box(g, 'parapet N', matMetalWall, cx, h + 0.42, cz + hd, w + 0.3, 0.4, 0.18);
  box(g, 'parapet S', matMetalWall, cx, h + 0.42, cz - hd, w + 0.3, 0.4, 0.18);
  box(g, 'parapet E', matMetalWall, cx + hw, h + 0.42, cz, 0.18, 0.4, d + 0.3);
  box(g, 'parapet W', matMetalWall, cx - hw, h + 0.42, cz, 0.18, 0.4, d + 0.3);
};
let nTower = 0;
const tower = (cx: number, cz: number): void => {
  const g = group(`Tower ${++nTower}`, gBuild);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, `leg ${sx},${sz}`, matMetalWall, cx + sx, 2.4, cz + sz, 0.3, 4.8, 0.3);
  // center box collider (hw=hd=1.3) — invisible, matches main.ts walls.push.
  add('collider', g, { Transform: { x: cx, y: 0, z: cz, scaleX: 2.6, scaleY: 1, scaleZ: 2.6 }, Collider: { shape: 'box' } });
  box(g, 'roof', matRoof, cx, 4.9, cz, 3.0, 0.3, 3.0);
  box(g, 'rail N', matMetalWall, cx, 5.45, cz + 1.4, 3.0, 0.9, 0.14);
  box(g, 'rail S', matMetalWall, cx, 5.45, cz - 1.4, 3.0, 0.9, 0.14);
  box(g, 'beacon', matWindowAmber, cx, 5.95, cz, 0.55, 0.55, 0.55);
};
building(-14, -12, 9, 7, 3.3, 'n', matConcrete, matWindow);
building(15, 9, 8, 8, 3.4, 's', matMetalWall, matWindowAmber);
building(-3, -16, 7, 5, 3.0, 'n', matConcrete, matWindow);
tower(17, -4);
// freestanding barricades for mid-map cover
wallSeg(gBuild, 'Barricade 1', -7, 5, 5.5, 0.5, 2.0, matConcrete);
wallSeg(gBuild, 'Barricade 2', 7, -6, 0.5, 5.5, 2.0, matConcrete);

// ── lighting (static: directional + colored accents; flashlight/muzzle stay in code) ──
const gLights = group('Lights', root);
{
  // DirectionalLight { dir(-0.4,-1,-0.3), color(0.45,0.52,0.72), intensity 1.0 }
  const e = hdr([0.45, 0.52, 0.72]);
  add('Sun', gLights, { Light: { type: 'directional', color: e.hex, intensity: r4(e.mag * 1.0), directionX: -0.4, directionY: -1, directionZ: -0.3 } });
}
const accent = (name: string, x: number, z: number, c: Vec3): void => {
  const e = hdr(c);
  add(name, gLights, { Transform: { x, y: 2.6, z }, Light: { type: 'point', color: e.hex, intensity: r4(e.mag * 10), range: 13 } });
};
accent('Accent NW', -14, 13, [0.2, 0.5, 1.4]);
accent('Accent SE', 14, -13, [1.4, 0.55, 0.15]);
accent('Accent NE', 15, 14, [0.3, 1.2, 0.7]);
accent('Accent SW', -15, -14, [1.3, 0.2, 0.3]);

// ── write ──
const doc = { version: '1', nextId, entities, order };
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'scene.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`[gen-scene] wrote ${out} — ${order.length} entities`);
