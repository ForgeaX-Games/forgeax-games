// MarsCraft port — deterministic e2e suite (M17).
//
// Drives the game through the `window.__marscraft` debug hooks (not fragile UI
// timing) against :15173/preview/?game=marscraft. Each test navigates fresh, so
// the stateful hooks (spawnSkirmish / clickCommand / …) don't cross-contaminate.
//
// Covers the full single-player loop verified across M0–M16:
//   load · maps · selection · movement · combat · economy · buildings · AI ·
//   fog · audio · lockstep-determinism.
//
// Run: start the stack (`bun fx start`), then from this dir:
//   npx playwright test --config ./playwright.config.ts

import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Forbidden console/page-error substrings (favicon 404 is allowed).
 * `hierarchy-broken` / `RhiError` catch the ChildOf-orphan class: a despawned
 * unit whose model parts survive with a dangling ChildOf → propagateTransforms
 * aborts the frame every tick (regressed once on the zerg larva→egg pipeline —
 * the Children-mirror repair in rebuildUnitModel fixes it; keep it guarded). */
const FORBIDDEN = [
  'pageerror', 'Uncaught', 'is not a function', 'undefined is not',
  'hierarchy-broken', 'RhiError',
];

/** Attach error collectors, navigate to the game, wait for the debug hook + a few ticks. */
async function loadGame(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text());
  });
  // `fixtures=1`: spawn the M9 caster/ally/enemy verify fixtures + a starting army
  // squad that the ability/combat/selection tests rely on. A NORMAL match opens with
  // just a town hall + 12 workers (no army/caster), so tests must opt in.
  await page.goto('/preview/?game=marscraft&fixtures=1' + query);
  await page.waitForFunction(() => !!(window as any).__marscraft, null, { timeout: 30_000 });
  await page.waitForTimeout(1500); // let economy / AI / vision systems tick
  return errors;
}

test.describe('marscraft e2e', () => {
  test('load: renders, world alive, no forbidden errors', async ({ page }) => {
    const errors = await loadGame(page);
    const entities = await page.evaluate(() => (window as any).__forgeax.world.inspect().entityCount);
    expect(entities).toBeGreaterThan(500); // terrain + env + army + resources
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('maps: an alternate preset generates + renders', async ({ page }) => {
    await loadGame(page, '&map=nebula-plateau');
    const info = await page.evaluate(() => (window as any).__marscraft.mapInfo());
    expect(info.id).toBe('nebula-plateau');
    expect(info.available.length).toBe(7);
  });

  test('selection: selectAll selects the player army', async ({ page }) => {
    await loadGame(page);
    const n = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      m.selectAll();
      return m.getSelected().length;
    });
    expect(n).toBeGreaterThan(0);
  });

  test('movement: moveSelectedTo relocates the selection', async ({ page }) => {
    await loadGame(page);
    const before = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      m.focus(-38, -46);
      m.selectAll();
      const p = m.probe().pos;
      m.moveSelectedTo(-18, -30);
      return p;
    });
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => (window as any).__marscraft.probe().pos);
    const dist = Math.hypot(after.x - before.x, after.z - before.z);
    expect(dist).toBeGreaterThan(3); // unit visibly traveled toward the target
  });

  test('combat: a skirmish produces casualties', async ({ page }) => {
    await loadGame(page);
    const ids = await page.evaluate(() => (window as any).__marscraft.spawnSkirmish(0, 0).entities);
    await page.waitForTimeout(9000);
    const aliveAfter = await page.evaluate((entIds) => (window as any).__marscraft.probeCombat(entIds).length, ids);
    expect(aliveAfter).toBeLessThan(ids.length); // at least one unit died + despawned
  });

  test('economy: minerals climb as workers harvest', async ({ page }) => {
    await loadGame(page);
    const m0 = await page.evaluate(() => (window as any).__marscraft.resources(0).minerals);
    await page.waitForTimeout(8000);
    const m1 = await page.evaluate(() => (window as any).__marscraft.resources(0).minerals);
    expect(m1).toBeGreaterThan(m0);
  });

  test('buildings: training an SCV spends minerals + queues', async ({ page }) => {
    // Pin terran — SCV/command-center are terran-specific, and an unqualified
    // load resolves race='random' (main.ts resolveRace), so the base could be a
    // zerg hatchery / protoss nexus that can't train an SCV.
    await loadGame(page, '&started=1&race=terran');
    const r = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      const base = m.probeHarvest().base;
      m.selection.select([base]);
      const before = m.resources(0).minerals;
      m.clickCommand('train_scv');
      const after = m.resources(0).minerals;
      const bld = m.probeBuildings().find((b: any) => b.entity === base);
      return { spent: before - after, queue: bld ? bld.queueLength : 0 };
    });
    expect(r.spent).toBe(50);
    expect(r.queue).toBeGreaterThan(0);
  });

  test('AI: the enemy economy + build order run', async ({ page }) => {
    await loadGame(page);
    const s0 = await page.evaluate(() => {
      const a = (window as any).__marscraft.aiState();
      return { idx: a.buildOrderIndex, workers: a.workerCount };
    });
    await page.waitForTimeout(35000); // AI must earn income + train workers first
    const s1 = await page.evaluate(() => (window as any).__marscraft.aiState());
    // The AI is a real opponent if ANY of: it trained workers past its start,
    // advanced its build order, or accumulated a working economy's minerals.
    // (Verified live: by ~40s the AI grows 3→5 workers + ~190 minerals.)
    expect(
      s1.workerCount > s0.workers || s1.buildOrderIndex > s0.idx || s1.minerals > 100,
    ).toBeTruthy();
  });

  test('fog: enemy units are hidden out of vision', async ({ page }) => {
    await loadGame(page);
    const fog = await page.evaluate(() => (window as any).__marscraft.probeFog());
    expect(fog.enabled).toBe(true);
    expect(fog.hidden).toBeGreaterThan(0); // the far enemy army is fogged
    const enemyVisible = await page.evaluate(() => (window as any).__marscraft.isVisible(38, 42));
    expect(enemyVisible).toBe(false);
  });

  test('audio: combat flips BGM economy → battle', async ({ page }) => {
    await loadGame(page);
    await page.evaluate(() => {
      const m = (window as any).__marscraft;
      m.audioArm();
      m.spawnSkirmish(-38, -42);
    });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => (window as any).__marscraft.audioState());
    expect(st.phase).toBe('battle');
  });

  test('vfx: bespoke per-weapon effects spawn particles then drain (no leak)', async ({ page }) => {
    // started=1 so the frame loop runs (dt>0) — VFX only age/expire while playing;
    // on the paused menu they'd materialize but never drain.
    const errors = await loadGame(page, '&started=1');
    // fire each M11-ch2 bespoke kind, sample the live particle count for ~1.4s.
    // fire each bespoke kind; sample the peak live-particle count over ~1s.
    const peak = await page.evaluate(() => new Promise<number>((resolve) => {
      const m = (window as any).__marscraft;
      for (const k of ['slash', 'flame', 'slime', 'shockwave', 'trail', 'shield_burst', 'energy_flash']) m.spawnVfx(k, 0, 0, { size: 0.6, count: 3 });
      let p = 0;
      const t0 = performance.now();
      const iv = setInterval(() => {
        p = Math.max(p, m.probeVfx().active);
        if (performance.now() - t0 > 1000) { clearInterval(iv); resolve(p); }
      }, 80);
    }));
    expect(peak).toBeGreaterThan(0); // the bespoke effects materialized transient particles
    // …and they self-despawn (no leak). Poll on wall-clock — headless throttles
    // rAF, so the sim ages slowly; particles (lifetime ~1s) drain within a few s.
    await page.waitForFunction(() => (window as any).__marscraft.probeVfx().active === 0, null, { timeout: 15000 });
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('hud layout (M19): all overlays render without overlapping', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const overlaps = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      m.selectAll();                            // resource bar + selection + command card
      m.grantUpgrade(0, 'infantry_weapons');    // upgrade markers
      m.pushAlert('under_attack', 'Under attack!', -30, -40); // alert toast (top-right)
      const ids = ['#mc-resource-bar', '#mc-selection', '#mc-command', '#marscraft-minimap', '.mc-gta', '.mc-idle', '.mc-alert-box'];
      const R: Record<string, number[]> = {};
      for (const s of ids) {
        const el = document.querySelector(s) as HTMLElement | null;
        if (!el) continue; const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none') R[s] = [r.x, r.y, r.right, r.bottom];
      }
      const out: string[] = []; const k = Object.keys(R);
      for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
        const a = R[k[i]], b = R[k[j]];
        const ox = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
        const oy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
        if (ox > 4 && oy > 4) out.push(`${k[i]} ∩ ${k[j]}`);
      }
      return out;
    });
    expect(overlaps).toEqual([]); // no HUD overlay collides with another
  });

  test('settings panel (M19): opens with volume/edge/fps rows + hotkey reference', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const r = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      const opened = m.openSettings();
      const visible = (document.querySelector('.mc-set-ov') as HTMLElement | null)?.style.display;
      const rows = document.querySelectorAll('.mc-set-row').length;
      const hotkeys = document.querySelectorAll('.mc-set-hk-row').length;
      // toggle showFPS on → the FPS overlay appears
      const box = document.querySelector('#mcs-fps') as HTMLInputElement;
      box.checked = true; box.dispatchEvent(new Event('change'));
      const fpsShown = (document.querySelector('.mc-fps') as HTMLElement | null)?.style.display;
      return { opened, visible, rows, hotkeys, fpsShown, settings: m.probeSettings() };
    });
    expect(r.opened).toBe(true);
    expect(r.visible).toBe('flex');
    expect(r.rows).toBe(4);           // master / bgm / edge / fps
    expect(r.hotkeys).toBeGreaterThan(5); // the hotkey reference list
    expect(r.fpsShown).toBe('block'); // showFPS toggle drives the FPS overlay
    expect(r.settings.showFPS).toBe(true);
  });

  test('minimap pings + upgrade markers (M19)', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const r = await page.evaluate(() => new Promise<{ pings: number; upgrades: number }>((resolve) => {
      const m = (window as any).__marscraft;
      m.pushAlert('under_attack', 'Under attack!', -30, -40); // positioned → minimap ping
      m.grantUpgrade(0, 'infantry_weapons');                  // multi-level upgrade → badge
      // poll for the throttled badge redraw + count the (just-added) ping.
      const t0 = performance.now();
      const iv = setInterval(() => {
        const upgrades = m.probeUpgradeMarkers().length;
        if (upgrades > 0 || performance.now() - t0 > 8000) {
          clearInterval(iv);
          resolve({ pings: m.probeMinimapPings().count, upgrades });
        }
      }, 200);
    }));
    expect(r.pings).toBeGreaterThan(0);    // positioned alert added a minimap ping
    expect(r.upgrades).toBeGreaterThan(0); // the granted upgrade shows a marker
  });

  test('rally renderer (M19): a selected building with a rally draws line+flag markers', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const markers = await page.evaluate(() => new Promise<number>((resolve) => {
      const m = (window as any).__marscraft;
      const base = m.probeHarvest().base;
      m.selection.select([base]);
      m.setRally(base, 20, 20);
      // poll for the throttled rebuild (headless slows the sim clock).
      const t0 = performance.now();
      const iv = setInterval(() => {
        const n = m.probeRally().markers;
        if (n > 0 || performance.now() - t0 > 10000) { clearInterval(iv); resolve(n); }
      }, 200);
    }));
    expect(markers).toBeGreaterThan(0); // line + flag pole + flag drawn at the rally
  });

  test('status widgets (M19): GameTimeAPM counts + IdleTracker detects idle production', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const r = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      for (let i = 0; i < 6; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      return {
        apm: m.probeTimeApm().apm,
        gta: !!document.querySelector('.mc-gta'),
        idleProd: m.probeIdle().idleProduction,
        idleWidget: !!document.querySelector('.mc-idle'),
      };
    });
    expect(r.gta).toBe(true);           // GameTimeAPM widget rendered
    expect(r.apm).toBeGreaterThanOrEqual(6); // APM counted the 6 keydowns
    expect(r.idleWidget).toBe(true);    // IdleTracker widget rendered
    expect(r.idleProd).toBeGreaterThan(0); // the starting town hall is idle (empty queue)
  });

  test('control groups (M19): assign, recall, and the bar renders tabs', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const r = await page.evaluate(() => new Promise<{ sel: number; g1: number; recalled: number; tabs: number }>((resolve) => {
      const m = (window as any).__marscraft;
      m.selectAll();
      const sel = m.getSelected().length;
      m.assignGroup(1);                 // group 1 = whole army (Ctrl+1 in game)
      m.selection.clear();
      const recalled = m.recallGroup(1); // recall (1 in game) → reselects
      const g1 = m.probeControlGroups().groups[1] ?? 0;
      setTimeout(() => resolve({ sel, g1, recalled, tabs: document.querySelectorAll('.mc-cg-tab').length }), 400);
    }));
    expect(r.sel).toBeGreaterThan(0);
    expect(r.g1).toBe(r.sel);          // group holds the assigned selection
    expect(r.recalled).toBe(r.sel);    // recall reselects the group
    expect(r.tabs).toBeGreaterThan(0); // the ControlGroupBar rendered a tab
  });

  test('alerts (M19): toasts push + a skirmish fires under-attack', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran&airace=terran');
    const r = await page.evaluate(() => new Promise<{ manualTotal: number; domIcons: string[]; combatFired: boolean }>((resolve) => {
      const m = (window as any).__marscraft;
      m.pushAlert('build_complete', 'Test complete');           // manual toast
      const manualTotal = m.probeAlerts().total;
      const domIcons = Array.from(document.querySelectorAll('.mc-alert-icon')).map((e: any) => e.textContent);
      const t0 = m.probeAlerts().total;
      m.spawnSkirmish(0, 0);                                    // local units take damage → under_attack
      setTimeout(() => resolve({ manualTotal, domIcons, combatFired: m.probeAlerts().total > t0 }), 5000);
    }));
    expect(r.manualTotal).toBeGreaterThan(0);   // a pushed alert counted
    expect(r.domIcons.length).toBeGreaterThan(0); // rendered a toast in the DOM
    expect(r.combatFired).toBe(true);            // combat:damage_taken → under_attack toast
  });

  test('game over (M19): eliminating a side shows the VICTORY/DEFEAT screen', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran&airace=terran');
    // eliminate the ENEMY (all buildings) → VICTORY for the local player.
    const win = await page.evaluate(() => {
      const m = (window as any).__marscraft;
      m.forceEliminate(1);
      const v = m.checkVictory();
      const title = document.querySelector('.mc-go-title')?.textContent?.trim() ?? null;
      const overlay = document.querySelector('.mc-go-overlay') as HTMLElement | null;
      return { resolved: v.resolved, isVictory: v.isVictory, title, visible: overlay ? getComputedStyle(overlay).display : 'none', cols: document.querySelectorAll('.mc-go-col').length };
    });
    expect(win.resolved).toBe(true);
    expect(win.isVictory).toBe(true);
    expect(win.title).toBe('VICTORY');
    expect(win.visible).toBe('flex');   // GameOverScreen overlay shown
    expect(win.cols).toBe(2);           // two-column stats (local + enemy)
  });

  test('map scenes (M18): placements come from the editable scene pack', async ({ page }) => {
    await loadGame(page, '&started=1&race=terran');
    const info = await page.evaluate(() => (window as any).__marscraft.mapInfo());
    // the default map loads its resource/start placements from scenes/<id>.pack.json
    // (edited in the Studio editor), not the pure procedural blueprint path.
    expect(info.placementSource).toBe('scene');
    expect(info.minerals).toBeGreaterThan(0);   // mineral markers read from the scene
    expect(info.geysers).toBeGreaterThan(0);     // geyser markers read from the scene
    expect(info.spawns).toBeGreaterThanOrEqual(2); // start markers (player + AI)
  });

  test('ability vfx: EMP fires a bespoke burst at the target (dispatch table)', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // EMP is in the ABILITY_VFX table → bespoke `emp` burst (14 parts) at the
    // target + generic cast_flash (7) at the caster; a non-table ability fires
    // only the cast_flash. The bespoke peak must exceed the generic one.
    const r = await page.evaluate(() => new Promise<{ empPeak: number; genericPeak: number }>((resolve) => {
      const m = (window as any).__marscraft;
      const sample = (fire: () => void, ms: number) => new Promise<number>((res) => {
        fire(); let p = 0; const t0 = performance.now();
        const iv = setInterval(() => { p = Math.max(p, m.probeVfx().active); if (performance.now() - t0 > ms) { clearInterval(iv); res(p); } }, 60);
      });
      (async () => {
        const empPeak = await sample(() => m.fireAbilityEvent('emp', 30, 30), 700);
        await new Promise((r2) => setTimeout(r2, 1500)); // let it drain
        const genericPeak = await sample(() => m.fireAbilityEvent('stimpack', 0, 0), 500);
        resolve({ empPeak, genericPeak });
      })();
    }));
    expect(r.genericPeak).toBeGreaterThan(0);          // generic cast_flash fired
    expect(r.empPeak).toBeGreaterThan(r.genericPeak);  // EMP added a bespoke burst on top
    await page.waitForFunction(() => (window as any).__marscraft.probeVfx().active === 0, null, { timeout: 15000 });
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('ability vfx: nexus bolt draws a caster→target energy beam', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // stellar_insight fires an energy beam from the caster to the targeted ally
    // (source _createNexusBoltVFX). A beam over distance = many motes → high peak.
    const peak = await page.evaluate(() => new Promise<number>((resolve) => {
      const m = (window as any).__marscraft;
      const caster = m.caster();
      const t2 = m.spawnCaster(0, 12); // a distant ally to beam to
      m.fireAbilityEvent('stellar_insight', undefined, undefined, caster, t2);
      let p = 0; const t0 = performance.now();
      const iv = setInterval(() => { p = Math.max(p, m.probeVfx().active); if (performance.now() - t0 > 600) { clearInterval(iv); resolve(p); } }, 60);
    }));
    expect(peak).toBeGreaterThan(10); // beam motes along the segment + cast_flash
    await page.waitForFunction(() => (window as any).__marscraft.probeVfx().active === 0, null, { timeout: 15000 });
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('ability vfx: blink teleport spawns departure + arrival bursts', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // fx:teleport (emitted by executeTeleport on a blink) → blink_out @from +
    // blink_in @to. fireTeleport emits the same bus event a real blink does.
    const peak = await page.evaluate(() => new Promise<number>((resolve) => {
      const m = (window as any).__marscraft;
      m.fireTeleport(0, 0, 20, 0);
      let p = 0; const t0 = performance.now();
      const iv = setInterval(() => { p = Math.max(p, m.probeVfx().active); if (performance.now() - t0 > 700) { clearInterval(iv); resolve(p); } }, 60);
    }));
    expect(peak).toBeGreaterThan(10); // both ends' rings + converging/bursting motes
    await page.waitForFunction(() => (window as any).__marscraft.probeVfx().active === 0, null, { timeout: 15000 });
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('buff auras (M17): persistent per-buff VFX create, follow, and tear down', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // Persistent buff auras (source AbilityVFX._createBuffVFX): each buff with a
    // declarative BuffVFXConfig gets burst + continuous particles + marker + ground
    // ring for as long as it's held. applyTestBuff drives the REAL path (adds the
    // buff + emits ability:buff_applied); removeTestBuff tears it down.
    const r = await page.evaluate(() => new Promise<{
      casterAuras: number; markerSeen: boolean; groundSeen: boolean; vfxActive: number; casterAfter: number;
    }>((resolve) => {
      const m = (window as any).__marscraft;
      // two player casters spawned away from combat so they persist through the probe
      // (the pre-spawned enemy fixture can die mid-test, taking its auras with it).
      const caster = m.spawnCaster(30, 30);
      const other = m.spawnCaster(34, 30);
      m.applyTestBuff(caster, 'stim_pack');       // particles(up) + burst(ring)
      m.applyTestBuff(caster, 'stellar_insight'); // particles(up)
      m.applyTestBuff(other, 'dragoon_slow');     // groundRing(pulse) + particles(down)
      m.applyTestBuff(other, 'tactical_mark');    // marker(diamond spin+pulse)
      setTimeout(() => {
        const auras = m.probeBuffAuras() as Array<{ entity: number; marker: boolean; ground: boolean }>;
        const casterAuras = auras.filter((a) => a.entity === caster).length;
        const markerSeen = auras.some((a) => a.entity === other && a.marker);
        const groundSeen = auras.some((a) => a.entity === other && a.ground);
        const vfxActive = m.probeVfx().active;
        // teardown the caster's two buffs → its auras must drop to 0 (no orphans)
        m.removeTestBuff(caster, 'stim_pack');
        m.removeTestBuff(caster, 'stellar_insight');
        setTimeout(() => {
          const casterAfter = (m.probeBuffAuras() as Array<{ entity: number }>).filter((a) => a.entity === caster).length;
          resolve({ casterAuras, markerSeen, groundSeen, vfxActive, casterAfter });
        }, 500);
      }, 1400);
    }));
    expect(r.casterAuras).toBe(2);        // both self-buff auras live
    expect(r.markerSeen).toBe(true);      // overhead marker (tactical_mark)
    expect(r.groundSeen).toBe(true);      // foot ground-ring (dragoon_slow)
    expect(r.vfxActive).toBeGreaterThan(0); // continuous aura motes flowing
    expect(r.casterAfter).toBe(0);        // teardown removed both auras cleanly
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('stateful ability vfx (M17): stellar-insight eye + declarative shield-charge', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // Bespoke buff-triggered VFX: stellar_insight -> a floating layered "eye" (5 parts,
    // StatefulAbilityVfxSystem); immortal_shield_charging -> a declarative pulsing
    // foot-ring + rising motes rendered by BuffAuraSystem (added to the buff's vfx).
    const r = await page.evaluate(() => new Promise<{
      eyeParts: number; eyeKind: string; shieldGround: boolean; vfxActive: number; eyeAfter: number;
    }>((resolve) => {
      const m = (window as any).__marscraft;
      const seer = m.spawnCaster(30, 30);
      const immortal = m.spawnCaster(34, 30);
      m.applyTestBuff(seer, 'stellar_insight');            // eye (bespoke) + particle aura
      m.applyTestBuff(immortal, 'immortal_shield_charging'); // declarative ring+particles
      setTimeout(() => {
        const eye = (m.probeStatefulVfx() as Array<{ entity: number; kind: string; parts: number }>).find((e) => e.entity === seer);
        const auras = m.probeBuffAuras() as Array<{ entity: number; ground: boolean }>;
        const shieldGround = auras.some((a) => a.entity === immortal && a.ground);
        const vfxActive = m.probeVfx().active;
        m.removeTestBuff(seer, 'stellar_insight'); // teardown the eye
        setTimeout(() => {
          const eyeAfter = (m.probeStatefulVfx() as Array<{ entity: number }>).filter((e) => e.entity === seer).length;
          resolve({ eyeParts: eye?.parts ?? 0, eyeKind: eye?.kind ?? '', shieldGround, vfxActive, eyeAfter });
        }, 500);
      }, 1400);
    }));
    expect(r.eyeKind).toBe('eye');            // stellar_insight built the bespoke eye
    expect(r.eyeParts).toBe(5);               // glow + lens + iris + iris-ring + pupil
    expect(r.shieldGround).toBe(true);        // shield-charge declarative foot ring
    expect(r.vfxActive).toBeGreaterThan(0);   // continuous motes flowing
    expect(r.eyeAfter).toBe(0);               // eye torn down cleanly (no orphans)
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('ability-lifecycle vfx (M17): phase_snipe charge (real cast, channel-driven)', async ({ page }) => {
    // `&workers=2` keeps the sim light: a real-cast windup is game-time-driven, and a
    // full 12-worker×2 opening tanks headless FPS enough that dt-clamping stretches the
    // ~1s castTime into >20s of wall time. Fewer workers ⇒ high FPS ⇒ game-time ≈ wall
    // time, so the windup completes inside the teardown budget. (Normal play still = 12.)
    const errors = await loadGame(page, '&started=1&workers=2');
    // phase_snipe is a REAL cast (the caster has it): cast_start → the channel-driven
    // charge ball+glow appears during the ~1s castTime windup, then tears down when the
    // windup completes (!isChanneling). Split from the flame/cloak test so each stage
    // gets its own timing budget (the chained version flaked under full-suite CPU load).
    const r = await page.evaluate(() => new Promise<{ sawPhase: boolean; phaseGone: boolean }>((resolve) => {
      const m = (window as any).__marscraft;
      m.castAbility(m.caster(), 'phase_snipe', { targetEntity: m.casterTargets().enemy });
      let sawPhase = false; const t0 = performance.now();
      const iv = setInterval(() => {
        if (m.probeStatefulVfx().some((f: any) => f.kind === 'phase')) sawPhase = true;
        if (sawPhase || performance.now() - t0 > 8000) {
          clearInterval(iv);
          const t1 = performance.now();
          const iv2 = setInterval(() => {
            const stillPhase = m.probeStatefulVfx().some((f: any) => f.kind === 'phase');
            if (!stillPhase || performance.now() - t1 > 20000) {
              clearInterval(iv2);
              resolve({ sawPhase, phaseGone: !stillPhase });
            }
          }, 200);
        }
      }, 150);
    }));
    expect(r.sawPhase).toBe(true);   // cast_start → phase charge VFX during windup
    expect(r.phaseGone).toBe(true);  // torn down when the windup ended (!isChanneling)
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('ability-lifecycle vfx (M17): flame_dash shell + cloak burst', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // flame_dash (sustained) + cloak (toggle) via fireLifecycle (same events real casts
    // emit) — deterministic, no dependency on a specific unit/target being castable.
    const r = await page.evaluate(() => new Promise<{ flameParts: number; flameGone: boolean; cloakRose: boolean }>((resolve) => {
      const m = (window as any).__marscraft;
      const u = m.spawnCaster(30, 30);
      const vfxBefore = m.probeVfx().active;
      m.fireLifecycle('sustained_start', { entity: u, abilityId: 'flame_dash', x: 40, z: 30, duration: 4 });
      m.fireLifecycle('toggle_complete', { entity: u, stateId: 'cloak', active: true });
      const t0 = performance.now();
      let vfxPeak = vfxBefore;
      const iv = setInterval(() => {
        vfxPeak = Math.max(vfxPeak, m.probeVfx().active);
        const flame = m.probeStatefulVfx().find((f: any) => f.kind === 'flame');
        if ((flame && vfxPeak > vfxBefore) || performance.now() - t0 > 5000) {
          clearInterval(iv);
          const flameParts = flame?.parts ?? 0;
          const cloakRose = vfxPeak > vfxBefore;
          m.fireLifecycle('sustained_end', { entity: u, abilityId: 'flame_dash' });
          const t1 = performance.now();
          const iv2 = setInterval(() => {
            const still = m.probeStatefulVfx().some((f: any) => f.kind === 'flame');
            if (!still || performance.now() - t1 > 4000) {
              clearInterval(iv2);
              resolve({ flameParts, flameGone: !still, cloakRose });
            }
          }, 150);
        }
      }, 150);
    }));
    expect(r.flameParts).toBe(1);     // sustained_start → flame shell
    expect(r.cloakRose).toBe(true);   // flame trail motes + cloak burst flowed to the vfx pool
    expect(r.flameGone).toBe(true);   // sustained_end → flame torn down cleanly
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('earth-eruption vfx (M17): earth_shatter, spine_rush, lurker_burrow', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // earth_shatter + spine_rush (sustained dash) + lurker_burrow (timed) via fireLifecycle
    // (the events real casts emit). Verify each creates the right effect, spine carries
    // its ground-bulge part, the dash end fires a debris burst, and teardown is clean.
    const r = await page.evaluate(() => new Promise<{
      kinds: string[]; spineParts: number; burstSpiked: boolean; earthGone: boolean;
    }>((resolve) => {
      const m = (window as any).__marscraft;
      const e = m.spawnCaster(30, 30), s = m.spawnCaster(34, 30), l = m.spawnCaster(38, 30);
      m.fireLifecycle('sustained_start', { entity: e, abilityId: 'earth_shatter', x: 50, z: 30, duration: 4 });
      m.fireLifecycle('sustained_start', { entity: s, abilityId: 'spine_rush', x: 50, z: 30, duration: 4 });
      m.fireLifecycle('cast_start', { entity: l, abilityId: 'lurker_burrow', castTime: 1 });
      const t0 = performance.now();
      const iv = setInterval(() => {
        const fx = m.probeStatefulVfx() as Array<{ entity: number; kind: string; parts: number }>;
        const kinds = fx.map((f) => f.kind);
        if ((kinds.includes('earth') && kinds.includes('spine') && kinds.includes('burrow')) || performance.now() - t0 > 4000) {
          clearInterval(iv);
          const spineParts = fx.find((f) => f.entity === s)?.parts ?? 0;
          const before = m.probeVfx().active;
          m.fireLifecycle('sustained_end', { entity: e, abilityId: 'earth_shatter' }); // → 14-bit rock burst
          let peak = before; const t1 = performance.now();
          const iv2 = setInterval(() => {
            peak = Math.max(peak, m.probeVfx().active);
            if (performance.now() - t1 > 2000) {
              clearInterval(iv2);
              const earthGone = !(m.probeStatefulVfx() as Array<{ kind: string }>).some((f) => f.kind === 'earth');
              resolve({ kinds, spineParts, burstSpiked: peak >= before + 8, earthGone });
            }
          }, 100);
        }
      }, 150);
    }));
    expect(r.kinds).toEqual(expect.arrayContaining(['earth', 'spine', 'burrow']));
    expect(r.spineParts).toBe(1);      // spine_rush ground-bulge disc
    expect(r.burstSpiked).toBe(true);  // dash end fired a rock-debris burst
    expect(r.earthGone).toBe(true);    // torn down on sustained_end (no leak)
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('prismatic vfx (M17): charge orb + target omen, then blast on complete', async ({ page }) => {
    const errors = await loadGame(page, '&started=1');
    // prismatic_charge (sustained): head energy-orb + glow + a target-area omen ring +
    // disc (4 parts) with converging/rising motes; ability:sustained_complete fires the
    // area blast (light pillar + shockwave rings + flash + 35 shards) at the target.
    const r = await page.evaluate(() => new Promise<{
      chargeParts: number; chargeKind: string; blastSpiked: boolean; chargeGone: boolean;
    }>((resolve) => {
      const m = (window as any).__marscraft;
      const u = m.spawnCaster(30, 30);
      m.fireLifecycle('sustained_start', { entity: u, abilityId: 'prismatic_charge', x: 45, z: 30, duration: 3 });
      const t0 = performance.now();
      const iv = setInterval(() => {
        const fx = (m.probeStatefulVfx() as Array<{ entity: number; kind: string; parts: number }>).find((f) => f.entity === u);
        if (fx || performance.now() - t0 > 4000) {
          clearInterval(iv);
          const chargeParts = fx?.parts ?? 0; const chargeKind = fx?.kind ?? '';
          const before = m.probeVfx().active;
          m.fireLifecycle('sustained_complete', { entity: u, abilityId: 'prismatic_charge', x: 45, z: 30 });
          let peak = before; const t1 = performance.now();
          const iv2 = setInterval(() => {
            peak = Math.max(peak, m.probeVfx().active);
            if (performance.now() - t1 > 2500) {
              clearInterval(iv2);
              const chargeGone = !(m.probeStatefulVfx() as Array<{ kind: string }>).some((f) => f.kind === 'prismatic');
              resolve({ chargeParts, chargeKind, blastSpiked: peak >= before + 15, chargeGone });
            }
          }, 100);
        }
      }, 150);
    }));
    expect(r.chargeKind).toBe('prismatic');
    expect(r.chargeParts).toBe(4);      // orb + glow + omen ring + omen disc
    expect(r.blastSpiked).toBe(true);   // sustained_complete → 35-shard area blast
    expect(r.chargeGone).toBe(true);    // charge torn down on complete (no leak)
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('direction wave: sonar pulse travels + hits each enemy on its path once', async ({ page }) => {
    const errors = await loadGame(page, '&started=1&race=protoss&airace=terran');
    const r = await page.evaluate(() => new Promise<{ maxTraveled: number; maxHits: number; drained: boolean }>((resolve) => {
      const m = (window as any).__marscraft;
      m.spawnSkirmish(15, 15);                                   // enemy cluster on the path
      m.spawnDirectionWave(3, 15, 1, 0, { maxRange: 30, width: 6, revealRange: 6, revealDuration: 6 });
      let maxTraveled = 0, maxHits = 0;
      const t0 = performance.now();
      const iv = setInterval(() => {
        const w = m.probeDirectionWaves()[0];
        if (w) { maxTraveled = Math.max(maxTraveled, w.traveled); maxHits = Math.max(maxHits, w.hits); }
        if (performance.now() - t0 > 4000) {
          clearInterval(iv);
          resolve({ maxTraveled, maxHits, drained: m.probeDirectionWaves().length === 0 });
        }
      }, 250);
    }));
    expect(r.maxTraveled).toBeGreaterThan(15);  // the wave propagated down its path
    expect(r.maxHits).toBeGreaterThan(0);       // …and struck enemies in the corridor
    expect(r.drained).toBe(true);               // …then despawned at maxRange (no leak)
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('pylon power: Protoss power field is bounded by a completed pylon', async ({ page }) => {
    await loadGame(page, '&started=1&race=protoss&airace=terran');
    const r = await page.evaluate(() => new Promise<{ near: boolean; edge: boolean; far: boolean }>((resolve) => {
      const m = (window as any).__marscraft;
      m.giveMinerals(500);              // afford the pylon without waiting for harvest
      const p = m.build('pylon', 4, 0); // self-powered → places even with no field
      m.forceComplete(p);               // skip the 18s build (headless throttles the sim)
      // one more frame lets _recomputePower see the now-complete pylon.
      setTimeout(() => resolve({ near: m.poweredAt(5, 0), edge: m.poweredAt(12, 0), far: m.poweredAt(20, 20) }), 400);
    }));
    expect(r.near).toBe(true);   // within 7 world units of the pylon → powered
    expect(r.edge).toBe(false);  // 8 units away → outside the field
    expect(r.far).toBe(false);   // far away → unpowered
  });

  test('zerg churn: larva→egg→unit pipeline leaks no ChildOf orphans', async ({ page }) => {
    // Zerg-vs-zerg on hard drives the highest model-rebuild churn (larvae morph
    // to eggs to units continuously). A stale Children mirror on the rebuilt
    // entity would orphan model parts → a `hierarchy-broken` storm every frame.
    // ~22s lets many eggs hatch; FORBIDDEN now includes hierarchy-broken/RhiError.
    const errors = await loadGame(page, '&started=1&race=zerg&airace=zerg&difficulty=hard');
    await page.waitForTimeout(22000);
    expect(errors.filter((e) => FORBIDDEN.some((f) => e.includes(f)))).toEqual([]);
  });

  test('lockstep: determinism holds (same seed → same checksum)', async ({ page }) => {
    await loadGame(page);
    const det = await page.evaluate(() => (window as any).__marscraft.determinismCheck());
    expect(det.match).toBe(true);
  });
});
