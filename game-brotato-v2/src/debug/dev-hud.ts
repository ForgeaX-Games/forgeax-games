import type { GameHost } from '@forgeax/engine-app';
import { mountUi, type UiAsset } from '@forgeax/engine-ui';

export type DevHudPage = 'runtime' | 'stats' | 'content';

export interface DevHudWeaponSnapshot {
  readonly slotIndex: number;
  readonly name: string;
  readonly shape: string;
  readonly range: number;
  readonly arcDegrees: number;
  /** Configured attack interval in seconds. */
  readonly cooldown: number;
  /** Remaining time until this weapon can attack again. */
  readonly cooldownRemaining: number;
  readonly targetId?: number;
  readonly kills: number;
}

export interface DevHudSnapshot {
  readonly fps: number;
  readonly frameMs: number;
  readonly entities: number;
  readonly enemies?: number;
  readonly phase: string;
  readonly build: string;
  readonly playerPos?: readonly [number, number];
  readonly playerSpeed?: number;
  readonly playerHealth?: number;
  readonly playerMaxHealth?: number;
  readonly viewExtent?: readonly [number, number];
  readonly spawnLive?: number;
  readonly spawnPending?: number;
  readonly spawnTier?: number;
  readonly spawnNextIn?: number;
  readonly spawnSkipped?: number;
  readonly spawnRelax?: readonly [number, number, number, number];
  readonly weapons?: readonly DevHudWeaponSnapshot[];
  readonly page?: DevHudPage;
}

export interface DevHud {
  readonly update: (snapshot: DevHudSnapshot) => void;
  readonly setVisible: (visible: boolean) => void;
  readonly setPage: (page: DevHudPage) => void;
  readonly dispose: () => void;
}

/** Select a dashboard page and make the dashboard visible in one command. */
export function showDevHudPage(
  state: { hudVisible: boolean },
  hud: Pick<DevHud, 'setPage'> | undefined,
  page: DevHudPage,
): void {
  state.hudVisible = true;
  hud?.setPage(page);
}

const HUD_HTML = [
  '<aside class="brotato-v2-hud" aria-label="Brotato v2 M2 combat dashboard">',
  '<header class="brotato-v2-header"><span class="brotato-v2-kicker">FORGEAX / ACCEPTANCE</span><strong data-ui-slot="build">M2 / COMBAT LOOP + DEPLOYMENT</strong><span data-ui-slot="page">RUNTIME</span></header>',
  '<nav class="brotato-v2-tabs" aria-label="Debug dashboard pages">',
  '<span data-ui-tab="runtime" class="active">F1 RUNTIME</span><span data-ui-tab="stats">F2 STATS</span><span data-ui-tab="content">F3 CONTENT</span>',
  '</nav>',
  '<section data-ui-page="runtime" class="brotato-v2-page active">',
  '<div class="brotato-v2-title">RUNTIME SNAPSHOT</div>',
  '<div class="brotato-v2-grid"><div><small>FPS</small><b data-ui-slot="fps">--</b></div><div><small>FRAME TIME</small><b data-ui-slot="frameMs">--</b></div><div><small>ENTITIES</small><b data-ui-slot="entities">--</b></div><div><small>ENEMIES</small><b data-ui-slot="enemies">--</b></div><div><small>PHASE</small><b data-ui-slot="phase">ARENA / READY</b></div><div><small>PLAYER XZ</small><b data-ui-slot="playerPos">--</b></div><div><small>PLAYER SPEED</small><b data-ui-slot="playerSpeed">--</b></div><div><small>HEALTH</small><b data-ui-slot="playerHealth">--</b></div><div><small>VIEW EXTENT</small><b data-ui-slot="viewExtent">--</b></div></div>',
  '<div data-ui-slot="spawnDebug" class="brotato-v2-spawn-debug">DEPLOYMENT --</div>',
  '</section>',
  '<section data-ui-page="stats" class="brotato-v2-page"><div class="brotato-v2-title">ATTRIBUTES</div><p class="brotato-v2-pending">PENDING — M3</p><p>属性来源分解将在 M3 接入。</p></section>',
  '<section data-ui-page="content" class="brotato-v2-page"><div class="brotato-v2-title">WEAPON LOADOUT / M2</div><div data-ui-slot="weaponRows" class="brotato-v2-weapon-rows">--</div></section>',
  '<div data-ui-slot="defeat" class="brotato-v2-defeat">DEFEATED <small>PRESS R TO RESTART</small></div>',
  '<footer class="brotato-v2-help"><kbd>F1</kbd> runtime&nbsp;&nbsp; <kbd>Tab</kbd> show/hide&nbsp;&nbsp; <kbd>F2</kbd> stats&nbsp;&nbsp; <kbd>F3</kbd> weapons&nbsp;&nbsp; <kbd>F4</kbd> / <kbd>G</kbd> stress&nbsp;&nbsp; <kbd>F5</kbd> / <kbd>T</kbd> target lines&nbsp;&nbsp; <kbd>F8</kbd> / <kbd>X</kbd> spawn gizmo&nbsp;&nbsp; <kbd>R</kbd> restart&nbsp;&nbsp; <kbd>F9</kbd> / <kbd>V</kbd> view grid</footer>',
  '</aside>',
].join('');

const HUD_CSS = [
  '.brotato-v2-hud{position:absolute;inset:0;box-sizing:border-box;pointer-events:none;color:#eaf7ff;font:500 13px/1.4 ui-sans-serif,system-ui,sans-serif;text-shadow:0 2px 12px #000;letter-spacing:.04em}',
  '.brotato-v2-header{position:absolute;top:24px;left:24px;display:flex;align-items:baseline;gap:12px;min-width:310px;padding:14px 17px;border:1px solid #65dfff55;border-radius:12px 12px 0 0;background:#071525e8;box-shadow:0 10px 35px #0008}',
  '.brotato-v2-kicker{color:#64e6ff;font-size:10px;letter-spacing:.16em}',
  '.brotato-v2-header strong{color:#fff;font-size:14px}',
  '.brotato-v2-header span:last-child{margin-left:auto;color:#ffd36a;font-size:11px;text-transform:uppercase}',
  '.brotato-v2-tabs{position:absolute;top:79px;left:24px;display:flex;gap:1px;padding:0 4px 4px;background:#071525e8;border-radius:0 0 10px 10px}',
  '.brotato-v2-tabs span{padding:8px 11px;color:#7391a8;font-size:10px;letter-spacing:.1em}',
  '.brotato-v2-tabs span.active{color:#fff;background:#174e6b}',
  '.brotato-v2-page{position:absolute;top:119px;left:24px;width:410px;padding:16px 18px;border:1px solid #65dfff33;border-radius:12px;background:linear-gradient(145deg,#071525e8,#0b1c2de5);box-shadow:0 16px 40px #0009}',
  '.brotato-v2-page:not(.active){display:none}',
  '.brotato-v2-title{margin-bottom:13px;color:#65e7ff;font-size:11px;font-weight:800;letter-spacing:.16em}',
  '.brotato-v2-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
  '.brotato-v2-grid div{display:flex;flex-direction:column;gap:3px;padding:10px;border:1px solid #ffffff12;border-radius:8px;background:#ffffff08}',
  '.brotato-v2-grid small{color:#88a8bf;font-size:10px;letter-spacing:.12em}',
  '.brotato-v2-grid b{color:#fff;font-size:18px;line-height:1.15}',
  '.brotato-v2-grid div:last-child b{color:#ffd36a;font-size:13px}',
  '.brotato-v2-spawn-debug{margin-top:12px;padding:10px;border:1px solid #ffcf6a33;border-radius:8px;color:#ffd36a;font:600 11px/1.7 ui-monospace,SFMono-Regular,monospace;white-space:pre}',
  '.brotato-v2-pending{margin:5px 0 8px;color:#ffd36a;font-size:19px;font-weight:800}',
  '.brotato-v2-page p:last-child{margin:0;color:#9ab5c8;font-size:12px}',
  '.brotato-v2-weapon-rows{white-space:pre;font:600 12px/1.8 ui-monospace,SFMono-Regular,monospace;color:#d9f6ff}',
  '.brotato-v2-defeat{position:absolute;left:50%;top:38%;display:none;transform:translate(-50%,-50%);padding:18px 28px;border:1px solid #ff7d69aa;border-radius:14px;background:#36131be8;color:#fff;font-size:30px;font-weight:900;letter-spacing:.12em;text-align:center;box-shadow:0 16px 55px #000b}',
  '.brotato-v2-defeat small{display:block;margin-top:6px;color:#ffd36a;font-size:11px;letter-spacing:.12em}',
  '.brotato-v2-help{position:absolute;right:24px;bottom:24px;padding:10px 13px;border:1px solid #ffffff1c;border-radius:9px;background:#071525cc;color:#9ab5c8}',
  '.brotato-v2-help kbd{padding:2px 5px;border:1px solid #65dfff55;border-radius:4px;color:#fff;background:#12304a;font:inherit;font-size:11px}',
].join('');

function setText(root: ParentNode, slot: string, value: string): void {
  const element = root.querySelector<HTMLElement>(`[data-ui-slot="${slot}"]`);
  if (element !== null && element.textContent !== value) element.textContent = value;
}

function createSurface(root: ParentNode, owner: HTMLElement, disposeOwner: () => void): DevHud {
  let page: DevHudPage = 'runtime';
  let visible = false;
  let disposed = false;

  const setPage = (next: DevHudPage): void => {
    page = next;
    for (const element of root.querySelectorAll<HTMLElement>('[data-ui-page]')) {
      element.classList.toggle('active', element.dataset.uiPage === page);
    }
    for (const element of root.querySelectorAll<HTMLElement>('[data-ui-tab]')) {
      element.classList.toggle('active', element.dataset.uiTab === page);
    }
    setText(root, 'page', page);
  };

  const setVisible = (next: boolean): void => {
    visible = next;
    owner.style.display = visible ? 'block' : 'none';
  };

  setPage(page);
  setVisible(false);
  return {
    update: (snapshot) => {
      if (snapshot.page !== undefined) setPage(snapshot.page);
      setText(root, 'fps', Number.isFinite(snapshot.fps) ? snapshot.fps.toFixed(1) : '--');
      setText(root, 'frameMs', Number.isFinite(snapshot.frameMs) ? `${snapshot.frameMs.toFixed(2)} ms` : '--');
      setText(root, 'entities', String(Math.max(0, Math.floor(snapshot.entities))));
      setText(root, 'enemies', snapshot.enemies === undefined ? '--' : String(Math.max(0, Math.floor(snapshot.enemies))));
      setText(root, 'phase', snapshot.phase);
      setText(root, 'build', snapshot.build);
      const defeat = root.querySelector<HTMLElement>('[data-ui-slot="defeat"]');
      if (defeat !== null) defeat.style.display = snapshot.phase.toLowerCase().includes('defeated') ? 'block' : 'none';
      const health = snapshot.playerHealth === undefined || snapshot.playerMaxHealth === undefined
        ? '--'
        : `${Math.max(0, Math.ceil(snapshot.playerHealth))} / ${Math.max(0, Math.ceil(snapshot.playerMaxHealth))}`;
      setText(root, 'playerHealth', health);
      const playerPos = snapshot.playerPos;
      setText(
        root,
        'playerPos',
        playerPos === undefined ? '--' : `${playerPos[0]?.toFixed(1) ?? '0.0'}, ${playerPos[1]?.toFixed(1) ?? '0.0'}`,
      );
      setText(
        root,
        'playerSpeed',
        snapshot.playerSpeed === undefined ? '--' : `${(snapshot.playerSpeed * 100).toFixed(0)}%`,
      );
      const viewExtent = snapshot.viewExtent;
      setText(
        root,
        'viewExtent',
        viewExtent === undefined ? '--' : `${viewExtent[0]?.toFixed(1) ?? '0.0'} × ${viewExtent[1]?.toFixed(1) ?? '0.0'}`,
      );
      const relax = snapshot.spawnRelax;
      setText(
        root,
        'spawnDebug',
        snapshot.spawnLive === undefined
          ? 'DEPLOYMENT --'
          : [
            `LIVE ${snapshot.spawnLive} / 20   PENDING ${snapshot.spawnPending ?? 0}`,
            `TIER T${snapshot.spawnTier ?? 0}   NEXT ${(snapshot.spawnNextIn ?? 0).toFixed(2)}s`,
            `SKIPPED ${snapshot.spawnSkipped ?? 0}   RELAX ${relax?.join(' / ') ?? '0 / 0 / 0 / 0'}`,
          ].join('\n'),
      );
      const weaponRows = root.querySelector<HTMLElement>('[data-ui-slot="weaponRows"]');
      if (weaponRows !== null && snapshot.weapons !== undefined) {
        const value = snapshot.weapons.map((weapon) => [
          `slot ${weapon.slotIndex}  ${weapon.name.padEnd(6)} ${weapon.shape.padEnd(6)}`,
          `range ${weapon.range.toFixed(1)}  arc ${weapon.arcDegrees.toFixed(0).padStart(3)}°`,
          `CD ${weapon.cooldown.toFixed(2)}s  left ${Math.max(0, weapon.cooldownRemaining).toFixed(2)}s  target ${weapon.targetId ?? '—'}  kills ${weapon.kills}`,
        ].join('  ')).join('\n');
        setText(root, 'weaponRows', value || '--');
      }
    },
    setVisible,
    setPage,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeOwner();
    },
  };
}

function createFallbackHud(host: GameHost): DevHud {
  const root = host.uiRoot ?? host.canvas.parentElement ?? document.body;
  const style = document.createElement('style');
  style.textContent = HUD_CSS;
  const panel = document.createElement('div');
  panel.innerHTML = HUD_HTML;
  root.append(style, panel);
  return createSurface(panel, panel, () => {
    panel.remove();
    style.remove();
  });
}

function createPackedHud(host: GameHost, asset: UiAsset): DevHud | undefined {
  const root = host.uiRoot ?? host.canvas.parentElement ?? document.body;
  const mounted = mountUi(asset, { root, layer: 50 });
  if (!mounted.ok) return undefined;
  const shadow = mounted.value.host.shadowRoot;
  if (shadow === null) {
    mounted.value.dispose();
    return undefined;
  }
  return createSurface(shadow, mounted.value.host, mounted.value.dispose);
}

export function createDevHud(host: GameHost, asset?: UiAsset): DevHud {
  if (asset !== undefined) {
    const packed = createPackedHud(host, asset);
    if (packed !== undefined) return packed;
  }
  return createFallbackHud(host);
}
