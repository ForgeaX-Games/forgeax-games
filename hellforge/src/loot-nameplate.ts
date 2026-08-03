// Hellforge world drop nameplates (G3) — DOM name tag floating above the 3D
// equipment placard. Pure information overlay: the placard mesh + rarity beam
// (loot-placard / fx.ts) are untouched, and pickup logic stays in LootSystem.
// Per-frame sync against a drop snapshot; Alt holds all tags on (own key
// listener — key-bindings.ts owns no 'alt' action, so nothing conflicts).

import { RARITY_META, type ItemInstance } from './items';
import { FONT_UI, Z } from './ui-theme';

/** One equipment drop as seen by the nameplate layer (loot.itemDropSnapshot). */
export interface NameplateDrop {
  id: string;
  x: number;
  y: number;
  z: number;
  item: ItemInstance;
}

export interface LootNameplateOptions {
  /** World → canvas-local screen projection (main.ts worldToScreen). */
  worldToScreen: (wx: number, wy: number, wz: number) => { x: number; y: number } | null;
  /** Default display time before the fade (ms). */
  holdMs?: number;
  /** Fade-out duration (ms). */
  fadeMs?: number;
  /** World-space height above the drop anchor the tag hovers at. */
  rise?: number;
  /** Local element that owns the game's keyboard focus (canvas in the host). */
  inputTarget?: HTMLElement;
}

export interface LootNameplateHandle {
  /**
   * Per-frame sync: spawn new tags, remove vanished drops, project, age.
   * Drops that disappear (picked up / despawned / ground cleared) are removed
   * on the same frame; a null or out-of-viewport projection hides the tag and
   * holds its countdown — a tag that finishes fading (on- or off-screen) is
   * spent, so a drop re-entering view only restores a tag that never faded
   * out. The one way back from spent is Alt (P3-b): a press resurrects every
   * drop still in the snapshot at full duration.
   */
  tick(dt: number, drops: readonly NameplateDrop[]): void;
  dispose(): void;
}

const ROOT_ID = 'hellforge-loot-nameplates';
const STYLE_ID = 'hellforge-loot-nameplates-style';
const DEFAULT_HOLD_MS = 3000;
const DEFAULT_FADE_MS = 400;
const DEFAULT_RISE = 0.62;
/**
 * P3-a: the root clips with overflow:hidden, so a tag whose anchor projects
 * outside the viewport — still in front of the camera (worldToScreen returned
 * a point) — is invisible to the player yet keeps aging. Treat it like a null
 * projection: hidden + countdown frozen. The margin ≈ the tag's half-extent
 * (anchor sits at its base, translate(-50%,-100%)); inside the margin the tag
 * is still partly visible, so only well-beyond-edge anchors freeze.
 */
const VIEWPORT_MARGIN = 100;

function inViewport(p: { x: number; y: number }, vw: number, vh: number): boolean {
  // Degenerate/unmeasured viewport (0×0, undefined, NaN) — never freeze on a bad read.
  if (!(vw > 0) || !(vh > 0)) return true;
  return p.x >= -VIEWPORT_MARGIN && p.x <= vw + VIEWPORT_MARGIN && p.y >= -VIEWPORT_MARGIN && p.y <= vh + VIEWPORT_MARGIN;
}

interface Plate {
  el: HTMLDivElement;
  /** Remaining display time in ms — frozen while Alt holds the tags on. */
  holdRemainingMs: number;
  fading: boolean;
  fadeTimer: ReturnType<typeof setTimeout> | undefined;
}

export function installLootNameplates(
  mount: HTMLElement,
  opts: LootNameplateOptions,
): LootNameplateHandle {
  const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
  const fadeMs = opts.fadeMs ?? DEFAULT_FADE_MS;
  const rise = opts.rise ?? DEFAULT_RISE;
  const { worldToScreen } = opts;
  const inputTarget = opts.inputTarget ?? mount;

  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes hf-nameplate-fadeout {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText =
    `position:absolute;inset:0;z-index:${Z.nameplate};pointer-events:none;overflow:hidden;`;
  mount.appendChild(root);

  const plates = new Map<string, Plate>();

  // Ids whose tag has completed its fade. Equipment drops never rot away
  // (loot.ts keeps them until pickup), so without this a faded tag would be
  // re-spawned at full duration on the next tick — an infinite
  // show-3s → fade → pop-back loop. An id stays here until the drop leaves
  // the snapshot (entry dropped, so a reused id starts fresh and memory stays
  // bounded by the live drop count), or until Alt is pressed — P3-b clears
  // the ledger to resurrect every drop still in the snapshot. Without Alt,
  // the ledger keeps blocking respawns (B1 anti-flicker semantics intact).
  const expired = new Set<string>();

  const removePlate = (id: string): void => {
    const p = plates.get(id);
    if (!p) return;
    if (p.fadeTimer !== undefined) clearTimeout(p.fadeTimer);
    p.el.remove();
    plates.delete(id);
  };

  const startFade = (p: Plate, id: string): void => {
    p.fading = true;
    p.el.style.animation = `hf-nameplate-fadeout ${fadeMs}ms ease-out forwards`;
    p.fadeTimer = setTimeout(() => {
      // Fade completed — the tag is spent for this drop appearance.
      expired.add(id);
      removePlate(id);
    }, fadeMs);
  };

  const spawn = (drop: NameplateDrop): Plate => {
    const meta = RARITY_META[drop.item.rarity];
    const el = document.createElement('div');
    el.textContent = drop.item.name;
    // Multi-layer text-shadow outline (project convention) + a soft rarity
    // glow — readable over any ground at 1080p.
    el.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;' +
      `font:800 20px ${FONT_UI};letter-spacing:1px;color:${meta.color};` +
      'text-shadow:0 1px 0 #000,1px 0 0 #000,0 -1px 0 #000,-1px 0 0 #000,' +
      `0 2px 4px rgba(0,0,0,0.9),0 0 10px ${meta.color}80;`;
    root.appendChild(el);
    const plate: Plate = { el, holdRemainingMs: holdMs, fading: false, fadeTimer: undefined };
    plates.set(drop.id, plate);
    return plate;
  };

  // ── Alt hold-to-inspect (P3-b): freeze countdowns while held, cancel
  // in-flight fades (tags pop back to full opacity), AND resurrect tags that
  // already finished fading — the expired ledger is cleared on press, so the
  // next tick re-spawns every drop still in the snapshot at full hold.
  // Release resumes the remaining time; the resurrected tags then age and
  // expire again through the normal path. Without a press, no auto-respawn.
  let altHeld = false;
  const setAltHeld = (held: boolean): void => {
    altHeld = held;
    if (!held) return;
    // Spent tags come back (D2-style "Alt scans all ground loot"); entries
    // for drops that left the snapshot were already cleaned by tick, so the
    // cleared ledger cannot grow beyond the live drop count.
    expired.clear();
    for (const p of plates.values()) {
      if (p.fading) {
        if (p.fadeTimer !== undefined) clearTimeout(p.fadeTimer);
        p.fadeTimer = undefined;
        p.fading = false;
        p.el.style.animation = 'none';
      }
    }
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') setAltHeld(true);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') setAltHeld(false);
  };
  // Keyup is lost when the input target loses focus mid-hold — don't stick in hold.
  const onWindowBlur = (): void => setAltHeld(false);
  inputTarget.addEventListener('keydown', onKeyDown);
  inputTarget.addEventListener('keyup', onKeyUp);
  inputTarget.addEventListener('blur', onWindowBlur);

  const tick = (dt: number, drops: readonly NameplateDrop[]): void => {
    // P3-a: viewport = window (the canvas fills it; worldToScreen projects
    // into canvas-client pixels). Read per tick so resizes track for free.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const seen = new Set<string>();
    for (const drop of drops) {
      seen.add(drop.id);
      // Faded once → not re-spawned while the same drop stays in the
      // snapshot; the fade is a one-way door per drop appearance — the only
      // exception is Alt reviving the ledger (P3-b, see setAltHeld).
      if (expired.has(drop.id)) continue;
      const p = plates.get(drop.id) ?? spawn(drop);
      const s = worldToScreen(drop.x, drop.y + rise, drop.z);
      if (s === null || !inViewport(s, vw, vh)) {
        // Behind the camera, or projected outside the viewport where the
        // root's overflow:hidden clips the tag — hidden, and the countdown
        // holds until the drop re-enters view (the decrement below only runs
        // when visible). A fade already in flight still completes up here,
        // and that expiry is final: re-entering view does not conjure a
        // fresh tag, only an unexpired one resumes display.
        p.el.style.display = 'none';
        continue;
      }
      p.el.style.display = '';
      p.el.style.left = `${s.x}px`;
      p.el.style.top = `${s.y}px`;
      if (!altHeld && !p.fading) {
        p.holdRemainingMs -= dt * 1000;
        if (p.holdRemainingMs <= 0) startFade(p, drop.id);
      }
    }
    // Vanished drops (picked up / despawned) — gone on this frame; their
    // expiry records go with them, so memory stays bounded and a later drop
    // reusing the id gets a fresh tag.
    for (const id of [...plates.keys()]) {
      if (!seen.has(id)) removePlate(id);
    }
    for (const id of [...expired]) {
      if (!seen.has(id)) expired.delete(id);
    }
  };

  return {
    tick,
    dispose() {
      inputTarget.removeEventListener('keydown', onKeyDown);
      inputTarget.removeEventListener('keyup', onKeyUp);
      inputTarget.removeEventListener('blur', onWindowBlur);
      expired.clear();
      for (const id of [...plates.keys()]) removePlate(id);
      root.remove();
      style.remove();
    },
  };
}
