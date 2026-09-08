import { err, ok, type Result } from '@forgeax/engine-types';

export interface DebugCommand {
  readonly id: string;
  /** Primary binding, using the literal value of KeyboardEvent.key. */
  readonly key: string;
  /** Fallback bindings for browser-reserved function keys. */
  readonly aliases?: readonly string[];
  readonly title: string;
  readonly run: () => void;
}

export type DebugCommandErrorCode = 'duplicate-id' | 'key-conflict';

export interface DebugCommandError {
  readonly code: DebugCommandErrorCode;
  readonly expected: string;
  readonly hint: string;
  readonly detail: {
    readonly id?: string;
    readonly key?: string;
    readonly conflictId?: string;
  };
}

export interface DebugCommandRegistry {
  readonly register: (
    command: DebugCommand,
  ) => Result<{ readonly dispose: () => void }, DebugCommandError>;
  readonly dispatch: (key: string) => boolean;
  readonly list: () => readonly DebugCommand[];
  readonly dispose: () => void;
}

function duplicateId(command: DebugCommand): DebugCommandError {
  return {
    code: 'duplicate-id',
    expected: 'each debug command to have a unique id',
    hint: `Choose a distinct command id; "${command.id}" is already registered.`,
    detail: { id: command.id },
  };
}

function keyConflict(key: string, command: DebugCommand, conflictId: string): DebugCommandError {
  return {
    code: 'key-conflict',
    expected: 'each primary key or alias to be owned by one command',
    hint: `Choose another key; "${key}" is already bound to "${conflictId}".`,
    detail: { id: command.id, key, conflictId },
  };
}

/** Create a deterministic, World- and DOM-independent command registry. */
export function createDebugCommandRegistry(): DebugCommandRegistry {
  const commands = new Map<string, DebugCommand>();
  const keys = new Map<string, string>();
  let disposed = false;

  const register = (
    command: DebugCommand,
  ): Result<{ readonly dispose: () => void }, DebugCommandError> => {
    if (disposed) {
      return err({
        code: 'duplicate-id',
        expected: 'an active debug command registry',
        hint: 'Create a new registry after dispose(); disposed registries cannot be reused.',
        detail: { id: command.id },
      });
    }
    if (commands.has(command.id)) return err(duplicateId(command));
    const commandKeys = [command.key, ...(command.aliases ?? [])];
    const seenKeys = new Set<string>();
    for (const key of commandKeys) {
      if (seenKeys.has(key)) {
        return err(keyConflict(key, command, command.id));
      }
      seenKeys.add(key);
      const conflictId = keys.get(key);
      if (conflictId !== undefined) return err(keyConflict(key, command, conflictId));
    }

    commands.set(command.id, command);
    for (const key of commandKeys) keys.set(key, command.id);
    let released = false;
    return ok({
      dispose: () => {
        if (released) return;
        released = true;
        if (commands.get(command.id) !== command) return;
        commands.delete(command.id);
        for (const key of commandKeys) {
          if (keys.get(key) === command.id) keys.delete(key);
        }
      },
    });
  };

  return {
    register,
    dispatch: (key) => {
      if (disposed) return false;
      const id = keys.get(key);
      if (id === undefined) return false;
      commands.get(id)?.run();
      return true;
    },
    list: () => [...commands.values()],
    dispose: () => {
      if (disposed) return;
      disposed = true;
      commands.clear();
      keys.clear();
    },
  };
}
