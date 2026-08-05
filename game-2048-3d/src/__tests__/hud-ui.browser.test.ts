import { describe, expect, it } from 'vitest';
import { installHud } from '../hud';

describe('game-default HUD consumer', () => {
  it('projects score, mode and popup into one disposable host', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const hud = installHud({ asset: { guid: 'test', html: '<section><span data-ui-slot="score"></span><button data-ui-action="toggle-mode"></button><span data-ui-slot="crosshair"></span><span data-ui-slot="hint"></span><span data-ui-slot="lock-status"></span><div data-ui-slot="popups"></div></section>', css: '' }, initialMode: 'topdown', onToggle: () => undefined, host });
    hud.setScore(12);
    hud.setMode('orbit');
    hud.floatScore('+10', 20, 30);
    const assetHost = host.querySelector<HTMLElement>('[data-ui-asset="test"]');
    expect(assetHost).not.toBeNull();
    expect(assetHost?.shadowRoot?.textContent).toContain('Score  12');
    expect(assetHost?.shadowRoot?.textContent).toContain('View: Orbit');
    hud.dispose();
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});
