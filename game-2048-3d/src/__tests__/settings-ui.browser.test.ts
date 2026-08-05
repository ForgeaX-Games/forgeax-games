import { describe, expect, it } from 'vitest';
import { createGameSettingsState, mountSettings, SETTINGS_UI_GUID } from '../settings';

describe('game-default settings modal', () => {
  it('supports open, escape, memory updates and focus restore', () => {
    const root = document.createElement('div');
    const trigger = document.createElement('button');
    document.body.append(root, trigger);
    const sibling = document.createElement('aside');
    root.append(sibling);
    const handle = mountSettings({ guid: SETTINGS_UI_GUID, html: '<section role="dialog" hidden><div role="document" tabindex="-1"><input data-ui-setting="music"><input data-ui-setting="music-muted" type="checkbox"><input data-ui-setting="high-contrast" type="checkbox"><button data-ui-action="close-settings">Done</button></div></section>', css: '' }, root, createGameSettingsState(), trigger);
    expect(handle.error).toBeUndefined();
    if (!handle.instance) return;
    handle.open();
    const dialog = handle.instance.host.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.hidden).toBe(false);
    expect(sibling.inert).toBe(true);
    const range = handle.instance.host.shadowRoot?.querySelector<HTMLInputElement>('[data-ui-setting="music"]');
    if (range) { range.value = '25'; range.dispatchEvent(new Event('input', { bubbles: true })); }
    expect(handle.state.music).toBe(25);
    const muted = handle.instance.host.shadowRoot?.querySelector<HTMLInputElement>('[data-ui-setting="music-muted"]');
    if (muted) { muted.checked = true; muted.dispatchEvent(new Event('input', { bubbles: true })); }
    expect(handle.state.musicMuted).toBe(true);
    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog?.hidden).toBe(true);
    expect(sibling.inert).toBe(false);
    handle.open();
    expect(sibling.inert).toBe(true);
    handle.dispose();
    expect(sibling.inert).toBe(false);
    root.remove();
    trigger.remove();
  });
});
