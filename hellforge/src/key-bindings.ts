// Key-binding manager — direct port of aidiablo's ui/KeyBindings.ts (pure
// logic, zero engine deps). Action → key map + localStorage persistence +
// auto-swap on conflict.
//
// KEY_ACTIONS below is hellforge's own action set (inventory/mode-toggle/
// 4 skill slots/respawn), not aidiablo's D2 panel list (skillTree/automap/
// questLog/achievements/chat/... none of which hellforge has). Not yet
// wired into main.ts's onKeyDown — no rebind UI exists to drive it, so it
// lands as ready infrastructure (same "orphan until a settings UI lands"
// state the SPEC accepts for CubeUI).
//
// Wiring note for whoever builds that settings UI: main.ts's onKeyDown
// switches on KeyboardEvent.code ('KeyI', 'Digit1', physical-layout,
// layout-independent), but matches() below compares KeyboardEvent.key
// ('i', '1', layout-dependent). Don't wire matches() straight into
// main.ts without picking one — either rebind stores e.code values and
// matches() switches to e.code, or main.ts's dispatch is rewritten to use
// e.key. Mixing the two silently breaks non-QWERTY layouts.

export interface KeyAction {
  id: string;
  label: string;
  defaultKey: string;
}

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'inventory',   label: '背包',       defaultKey: 'i' },
  { id: 'toggleMode',  label: '切换视角',   defaultKey: 'v' },
  { id: 'skill1',      label: '技能 1',     defaultKey: '1' },
  { id: 'skill2',      label: '技能 2',     defaultKey: '2' },
  { id: 'skill3',      label: '技能 3',     defaultKey: '3' },
  { id: 'skill4',      label: '技能 4',     defaultKey: '4' },
  { id: 'respawn',     label: '重生',       defaultKey: 'r' },
];

const STORAGE_KEY = 'hellforge.keybindings';

export class KeyBindings {
  private bindings: Map<string, string> = new Map();

  constructor() {
    this.loadDefaults();
    this.loadFromStorage();
  }

  private loadDefaults(): void {
    for (const action of KEY_ACTIONS) {
      this.bindings.set(action.id, action.defaultKey);
    }
  }

  private loadFromStorage(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const obj = JSON.parse(saved) as Record<string, string>;
        for (const [id, key] of Object.entries(obj)) {
          if (KEY_ACTIONS.some((a) => a.id === id)) {
            this.bindings.set(id, key);
          }
        }
      }
    } catch { /* ignore corrupt data */ }
  }

  private saveToStorage(): void {
    const obj: Record<string, string> = {};
    for (const [id, key] of this.bindings) {
      obj[id] = key;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  }

  /** Current key bound to an action. */
  getKey(actionId: string): string {
    return this.bindings.get(actionId) || '';
  }

  /** Whether a keyboard event matches an action's bound key. */
  matches(actionId: string, e: KeyboardEvent): boolean {
    const bound = this.bindings.get(actionId);
    if (!bound) return false;
    return e.key.toLowerCase() === bound.toLowerCase();
  }

  /** Rebind an action; swaps with whatever action already held that key (returns its id, or null). */
  setKey(actionId: string, newKey: string): string | null {
    const normalizedKey = newKey.toLowerCase();
    let swappedActionId: string | null = null;
    for (const [id, key] of this.bindings) {
      if (id !== actionId && key.toLowerCase() === normalizedKey) {
        const oldKey = this.bindings.get(actionId) || '';
        this.bindings.set(id, oldKey);
        swappedActionId = id;
        break;
      }
    }
    this.bindings.set(actionId, normalizedKey);
    this.saveToStorage();
    return swappedActionId;
  }

  resetToDefaults(): void {
    this.loadDefaults();
    this.saveToStorage();
  }

  /** All bindings for a settings-panel listing. */
  getAllBindings(): { action: KeyAction; currentKey: string }[] {
    return KEY_ACTIONS.map((action) => ({
      action,
      currentKey: this.bindings.get(action.id) || action.defaultKey,
    }));
  }

  static formatKey(key: string): string {
    const map: Record<string, string> = {
      'enter': 'Enter', 'escape': 'Esc', ' ': 'Space',
      'arrowup': '↑', 'arrowdown': '↓', 'arrowleft': '←', 'arrowright': '→',
      'tab': 'Tab', 'shift': 'Shift', 'control': 'Ctrl', 'alt': 'Alt',
      'backspace': 'Backspace', 'delete': 'Delete',
    };
    return map[key.toLowerCase()] || key.toUpperCase();
  }
}
