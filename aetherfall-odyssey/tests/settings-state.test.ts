import { describe, expect, it } from 'vitest';
import { applyGameSetting, createGameSettingsState } from '../assets/plugins/settings';

describe('game-default settings state', () => {
  it('updates only the current run memory state', () => {
    const state = createGameSettingsState();
    applyGameSetting(state, 'music', 35);
    applyGameSetting(state, 'musicMuted', true);
    applyGameSetting(state, 'highContrast', true);
    applyGameSetting(state, 'antialias', 'msaa');
    applyGameSetting(state, 'clearColor', 'purple');
    expect(state).toEqual({ music: 35, musicMuted: true, highContrast: true, antialias: 'msaa', bloom: true, clearColor: 'purple' });
    expect(createGameSettingsState()).toEqual({ music: 70, musicMuted: false, highContrast: false, antialias: 'fxaa', bloom: true, clearColor: 'sky' });
  });
});
