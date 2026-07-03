# forgeax-engine API cheatsheet (for the MarsCraft port)

> Captured facts so every cron tick / subagent stops re-deriving the API.
> Verified against `packages/build/engine-src/node_modules/@forgeax/engine-runtime`
> and working games (spin-cube, cow-survivor). If something here is wrong, fix it here.

## Game entry contract
- `forge.json` → `{ id, name, schemaVersion, entry: "main.ts", physics: "3d" }`.
- `main.ts` exports `async function bootstrap(world: World, ctx?: BootstrapContext)`.
  The preview host (`:15173/preview/?game=<slug>`) creates renderer+world, drives
  the frame loop, and calls `bootstrap`. We only spawn entities + `world.addSystem`.
- Host exposes `window.__forgeax = { app, world, renderer }`. Smoke checks:
  `world.inspect().entityCount`, VAG_FPS_STATS postMessage (fps>0).
- A new game needs a symlink `.forgeax/games/<slug> -> packages/games/<slug>` AND
  the vite dev server re-scans (auto-restart ~10s) so its pack-index resolves.
  Create it: `ln -sf <abs path to packages/games/slug> .forgeax/games/<slug>`.

## Imports
```ts
import {
  Transform, Camera, perspective, quat,
  Skylight, DirectionalLight, PointLight,
  MeshFilter, MeshRenderer,
  createBoxGeometry, createPlaneGeometry, createCylinderGeometry,
  createConeGeometry, createSphereGeometry, createTorusGeometry,
  meshFromInterleaved,
  HANDLE_CUBE, HANDLE_SPHERE, HANDLE_QUAD,
  type Handle, type MaterialAsset, type MeshAsset, type AssetRegistry,
} from '@forgeax/engine-runtime';
// `Entity` is a VALUE (used in query `with: [Entity, Transform]` and as `b.Entity.self[i]`).
// The entity-id TYPE is `EntityHandle` (NOT `type Entity` — that fails: Entity is value-space).
import { defineComponent, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { BootstrapContext } from '@forgeax/engine-app';
import { Collider, RigidBody } from '@forgeax/engine-physics'; // when needed
```

## ECS
- Component: `const C = defineComponent('Name', { fieldA: 'f32', fieldB: 'bool', ... })`.
  Field types: `'f32' | 'i32' | 'u32' | 'bool'` (and `{ type:'f32', default: N }`).
  Components are **SoA**: in a system, `q.C.fieldA` is a typed array indexed `[i]`.
  No string/object fields — keep side data (names, JS objects) in a parallel `Map<Entity, …>`.
- ⚠️ **CRITICAL: query batch keys are the registered `defineComponent` NAME**, e.g. a query
  over `Faction` yields `batch.Faction.playerId[i]`. Our `src/components.ts` registers each
  component with name == export alias (NO prefix), so `batch.Faction` works. A mismatch
  (e.g. registering `'McFaction'` but writing `batch.Faction`) makes `batch.Faction` undefined
  → the system fn THROWS every frame, **silently swallowed by the engine error handler** (no
  console error), so the system just does nothing. This cost an M4 debugging session — never
  prefix component names, always access batches by the exact registered name.
- Spawn: `const e = world.spawn({ component: Transform, data:{...} }, { component: ... }).unwrap()`.
- Get/set: `world.get(e, C)`, `world.set(e, C, { field: v })`. Despawn: `world.despawn(e)`.
- Shared-ref handle (materials/meshes/scenes): `world.allocSharedRef('MaterialAsset', pod)` → `Handle`.
- System:
  ```ts
  world.addSystem({
    name: 'movement',
    queries: [{ with: [Entity, Transform, Movement] }],
    resources: ['Time'],
    fn: (_w, qr) => {
      const dt = world.getResource<{ dt:number }>('Time').dt;
      // ⚠️ qr[0] is an ARRAY OF BATCHES (one per matching archetype), NOT one batch.
      // ALWAYS iterate it. Treating qr[0] as a single batch (`qr[0].Entity`) gives
      // undefined → silent per-frame throw (engine swallows it) → system does nothing.
      for (const b of qr[0]) {
        const n = b.Entity.self.length;
        for (let i=0;i<n;i++){ /* b.Transform.posX[i], b.Entity.self[i] ... */ }
      }
    },
  });
  ```
  `b.Entity.self[i]` is the Entity handle for row i. `qr[0]`/`qr[1]`… are per-QUERY;
  each is itself a **list of batches** (one per archetype). Writing `b.Transform.posX[i]=v`
  to a batch column persists (it's the live archetype storage). For once-per-frame work
  (timers, cache invalidation), do it before the batch loop — not inside it.

## Transforms / camera
- `Transform` fields: posX/Y/Z, quatX/Y/Z/W, scaleX/Y/Z. Default camera looks down -Z.
- Camera: `{ ...perspective({ fov, aspect, near, far }), clearR, clearG, clearB }`.
- Quaternion helpers: `quat.create()`, `quat.fromAxisAngle(out,[x,y,z],rad)`, `quat.multiply(out,a,b)`.
- RTS camera vantage (works): posY≈34, posZ≈26, pitch quat = fromAxisAngle X by ≈ -0.92 rad.

## Lighting (REQUIRED or PBR renders black)
- `Skylight` cubemap-less: `{ colorR,colorG,colorB, intensity }` → flat ambient first frame,
  works on WebKit/WKWebView. Always spawn one.
- `DirectionalLight`: `{ directionX,Y,Z, colorR,G,B, intensity, castShadow }`.
  Set `castShadow:false` unless you've wired shadow config (avoids WebKit issues for now).

## Materials
- Base material lives in `assets/base-material.pack.json` (catalogued by GUID).
  PBR: `forgeax::default-standard-pbr` (lit). Unlit: `forgeax::default-unlit`.
- Tinted child at runtime:
  ```ts
  const m = world.allocSharedRef('MaterialAsset', {
    kind:'material', parent: baseGuid,
    paramValues: { baseColor:[r,g,b,1], metallic:0, roughness:0.85 },
  });
  ```
  Use `m` in `MeshRenderer { materials: [m] }` (NOTE: plural `materials` array).
- Load base once in bootstrap: `AssetGuid.parse(GUID)` → `await assets.loadByGuid<MaterialAsset>(guid)`.

## Custom geometry (terrain, unit models)
- Procedural primitives: `createBoxGeometry(w,h,d,ws?,hs?,ds?)` → `Result<MeshAsset>`; unwrap `.value`.
  `createPlaneGeometry(w,h,ws,hs)` is **XY-facing** → rotate -90° about X to lie on XZ ground.
- Arbitrary mesh: build interleaved Float32Array, **8 floats/vertex** = pos(3)+normal(3)+uv(2),
  plus `Uint32Array`/`Uint16Array` indices, then `meshFromInterleaved(verts, indices)` → MeshAsset.
  Register: `const h = world.allocSharedRef('MeshAsset', mesh)`; use in `MeshFilter { assetHandle: h }`.
- Composite unit models: spawn multiple child meshes parented via `ChildOf` (import from runtime),
  or bake one mesh by concatenating sub-geometries into one interleaved buffer.

## DOM input (RTS camera/selection)
- The game runs in the preview page; `document`/`window` are available. Read the canvas
  `#app`. Add listeners (pointerdown/move/up, wheel, keydown) writing into a plain input
  state object; an ECS system reads it each frame. Remember to scale clientX/Y by canvas rect.
- Picking ground point: ray from camera through cursor → intersect Y=0 plane (do the math in JS,
  no engine picking dependency needed for movement orders).

## Verify (every milestone)
- Stack up? `curl -s -o /dev/null -w '%{http_code}' http://localhost:15173/preview/` → 200.
  If not: `nohup bun fx start > /tmp/fx.log 2>&1 &` from repo root; wait for :15173.
- Playwright (Chromium): goto `:15173/preview/?game=marscraft`, wait ~6s,
  assert console has no errors except favicon 404, `window.__forgeax.world.inspect().entityCount` sane.
- Screenshot: `browser_take_screenshot` then Read the file (it lands at repo-root `<name>.jpeg`).

## Gotchas
- ⚠️ **Never `world.spawn`/`world.despawn` inside a query-iteration `fn`.** Mutating the
  world mid-iteration silently corrupts the batches (the system throws, the engine swallows
  it). Pattern: COLLECT the work during the loop (push to a local array, capturing any batch
  values you'll need since the batch is stale afterward), then spawn/despawn AFTER the loop.
  (Bit both M5 movement-cleanup and M8 unit-production.)
- `world.isAlive` does NOT exist on World — to test liveness use `world.get(e, SomeComp).ok`.
- `MeshRenderer` uses `materials: [handle]` (plural array), not `material`.
- `meshFromInterleaved` AABB is derived from positions — fine for cull/pick.
- Don't `pkill`; don't restart the web stack repeatedly. After cross-cutting edits,
  a stale vite can serve old deps — if "Failed to resolve import X" appears for code that
  exists, the dev server may need a clean restart (`bash scripts/stop.sh --force` then start).
- Engine is read-only (ubpa main). Engine bug → append ENGINE-ISSUES-for-ubpa.md, do NOT patch.
