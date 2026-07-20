/**
 * MarsCraft -> forgeax-engine — pre-game MainMenu (Milestone M17 chunk C.1)
 * =============================================================================
 * Port of the SINGLEPLAYER setup panel from the Three.js source
 * `web/ui/MainMenu.ts` (1646 LOC), as a DOM overlay over the `#app` canvas — the
 * proven 2D-UI pattern in this port (HUD / minimap / tooltip use it too).
 *
 * ── Flow adaptation vs source ────────────────────────────────────────────────
 *   The source had a real "menu -> start match" phase gate (a Game boot state).
 *   The forgeax `bootstrap()` runs the match IMMEDIATELY, so this port uses a
 *   QUERY-PARAM + reload flow (see main.ts):
 *     • On fresh entry (`?game=marscraft`, no `started`), main.ts still builds the
 *       world (it idles behind the overlay) and shows this MainMenu on top.
 *     • Picking difficulty / player race / AI race / map + "Start Game" sets
 *       `location.search = ?game=marscraft&started=1&map=<id>&race=<r>&airace=<ar>
 *       &difficulty=<d>` and RELOADS. main.ts then reads those params and applies
 *       them; the overlay is not shown (`started=1`).
 *
 * ── Faithful layout ──────────────────────────────────────────────────────────
 *   Title + tagline, AI-difficulty buttons (easy/normal/hard with descriptions),
 *   player-race buttons (terran/zerg/protoss/random + descriptions), AI-race
 *   buttons, a map list from MAP_REGISTRY, and a Start Game button + a live match
 *   preview (matchup + difficulty/map summary). CSS is a condensed adaptation of
 *   the source `mm2-*` sheet (Mars sci-fi palette).
 *
 * ── Seams (present but disabled, NOT faked) ──────────────────────────────────
 *   Multiplayer / (server-backed) Custom Maps / Settings are shown greyed with a
 *   "single-player port — needs a server" note. The forgeax game is client-only
 *   (no server), so these are honest disabled buttons, not stubs. The source's
 *   in-game Map Editor is intentionally NOT ported (M18): maps/levels are edited
 *   in the Studio Edit surface as scene packs (`scenes/*.pack.json`), so no
 *   in-game editor button is offered here.
 *
 * Everything is DOM-guarded: with no `document` (headless) `showMainMenu` returns
 * a no-op handle (never shown) and calls nothing.
 */

import { MAP_REGISTRY } from '../mapgen/map-registry';
import type { RaceType } from '../data/units';
import { t } from '../i18n';
import { resolveUiHost } from './ui-host';

export type MenuRace = RaceType | 'random';
export type MenuDifficulty = 'easy' | 'normal' | 'hard';

/** The resolved singleplayer setup the caller starts a match with. */
export interface MenuStartOptions {
  difficulty: MenuDifficulty;
  race: MenuRace;
  aiRace: MenuRace;
  mapId: string;
}

export interface MainMenuHandle {
  /** True if the DOM overlay was created (document present). */
  active(): boolean;
  /** True if the overlay is currently visible. */
  isVisible(): boolean;
  /** Show the overlay. */
  show(): void;
  /** Hide the overlay (kept in the DOM). */
  hide(): void;
  /** The current in-panel selection (for verify / programmatic start). */
  selection(): MenuStartOptions;
  /**
   * Programmatically apply a selection + invoke Start (for e2e). Missing fields
   * keep the current selection. Fires the onStart callback exactly like a click.
   */
  start(opts?: Partial<MenuStartOptions>): void;
  /** Remove the overlay + listeners. */
  dispose(): void;
}

const RACES: MenuRace[] = ['random', 'terran', 'zerg', 'protoss'];
const DIFFICULTIES: MenuDifficulty[] = ['easy', 'normal', 'hard'];

const DIFF_ICON: Record<MenuDifficulty, string> = { easy: '🟢', normal: '🟡', hard: '🔴' };
const DIFF_COLOR: Record<MenuDifficulty, string> = { easy: '#44cc66', normal: '#ffcc44', hard: '#ff4444' };

const RACE_GLYPH: Record<MenuRace, string> = { random: '?', terran: '◆', zerg: '✦', protoss: '❖' };
const RACE_COLOR: Record<MenuRace, string> = {
  random: '#ccaa88', terran: '#4499ff', zerg: '#cc44ff', protoss: '#ffcc33',
};

const MM_STYLE_ID = 'marscraft-mainmenu-style';
const MM_CSS = `
#marscraft-mainmenu, #marscraft-mainmenu * { box-sizing: border-box; }
#marscraft-mainmenu { position: absolute; inset: 0; z-index: 200; display: none;
  align-items: safe center; justify-content: center; overflow: auto;
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #e8e8ec;
  background:
    radial-gradient(ellipse 120% 40% at 50% 108%, rgba(140,50,15,0.55) 0%, transparent 70%),
    radial-gradient(ellipse 90% 55% at 50% 85%, rgba(160,60,20,0.22) 0%, transparent 72%),
    linear-gradient(to bottom, #08030 2 0%, #150808 55%, #3a1810 100%);
  user-select: none; }
#marscraft-mainmenu.mm-show { display: flex; }
.mm-panel { position: relative; width: min(920px, 94vw); max-height: 100%; overflow-y: auto;
  padding: 22px 26px 26px; background: rgba(16,10,8,0.82); border: 1px solid rgba(255,102,51,0.28);
  border-radius: 14px; box-shadow: 0 12px 48px rgba(0,0,0,0.6); }
.mm-hero { text-align: center; margin-bottom: 18px; }
.mm-logo { font-size: 46px; font-weight: 900; letter-spacing: 6px; color: #ff6633; line-height: 1;
  text-shadow: 0 0 32px rgba(255,102,51,0.4), 0 2px 0 rgba(180,60,20,0.7); }
.mm-tagline { font-size: 12px; letter-spacing: 5px; text-transform: uppercase; color: rgba(255,180,120,0.5);
  font-weight: 600; margin-top: 6px; }
.mm-divider { width: 120px; height: 2px; margin: 12px auto 0;
  background: linear-gradient(90deg, transparent, rgba(255,102,51,0.5), transparent); }
.mm-body { display: flex; gap: 22px; }
.mm-config { flex: 1; min-width: 0; }
.mm-side { width: 300px; flex-shrink: 0; }
.mm-section { margin-bottom: 16px; }
.mm-section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;
  color: rgba(170,136,102,0.75); margin-bottom: 8px; }
.mm-row { display: flex; gap: 8px; flex-wrap: wrap; }
.mm-btn { flex: 1; min-width: 90px; padding: 10px 8px; text-align: center; cursor: pointer;
  background: rgba(30,15,10,0.6); border: 2px solid rgba(255,102,51,0.14); border-radius: 10px;
  color: #e8e8ec; font-family: inherit; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; }
.mm-btn:hover { border-color: rgba(255,102,51,0.45); background: rgba(50,25,15,0.7); }
.mm-btn.mm-selected { border-color: rgba(255,102,51,0.75); background: rgba(70,30,15,0.8);
  box-shadow: 0 0 16px rgba(255,102,51,0.16); }
.mm-diff-icon { font-size: 18px; }
.mm-diff-name { font-size: 14px; font-weight: 700; margin: 3px 0; }
.mm-diff-desc { font-size: 10px; color: #998877; line-height: 1.4; }
.mm-race-glyph { font-size: 22px; font-weight: 800; }
.mm-race-name { font-size: 13px; font-weight: 700; margin: 2px 0; }
.mm-race-desc { font-size: 9px; color: #877; line-height: 1.3; }
.mm-map-group { display: flex; flex-direction: column; gap: 6px; }
.mm-map-btn { display: flex; align-items: center; gap: 10px; padding: 8px 12px; text-align: left;
  cursor: pointer; background: rgba(30,15,10,0.6); border: 2px solid rgba(255,102,51,0.12);
  border-radius: 10px; color: #e8e8ec; font-family: inherit; transition: all 0.15s; }
.mm-map-btn:hover { border-color: rgba(255,102,51,0.4); background: rgba(50,25,15,0.7); }
.mm-map-btn.mm-selected { border-color: rgba(255,102,51,0.6); background: rgba(60,28,14,0.8);
  box-shadow: 0 0 14px rgba(255,102,51,0.12); }
.mm-map-thumb { width: 44px; height: 44px; flex-shrink: 0; border-radius: 6px; position: relative;
  background: linear-gradient(135deg, #3a1a0a 0%, #5a2a12 45%, #2a120a 65%, #4a2010 100%); overflow: hidden; }
.mm-map-thumb .mm-s { position: absolute; width: 8px; height: 8px; border-radius: 50%; }
.mm-map-thumb .mm-s1 { top: 14%; left: 14%; background: #4488ff; box-shadow: 0 0 4px #4488ff; }
.mm-map-thumb .mm-s2 { bottom: 14%; right: 14%; background: #ff4444; box-shadow: 0 0 4px #ff4444; }
.mm-map-name { font-size: 14px; font-weight: 700; color: #eeddcc; }
.mm-map-id { font-size: 10px; color: #776655; margin-top: 2px; }
.mm-preview { background: rgba(20,10,8,0.7); border: 1px solid rgba(255,102,51,0.2); border-radius: 12px;
  padding: 14px 16px; }
.mm-preview-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;
  color: rgba(170,136,102,0.65); text-align: center; margin-bottom: 10px; }
.mm-matchup { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 10px; }
.mm-matchup-side { text-align: center; min-width: 74px; }
.mm-matchup-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #776655; }
.mm-matchup-glyph { width: 46px; height: 46px; margin: 4px auto; border-radius: 50%; display: flex;
  align-items: center; justify-content: center; font-size: 22px; font-weight: 800;
  border: 2px solid rgba(255,102,51,0.3); background: rgba(30,15,10,0.5); }
.mm-matchup-name { font-size: 12px; font-weight: 700; color: #eeddcc; }
.mm-vs { font-size: 20px; font-weight: 900; color: rgba(255,102,51,0.45); }
.mm-pv-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
.mm-pv-label { color: #776655; }
.mm-pv-val { color: #ddccbb; font-weight: 600; }
.mm-start { width: 100%; margin-top: 14px; padding: 14px; border: none; border-radius: 10px;
  color: white; font-size: 17px; font-weight: 800; letter-spacing: 2px; cursor: pointer;
  background: linear-gradient(135deg, #cc4400 0%, #ff5500 100%); box-shadow: 0 4px 16px rgba(255,85,0,0.3);
  font-family: inherit; transition: transform 0.12s, box-shadow 0.12s; }
.mm-start:hover { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(255,85,0,0.42); }
.mm-seams { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.mm-seam-btn { flex: 1; min-width: 120px; padding: 10px; border-radius: 10px; text-align: center;
  background: rgba(20,12,8,0.5); border: 1px dashed rgba(255,102,51,0.18); color: #8a7a6a;
  font-family: inherit; cursor: not-allowed; opacity: 0.6; }
.mm-seam-title { font-size: 13px; font-weight: 700; }
.mm-seam-note { font-size: 9px; margin-top: 2px; color: #776655; line-height: 1.3; }
@media (max-width: 760px) { .mm-body { flex-direction: column; } .mm-side { width: 100%; } }
`;

/**
 * Show the pre-game MainMenu. `onStart` fires when the user (or `handle.start()`)
 * commits a match; the caller is responsible for the query-param reload (main.ts).
 * Headless-safe (returns a no-op handle that never shows).
 */
export function showMainMenu(onStart: (opts: MenuStartOptions) => void): MainMenuHandle {
  // Current selection (defaults mirror the source: normal + random + first map).
  const sel: MenuStartOptions = {
    difficulty: 'normal',
    race: 'random',
    aiRace: 'random',
    mapId: MAP_REGISTRY[0]?.id ?? 'red-canyon',
  };

  // ── headless guard ─────────────────────────────────────────────────────────
  if (typeof document === 'undefined') {
    return {
      active: () => false,
      isVisible: () => false,
      show: () => {},
      hide: () => {},
      selection: () => ({ ...sel }),
      start: (opts) => { Object.assign(sel, opts ?? {}); onStart({ ...sel }); },
      dispose: () => {},
    };
  }

  if (!document.getElementById(MM_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = MM_STYLE_ID;
    style.textContent = MM_CSS;
    document.head.appendChild(style);
  }

  // Remove a stale overlay from a prior bootstrap (HMR).
  document.getElementById('marscraft-mainmenu')?.remove();

  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const parent = resolveUiHost();

  const root = document.createElement('div');
  root.id = 'marscraft-mainmenu';
  root.innerHTML = buildHtml(sel);
  parent.appendChild(root);

  // ── delegated selection handlers ─────────────────────────────────────────
  root.addEventListener('click', (ev) => {
    const el = ev.target as HTMLElement;
    const diffBtn = el.closest<HTMLElement>('[data-diff]');
    if (diffBtn) { sel.difficulty = diffBtn.dataset.diff as MenuDifficulty; refresh(); return; }
    const raceBtn = el.closest<HTMLElement>('[data-race][data-group]');
    if (raceBtn) {
      const race = raceBtn.dataset.race as MenuRace;
      if (raceBtn.dataset.group === 'player') sel.race = race;
      else sel.aiRace = race;
      refresh();
      return;
    }
    const mapBtn = el.closest<HTMLElement>('[data-map]');
    if (mapBtn) { sel.mapId = mapBtn.dataset.map!; refresh(); return; }
    if (el.closest('#mm-start')) { onStart({ ...sel }); return; }
  });

  function refresh(): void {
    // Update selected classes + the live preview without a full innerHTML rebuild
    // (keeps hover state; cheap enough here to just re-render the panel body).
    root.innerHTML = buildHtml(sel);
  }

  return {
    active: () => true,
    isVisible: () => root.classList.contains('mm-show'),
    show: () => { root.classList.add('mm-show'); },
    hide: () => { root.classList.remove('mm-show'); },
    selection: () => ({ ...sel }),
    start: (opts) => { Object.assign(sel, opts ?? {}); onStart({ ...sel }); },
    dispose: () => { root.remove(); },
  };
}

// =============================================================================
// HTML
// =============================================================================

function raceLabel(r: MenuRace): string {
  return r === 'random' ? t('ui.random') : t(`race.${r}`);
}

function raceDesc(r: MenuRace): string {
  return t(r === 'random' ? 'ui.random_race_desc' : `ui.${r}_desc`);
}

function buildHtml(sel: MenuStartOptions): string {
  const mapEntry = MAP_REGISTRY.find((m) => m.id === sel.mapId) ?? MAP_REGISTRY[0];

  const diffBtns = DIFFICULTIES.map((d) => `
    <button class="mm-btn ${d === sel.difficulty ? 'mm-selected' : ''}" data-diff="${d}">
      <div class="mm-diff-icon">${DIFF_ICON[d]}</div>
      <div class="mm-diff-name" style="color:${DIFF_COLOR[d]}">${escapeHtml(t(`ui.${d}`))}</div>
      <div class="mm-diff-desc">${escapeHtml(t(`ui.${d}_desc`)).replace(/\n/g, '<br>')}</div>
    </button>`).join('');

  const raceGroup = (group: 'player' | 'ai', current: MenuRace) => RACES.map((r) => `
    <button class="mm-btn ${r === current ? 'mm-selected' : ''}" data-race="${r}" data-group="${group}">
      <div class="mm-race-glyph" style="color:${RACE_COLOR[r]}">${RACE_GLYPH[r]}</div>
      <div class="mm-race-name">${escapeHtml(raceLabel(r))}</div>
      <div class="mm-race-desc">${escapeHtml(raceDesc(r))}</div>
    </button>`).join('');

  const mapBtns = MAP_REGISTRY.map((m) => `
    <button class="mm-map-btn ${m.id === sel.mapId ? 'mm-selected' : ''}" data-map="${escapeHtml(m.id)}">
      <div class="mm-map-thumb"><div class="mm-s mm-s1"></div><div class="mm-s mm-s2"></div></div>
      <div>
        <div class="mm-map-name">${escapeHtml(m.name)}</div>
        <div class="mm-map-id">${escapeHtml(m.id)}</div>
      </div>
    </button>`).join('');

  const matchupSide = (label: string, r: MenuRace) => `
    <div class="mm-matchup-side">
      <div class="mm-matchup-label">${escapeHtml(label)}</div>
      <div class="mm-matchup-glyph" style="color:${RACE_COLOR[r]};border-color:${RACE_COLOR[r]}55">${RACE_GLYPH[r]}</div>
      <div class="mm-matchup-name">${escapeHtml(raceLabel(r))}</div>
    </div>`;

  const seam = (title: string, note: string) => `
    <div class="mm-seam-btn" title="${escapeHtml(note)}">
      <div class="mm-seam-title">${escapeHtml(title)}</div>
      <div class="mm-seam-note">${escapeHtml(note)}</div>
    </div>`;

  return `
  <div class="mm-panel">
    <div class="mm-hero">
      <div class="mm-logo">${escapeHtml(t('ui.brand_title'))}</div>
      <div class="mm-tagline">${escapeHtml(t('ui.brand_tagline'))}</div>
      <div class="mm-divider"></div>
    </div>

    <div class="mm-body">
      <div class="mm-config">
        <div class="mm-section">
          <div class="mm-section-label">${escapeHtml(t('ui.ai_difficulty'))}</div>
          <div class="mm-row">${diffBtns}</div>
        </div>
        <div class="mm-section">
          <div class="mm-section-label">${escapeHtml(t('ui.my_race'))}</div>
          <div class="mm-row">${raceGroup('player', sel.race)}</div>
        </div>
        <div class="mm-section">
          <div class="mm-section-label">${escapeHtml(t('ui.ai_race'))}</div>
          <div class="mm-row">${raceGroup('ai', sel.aiRace)}</div>
        </div>
        <div class="mm-section">
          <div class="mm-section-label">${escapeHtml(t('ui.select_map'))}</div>
          <div class="mm-map-group">${mapBtns}</div>
        </div>
      </div>

      <div class="mm-side">
        <div class="mm-preview">
          <div class="mm-preview-title">${escapeHtml(t('ui.match_preview'))}</div>
          <div class="mm-matchup">
            ${matchupSide(t('ui.player'), sel.race)}
            <div class="mm-vs">${escapeHtml(t('ui.vs'))}</div>
            ${matchupSide(t('ui.ai'), sel.aiRace)}
          </div>
          <div class="mm-pv-row"><span class="mm-pv-label">${escapeHtml(t('ui.difficulty'))}</span>
            <span class="mm-pv-val">${DIFF_ICON[sel.difficulty]} ${escapeHtml(t(`ui.${sel.difficulty}`))}</span></div>
          <div class="mm-pv-row"><span class="mm-pv-label">${escapeHtml(t('ui.map'))}</span>
            <span class="mm-pv-val">${escapeHtml(mapEntry.name)}</span></div>
        </div>
        <button class="mm-start" id="mm-start">▶ ${escapeHtml(t('ui.start_game'))}</button>
      </div>
    </div>

    <div class="mm-seams">
      ${seam(t('ui.multiplayer'), t('ui.seam_note'))}
      ${seam(t('ui.settings'), t('ui.seam_note'))}
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
