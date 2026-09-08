import { describe, expect, it } from 'vitest';
import { showDevHudPage } from '../debug/dev-hud.ts';

describe('Brotato v2 debug dashboard navigation', () => {
  it('shows and selects the requested page instead of toggling it closed', () => {
    const state = { hudVisible: false };
    let page = 'content';
    const hud = { setPage: (next: 'runtime' | 'stats' | 'content') => { page = next; } };

    showDevHudPage(state, hud, 'runtime');

    expect(state.hudVisible).toBe(true);
    expect(page).toBe('runtime');
  });
});
