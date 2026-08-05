import { defineSystem, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { pick } from '@forgeax/engine-picking';
import { Transform } from '@forgeax/engine-scene';
import type { InputSnapshot } from '@forgeax/engine-input';
import type { HudHandle, ViewMode } from './hud';

export type GameplayInputState = {
  lookYaw: number;
  lookPitch: number;
  wantShoot: boolean;
  shotDir: { x: number; z: number } | null;
};

export type GameplayInputContext = {
  world: World;
  camera: EntityHandle;
  canvas: HTMLCanvasElement;
  hud: HudHandle;
  readInput: () => InputSnapshot;
  getMode: () => ViewMode;
  getPlayerPosition: () => { x: number; z: number };
  setFacing: (x: number, z: number) => void;
};

const LOOK_SENS = 0.0022;

/** Install the input-to-intent systems shared by all three camera views. */
export function installGameplayInput(ctx: GameplayInputContext): GameplayInputState {
  const state: GameplayInputState = {
    lookYaw: 0,
    lookPitch: 0,
    wantShoot: false,
    shotDir: null,
  };
  const clampPitch = (pitch: number) => Math.max(-1.2, Math.min(1.2, pitch));

  const gameLook = defineSystem({
    name: 'game-look',
    queries: [] as const,
    after: ['input-frame-start-scan'],
    fn: () => {
      const snap = ctx.readInput();
      const mode = ctx.getMode();
      if ((mode !== 'fps' && mode !== 'orbit') || !snap.mouse.pointerLocked) {
        if (mode === 'fps' || mode === 'orbit') {
          ctx.hud.setLockStatus(snap.mouse.pointerLocked
            ? '🎮 Locked · mouse look · ESC releases'
            : '👍 Click canvas to lock mouse');
        }
        return;
      }
      state.lookYaw -= snap.mouse.movementDelta.x * LOOK_SENS;
      state.lookPitch = clampPitch(state.lookPitch - snap.mouse.movementDelta.y * LOOK_SENS);
      ctx.hud.setLockStatus('🎮 Locked · mouse look · ESC releases');
    },
  });
  ctx.world.addSystem(Update, gameLook);

  const gamePickShoot = defineSystem({
    name: 'game-pick-shoot',
    queries: [] as const,
    after: ['input-frame-start-scan'],
    fn: () => {
      const snap = ctx.readInput();
      for (const ev of snap.pointerEvents) {
        if (ev.phase !== 'down' || ev.pointerType !== 'mouse') continue;
        if (ctx.getMode() === 'fps' || (ctx.getMode() === 'orbit' && snap.mouse.pointerLocked)) {
          if (snap.mouse.pointerLocked) state.wantShoot = true;
          continue;
        }
        const player = ctx.getPlayerPosition();
        const hit = pick(ctx.world, ctx.camera, ev.x, ev.y, ctx.canvas.width, ctx.canvas.height);
        let aimX: number, aimZ: number;
        if (hit) {
          const tr = ctx.world.get(hit.entity, Transform);
          if (tr.ok) {
            aimX = tr.value.pos[0] ?? 0;
            aimZ = tr.value.pos[2] ?? 0;
          } else {
            aimX = player.x + (ev.x - ctx.canvas.width / 2);
            aimZ = player.z + (ev.y - ctx.canvas.height / 2);
          }
        } else {
          aimX = player.x + (ev.x - ctx.canvas.width / 2);
          aimZ = player.z + (ev.y - ctx.canvas.height / 2);
        }
        let dx = aimX - player.x, dz = aimZ - player.z;
        let len = Math.hypot(dx, dz);
        // Picking can legitimately hit the player at the screen centre. That
        // is not an aim target; fall back to the pointer ray so a click near
        // the avatar still produces a shot instead of being discarded as a
        // zero-length direction.
        if (len <= 1e-3) {
          dx = ev.x - ctx.canvas.width / 2;
          dz = ev.y - ctx.canvas.height / 2;
          len = Math.hypot(dx, dz);
        }
        if (len <= 1e-3) continue;
        const nx = dx / len, nz = dz / len;
        state.shotDir = { x: nx, z: nz };
        ctx.setFacing(nx, nz);
        state.wantShoot = true;
      }
    },
  });
  ctx.world.addSystem(Update, gamePickShoot);
  return state;
}
