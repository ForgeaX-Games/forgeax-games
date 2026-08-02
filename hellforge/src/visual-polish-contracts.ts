/**
 * Visual-polish shared contracts (F0).
 *
 * Versioned types + pure helpers that N1–D3 must obey. This module does NOT
 * install DOM, play video, or mutate bag state — it freezes the protocol so
 * parallel PRs do not invent conflicting shell / audio / forge / map owners.
 *
 * Contract version: bump when any exported type or invariant changes.
 */

export const VISUAL_POLISH_CONTRACT_VERSION = 'f0.1.0' as const;

/** Frozen games implementation base (owner-authorized batch). */
export const VISUAL_POLISH_IMPLEMENTATION_BASE_SHA =
  '24f38a27cd2e44fae167f70c5732b3a533daad3d' as const;

// ── Shell / intro ──────────────────────────────────────────────────────────

/**
 * Product flow after authorization:
 * click-gate → (optional) intro video → title → charSelect | charList → inGame
 *
 * `intro` is owned by a dedicated intro module (N1), NOT by ShellState today.
 * Shell continues to own title / charSelect / charList / inGame; intro must
 * complete exactly-once before installShell() / title becomes interactive.
 */
export type VisualPolishBootPhase =
  | 'clickGate'
  | 'intro'
  | 'title'
  | 'charSelect'
  | 'charList'
  | 'inGame';

export type IntroTerminalReason = 'ended' | 'skipped' | 'error' | 'missingAsset';

export interface IntroCompletion {
  readonly reason: IntroTerminalReason;
  /** Exactly-once: second completion attempts must be ignored. */
  readonly alreadyCompleted: boolean;
}

/** Pure exactly-once latch for intro / PV completion. */
export function createIntroCompletionLatch(): {
  complete(reason: IntroTerminalReason): IntroCompletion;
  isCompleted(): boolean;
} {
  let done: IntroTerminalReason | null = null;
  return {
    complete(reason) {
      if (done !== null) {
        return { reason: done, alreadyCompleted: true };
      }
      done = reason;
      return { reason, alreadyCompleted: false };
    },
    isCompleted: () => done !== null,
  };
}

// ── Audio arbitration ──────────────────────────────────────────────────────

/**
 * First user gesture may arm BGM *and* start intro video. Only one "primary
 * audible owner" may hold the gesture at a time.
 */
export type AudioPrimaryOwner = 'none' | 'introVideo' | 'bgm' | 'sfx';

export interface AudioArbitrationState {
  readonly primary: AudioPrimaryOwner;
  readonly introDisposed: boolean;
}

export function nextAudioOwner(
  state: AudioArbitrationState,
  event:
    | { type: 'introStart' }
    | { type: 'introDispose' }
    | { type: 'bgmArm' }
    | { type: 'bgmRelease' },
): AudioArbitrationState {
  switch (event.type) {
    case 'introStart':
      return { primary: 'introVideo', introDisposed: false };
    case 'introDispose':
      return {
        primary: state.primary === 'introVideo' ? 'none' : state.primary,
        introDisposed: true,
      };
    case 'bgmArm':
      // BGM may arm under the same gesture, but must stay muted/ducked until
      // intro disposed (N1 wiring). Contract: cannot steal primary from live intro.
      if (state.primary === 'introVideo' && !state.introDisposed) {
        return state;
      }
      return { ...state, primary: 'bgm' };
    case 'bgmRelease':
      return {
        ...state,
        primary: state.primary === 'bgm' ? 'none' : state.primary,
      };
    default:
      return state;
  }
}

// ── UI chrome / pointer ────────────────────────────────────────────────────

/**
 * Extra z-order slots for visual polish. Numeric values must stay between
 * existing theme Z.shell (200) and Z.fatal (260) unless documented otherwise.
 * Minimap is under inventory so panels can cover it; celebration is below
 * dialogue so quest/dialogue still wins.
 */
export const VISUAL_POLISH_Z = {
  minimap: 55,
  /** Above forge cube, below dialogue. */
  lootCelebration: 138,
  introVideo: 205,
} as const;

export type PopupChromeKind =
  | 'lootCelebration'
  | 'forgeReveal'
  | 'levelOrQuestBanner'
  | 'salvageConfirm'
  | 'deleteCharConfirm'
  | 'deathOrSaveError';

/** Root layers that must not steal world input when "non-blocking". */
export type PointerPolicy = 'none' | 'auto' | 'card-only';

export function pointerPolicyFor(kind: PopupChromeKind): PointerPolicy {
  if (kind === 'lootCelebration' || kind === 'forgeReveal' || kind === 'levelOrQuestBanner') {
    return 'card-only';
  }
  return 'auto';
}

// ── Forge reveal ───────────────────────────────────────────────────────────

export type ForgeVisualPhase = 'idle' | 'resolving' | 'reveal';

export type ForgeActionKind = 'salvage' | 'reroll' | 'fuse';

/**
 * Domain settles first; presentation must consume this receipt and MUST NOT
 * re-dispatch domain on reveal. Instant HUD banners/SFX during resolving are
 * forbidden by contract (N2 wiring).
 */
export interface ForgeActionReceipt {
  readonly action: ForgeActionKind;
  readonly ok: boolean;
  readonly phase: ForgeVisualPhase;
  /** Opaque domain snapshot token for tests / save alignment. */
  readonly settlementId: string;
}

export const FORGE_REVEAL_MS_MIN = 1200;
export const FORGE_REVEAL_MS_MAX = 1800;

export function assertForgeRevealDuration(ms: number): boolean {
  return ms >= FORGE_REVEAL_MS_MIN && ms <= FORGE_REVEAL_MS_MAX;
}

export function forgePhaseAfterSettlement(ok: boolean): ForgeVisualPhase {
  return ok ? 'resolving' : 'idle';
}

export function forgePhaseAfterRevealTimer(): ForgeVisualPhase {
  return 'reveal';
}

export function forgePhaseAfterRevealAck(): ForgeVisualPhase {
  return 'idle';
}

// ── Automap / area projection ──────────────────────────────────────────────

export type AreaId = 'camp' | 'wild' | 'den';

/**
 * UI-only snapshot. Automap must not become a second navigation/collision
 * authority — callers supply already-authorized landmarks/exits.
 */
export interface AreaMapSnapshot {
  readonly area: AreaId;
  readonly player: { readonly x: number; readonly z: number };
  readonly exploredDenCells?: ReadonlySet<string>;
  readonly landmarks?: readonly { readonly id: string; readonly x: number; readonly z: number }[];
  readonly questAuthorizedExits?: readonly { readonly id: string; readonly x: number; readonly z: number }[];
}

export interface AutomapUiState {
  readonly minimapVisible: boolean;
  readonly expanded: boolean;
}

export function automapAfterPanelOpen(state: AutomapUiState): AutomapUiState {
  // Opening inventory/forge collapses Tab map but keeps minimap.
  return { minimapVisible: state.minimapVisible, expanded: false };
}

export function automapToggleExpanded(state: AutomapUiState): AutomapUiState {
  return { ...state, expanded: !state.expanded };
}

// ── Assets ─────────────────────────────────────────────────────────────────

export type AssetDisposition = 'awaiting' | 'accepted' | 'fallback' | 'rejected';

export type VisualPolishAssetId =
  | 'A1_introVideo'
  | 'A2_titleBg'
  | 'A3_createCg'
  | 'A4_cursors'
  | 'A5_forgeUi'
  | 'A6_popupChrome'
  | 'A7_paperDoll'
  | 'A8_bossGlb';

export interface AssetGateRecord {
  readonly id: VisualPolishAssetId;
  readonly disposition: AssetDisposition;
  readonly sha256?: string;
}

export function assetAllowsVisualFinish(record: AssetGateRecord): boolean {
  return record.disposition === 'accepted';
}

export function assetAllowsLogicProgress(record: AssetGateRecord): boolean {
  return (
    record.disposition === 'accepted'
    || record.disposition === 'fallback'
    || record.disposition === 'awaiting'
  );
}

// ── Baseline debt ──────────────────────────────────────────────────────────

/**
 * Unit baseline must stay ≥807 pass. Raw `tsc -p hellforge/tsconfig.check.json`
 * may carry pre-existing environment/debt noise; nodes must not add new TS
 * errors on touched production files. Full zero-debt tsc is optional B0b.
 */
export const BASELINE_UNIT_PASS_MIN = 807;

export function unitBaselineAcceptable(pass: number, fail: number): boolean {
  return fail === 0 && pass >= BASELINE_UNIT_PASS_MIN;
}
