import { describe, expect, it, vi } from 'vitest';
import { createDebugCommandRegistry } from '../debug/command-registry.ts';

const command = (id: string, key: string, run = vi.fn()) => ({
  id,
  key,
  title: id,
  run,
});

describe('M0 debug command registry', () => {
  it('registers and dispatches primary and alias keys', () => {
    const registry = createDebugCommandRegistry();
    const run = vi.fn();
    expect(registry.register({ ...command('hud.toggle', 'F1', run), aliases: ['Tab'] }).ok).toBe(true);
    expect(registry.dispatch('F1')).toBe(true);
    expect(registry.dispatch('Tab')).toBe(true);
    expect(registry.dispatch('unknown')).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate ids and key conflicts with recovery hints', () => {
    const registry = createDebugCommandRegistry();
    expect(registry.register(command('first', 'x')).ok).toBe(true);
    const duplicate = registry.register(command('first', 'y'));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.hint).toContain('first');
    const conflict = registry.register(command('second', 'x'));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe('key-conflict');
      expect(conflict.error.hint).toContain('first');
    }
  });

  it('disposes one registration and the whole registry idempotently', () => {
    const registry = createDebugCommandRegistry();
    const registration = registry.register(command('pause', 'p'));
    expect(registration.ok).toBe(true);
    if (registration.ok) {
      registration.value.dispose();
      registration.value.dispose();
    }
    expect(registry.list()).toHaveLength(0);
    registry.dispose();
    registry.dispose();
    expect(registry.dispatch('p')).toBe(false);
    expect(registry.list()).toHaveLength(0);
  });

  it('keeps the implemented function-key map conflict-free', () => {
    const registry = createDebugCommandRegistry();
    const commands = [
      ['hud.toggle', '`'],
      ['hud.runtime', 'F1'],
      ['hud.stats', 'F2'],
      ['hud.content', 'F3'],
      ['stress.toggle', 'F4', ['g']],
      ['combat.targetLines', 'F5', ['t']],
      ['combat.restart', 'r', ['R']],
      ['view.calibration', 'F9', ['v']],
      ['time.pause', 'p', ['P']],
      ['time.step', '.', ['>']],
    ] as const;
    for (const [id, key, aliases] of commands) {
      expect(registry.register({ ...command(id, key), ...(aliases === undefined ? {} : { aliases }) }).ok).toBe(true);
    }
    expect(registry.list()).toHaveLength(10);
    expect(registry.register(command('reserved.f6', 'F6')).ok).toBe(true);
    expect(registry.register(command('reserved.f7', 'F7')).ok).toBe(true);
    expect(registry.register(command('reserved.f8', 'F8')).ok).toBe(true);
  });
});
