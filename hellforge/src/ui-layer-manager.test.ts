import { describe, expect, test } from 'bun:test';
import { createUiLayerManager, type MajorPanel } from './ui-layer-manager';

function trackSurface() {
  const calls: Array<'show' | 'hide'> = [];
  return {
    calls,
    surface: {
      show: () => { calls.push('show'); },
      hide: () => { calls.push('hide'); },
    },
  };
}

describe('createUiLayerManager', () => {
  test('opening a panel closes the previous owner', () => {
    const inv = trackSurface();
    const skills = trackSurface();
    const ownership: Array<[MajorPanel | null, MajorPanel | null]> = [];
    const ui = createUiLayerManager({
      onOwnershipChange: (prev, next) => { ownership.push([prev, next]); },
    });
    ui.register('inventory', inv.surface);
    ui.register('skills', skills.surface);

    ui.open('inventory');
    expect(ui.active()).toBe('inventory');
    expect(inv.calls).toEqual(['show']);
    expect(ui.blocksWorldInput()).toBe(true);

    ui.open('skills');
    expect(ui.active()).toBe('skills');
    expect(inv.calls).toEqual(['show', 'hide']);
    expect(skills.calls).toEqual(['show']);
    expect(ownership).toEqual([
      [null, 'inventory'],
      ['inventory', 'skills'],
    ]);
  });

  test('dialogue has the same single-owner contract', () => {
    const dialogue = trackSurface();
    const settings = trackSurface();
    const ui = createUiLayerManager();
    ui.register('dialogue', dialogue.surface);
    ui.register('settings', settings.surface);

    ui.open('dialogue');
    expect(ui.active()).toBe('dialogue');
    expect(ui.blocksWorldInput()).toBe(true);

    ui.open('settings');
    expect(ui.active()).toBe('settings');
    expect(dialogue.calls).toEqual(['show', 'hide']);
    expect(settings.calls).toEqual(['show']);

    ui.close('settings');
    expect(ui.active()).toBeNull();
    expect(settings.calls).toEqual(['show', 'hide']);
    expect(ui.blocksWorldInput()).toBe(false);
  });

  test('blocksWorldInput is true when any major panel is open', () => {
    const ui = createUiLayerManager();
    expect(ui.blocksWorldInput()).toBe(false);

    // Unregistered panel still owns exclusivity (display no-op).
    ui.open('quests');
    expect(ui.active()).toBe('quests');
    expect(ui.blocksWorldInput()).toBe(true);

    ui.open('character');
    expect(ui.active()).toBe('character');
    expect(ui.blocksWorldInput()).toBe(true);

    ui.closeAll();
    expect(ui.active()).toBeNull();
    expect(ui.blocksWorldInput()).toBe(false);
  });

  test('close of a non-active panel is a no-op', () => {
    const inv = trackSurface();
    const ui = createUiLayerManager();
    ui.register('inventory', inv.surface);
    ui.open('inventory');
    ui.close('skills');
    expect(ui.active()).toBe('inventory');
    expect(inv.calls).toEqual(['show']);
  });

  test('re-opening the active panel does not re-fire show or ownership', () => {
    const inv = trackSurface();
    let changes = 0;
    const ui = createUiLayerManager({
      onOwnershipChange: () => { changes += 1; },
    });
    ui.register('inventory', inv.surface);
    ui.open('inventory');
    ui.open('inventory');
    expect(inv.calls).toEqual(['show']);
    expect(changes).toBe(1);
  });

  test('cutscene ownership is released only by explicitly closing cutscene', () => {
    const cutscene = trackSurface();
    const inventory = trackSurface();
    const ui = createUiLayerManager();
    ui.register('cutscene', cutscene.surface);
    ui.register('inventory', inventory.surface);

    ui.open('cutscene');
    ui.open('inventory');
    ui.closeAll();

    expect(ui.active()).toBe('cutscene');
    expect(cutscene.calls).toEqual(['show']);
    expect(inventory.calls).toEqual([]);

    ui.close('cutscene');
    ui.open('inventory');
    expect(ui.active()).toBe('inventory');
    expect(cutscene.calls).toEqual(['show', 'hide']);
    expect(inventory.calls).toEqual(['show']);
  });

  test('craft has the same single-owner exclusivity as inventory', () => {
    const craft = trackSurface();
    const inventory = trackSurface();
    const ui = createUiLayerManager();
    ui.register('craft', craft.surface);
    ui.register('inventory', inventory.surface);

    ui.open('craft');
    expect(ui.active()).toBe('craft');
    expect(craft.calls).toEqual(['show']);
    expect(ui.blocksWorldInput()).toBe(true);

    ui.open('inventory');
    expect(ui.active()).toBe('inventory');
    expect(craft.calls).toEqual(['show', 'hide']);
    expect(inventory.calls).toEqual(['show']);

    ui.close('inventory');
    ui.open('craft');
    expect(ui.active()).toBe('craft');
    expect(ui.blocksWorldInput()).toBe(true);
  });
});
