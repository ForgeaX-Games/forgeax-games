import { describe, expect, it } from 'vitest';
import { createGameSettingsState, mountSettings, restoreFocus, SETTINGS_UI_GUID } from '../settings';

describe('settings focus edges', () => {
  it('uses fallback when the previous target was disconnected', () => {
    const previous = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(fallback);
    restoreFocus(previous, fallback);
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });

  it('restores sibling inert state when disposed while open', () => {
    const root = document.createElement('div');
    const sibling = document.createElement('aside');
    const fallback = document.createElement('button');
    root.append(sibling);
    document.body.append(root, fallback);
    const handle = mountSettings(
      { guid: SETTINGS_UI_GUID, html: '<section role="dialog" hidden><div role="document" tabindex="-1"><button data-ui-action="close-settings">Done</button></div></section>', css: '' },
      root,
      createGameSettingsState(),
      fallback,
    );
    expect(handle).not.toBeNull();
    handle?.open();
    expect(sibling.inert).toBe(true);
    handle?.dispose();
    expect(sibling.inert).toBe(false);
    root.remove();
    fallback.remove();
  });
});
