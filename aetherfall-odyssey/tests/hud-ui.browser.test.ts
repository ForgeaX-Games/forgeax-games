import { describe, expect, it } from 'vitest';
import { installHud } from '../assets/plugins/hud';
import { GAME_DEFAULT_INPUT_MAP } from '../assets/plugins/resources/input';

describe('game-default HUD consumer', () => {
  it('projects the playable mission, guided lab, mode and popup into one disposable host', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const actions: string[] = [];
    const hud = installHud({ asset: { guid: 'test', html: '<section><span data-ui-slot="score"></span><aside data-ui-slot="target-status"></aside><aside data-ui-slot="combo"></aside><strong data-ui-slot="mission"></strong><button data-ui-action="toggle-mode"></button><details class="asset-lab"><summary>Asset Lab</summary><button data-ui-action="target-profile">Target profile</button><button data-ui-action="jpeg-texture">JPEG target</button><button data-ui-action="sprite-atlas">PNG projectile · animate</button><button data-ui-action="fbx-companion">FBX target · animate</button><span data-ui-slot="asset-lab-status"></span></details><span data-ui-slot="crosshair"></span><span data-ui-slot="hint"></span><span data-ui-slot="lock-status"></span><div data-ui-slot="popups"></div></section>', css: '' }, initialMode: 'topdown', onToggle: () => undefined, host });
    hud.setAssetLabActionHandler((action) => {
      actions.push(action);
      return action === 'sprite-atlas'
        ? { text: 'PNG atlas projectile active · fire to confirm the four-frame hit', state: 'active' }
        : { text: 'JPEG target texture active', state: 'active' };
    });
    hud.setScore(12);
    hud.setTargetStatus('TARGET · RedBox · 84/100 HP · +10', 'damaged');
    hud.setMode('orbit');
    hud.setChargeStatus('Charging · 80% · release to fire', 'charging');
    hud.setComboStatus('Combo x1.25 · 2 hits · 1.6s', 'active');
    hud.floatScore('+10', 20, 30);
    const assetHost = host.querySelector<HTMLElement>('[data-ui-asset="test"]');
    expect(assetHost).not.toBeNull();
    expect(assetHost?.shadowRoot?.textContent).toContain('Score  12');
    expect(assetHost?.shadowRoot?.textContent).toContain('Mission 1/3 · Score 50 · 12/50');
    expect(assetHost?.shadowRoot?.textContent).toContain('TARGET · RedBox · 84/100 HP · +10');
    expect(assetHost?.shadowRoot?.textContent).toContain('Charging · 80% · release to fire');
    expect(assetHost?.shadowRoot?.textContent).toContain('Combo x1.25 · 2 hits · 1.6s');
    expect(assetHost?.shadowRoot?.textContent).toContain('View: Orbit');
    expect(assetHost?.shadowRoot?.querySelector<HTMLDetailsElement>('.asset-lab')?.open).toBe(false);
    expect(assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="target-profile"]')?.disabled).toBe(true);
    assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="jpeg-texture"]')?.click();
    expect(actions).toEqual(['jpeg-texture']);
    expect(assetHost?.shadowRoot?.textContent).toContain('JPEG target texture active');
    assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="sprite-atlas"]')?.click();
    expect(actions).toEqual(['jpeg-texture', 'sprite-atlas']);
    expect(assetHost?.shadowRoot?.textContent).toContain('PNG atlas projectile active · fire to confirm the four-frame hit');
    expect(assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="fbx-companion"]')?.disabled).toBe(true);
    hud.setScore(50);
    expect(assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="target-profile"]')?.disabled).toBe(false);
    expect(assetHost?.shadowRoot?.textContent).toContain('Mission 2/3 · Press P');
    hud.setTargetProfileActive(true);
    expect(assetHost?.shadowRoot?.textContent).toContain('Mission 3/3 · Hit the rotating precision target');
    expect(assetHost?.shadowRoot?.querySelector('[data-ui-slot="mission"]')?.getAttribute('data-complete')).toBe('false');
    hud.setTargetProfileActive(true, 1);
    expect(assetHost?.shadowRoot?.textContent).toContain('Mission complete · Precision hit confirmed · R to replay');
    expect(assetHost?.shadowRoot?.querySelector('[data-ui-slot="mission"]')?.getAttribute('data-complete')).toBe('true');
    expect(assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="fbx-companion"]')?.disabled).toBe(false);
    hud.setScore(0);
    hud.setTargetProfileActive(false);
    expect(assetHost?.shadowRoot?.querySelector<HTMLButtonElement>('[data-ui-action="target-profile"]')?.disabled).toBe(true);
    hud.setChargeStatus('Hold C to charge · release to fire', 'ready');
    hud.setComboStatus('Combo ready · chain hits for a bonus', 'ready');
    expect(assetHost?.shadowRoot?.textContent).toContain('Mission 1/3 · Score 50 · 0/50');
    expect(assetHost?.shadowRoot?.textContent).toContain('hold C charge · release');
    hud.dispose();
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});

describe('game-default authored charge HUD', () => {
  it('projects charge state and progress into the authored meter slot', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const hud = installHud({
      asset: {
        guid: 'charge-test',
        html: '<section><aside data-ui-slot="charge"><strong data-ui-slot="charge-label"></strong><span data-ui-slot="charge-meter"><span data-ui-slot="charge-fill"></span></span></aside></section>',
        css: '',
      },
      initialMode: 'topdown',
      onToggle: () => undefined,
      host,
    });
    hud.setChargeStatus('Charging · 80% · release to fire', 'charging', 0.8);
    const charge = host.querySelector<HTMLElement>('[data-ui-asset="charge-test"]')?.shadowRoot?.querySelector<HTMLElement>('[data-ui-slot="charge"]');
    expect(charge?.dataset.state).toBe('charging');
    expect(charge?.querySelector('[data-ui-slot="charge-label"]')?.textContent).toContain('Charging · 80%');
    expect(charge?.querySelector('[data-ui-slot="charge-meter"]')?.getAttribute('aria-valuenow')).toBe('80');
    expect((charge?.querySelector<HTMLElement>('[data-ui-slot="charge-fill"]')?.style.width)).toBe('80%');
    hud.setChargeStatus('Charged shot released · impact x2.5', 'released', 1);
    expect(charge?.dataset.state).toBe('released');
    expect(charge?.querySelector('[data-ui-slot="charge-meter"]')?.getAttribute('aria-valuenow')).toBe('100');
    hud.dispose();
    host.remove();
  });
});

describe('game-default player controls', () => {
  it('keeps mission and guided asset actions while retiring gallery hotkeys', () => {
    const actions = GAME_DEFAULT_INPUT_MAP.map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['shoot', 'charge', 'reset', 'targetProfile', 'jpegTexture', 'videoTexture', 'spriteAtlas', 'fontSource']));
    expect(actions).not.toEqual(expect.arrayContaining(['projectileVisual', 'meshHandle', 'fbxMesh', 'glbMesh', 'gltfMesh', 'vfxHit', 'vfxCharge', 'visibility']));
  });
});
