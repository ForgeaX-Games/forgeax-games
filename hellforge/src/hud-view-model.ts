// Engine-agnostic HUD snapshot (SHELL-AND-UI-PORT-SPEC.md §5.1).
// ECS / main.ts assembles this each frame (or on change); hud.ts projects it
// onto the DOM. Hellforge ships a 4-slot domain hotbar + 2 belt potion cells;
// digit keys select skills (1-4), 5/6 drink potions.
// Skill points / tree invest live in the K panel (skill-panel.ts).

export interface SkillSlotState {
  /** Icon key (skill id) — hud renders ui-icons.skillIconImg, not a text glyph. */
  icon: string;
  name: string;
  key: string;
  manaCost: number;
  cooldownPct: number;
  locked: boolean;
  /** @deprecated Cast rights use learned ranks; kept for layout compat. */
  unlockLevel: number;
  affordable: boolean;
  /** Domain selectedHotbarSlot — sole selection authority (RMB cast target). */
  selected?: boolean;
  /** Empty hotbar slot (no ActiveSkillId assigned). */
  empty?: boolean;
  /** Belt potion slots (5/6): stock count badge. Absent on skill slots. */
  count?: number;
  /** Belt potion kind — hud renders the 40px red/blue belt cell instead of a skill cell. */
  potion?: 'life' | 'mana';
}

/** Current combat target readout (Spec §11.1) — no elite affixes in this slice. */
export interface TargetViewModel {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
}

export interface HudViewModel {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  xp: number;
  xpToNext: number;
  level: number;
  gold: number;
  kills: number;
  /** 4 active skills + 2 belt potion cells (aidiablo bar shape). */
  skills: SkillSlotState[];
  quest: string;
  areaName: string;
  boss: { name: string; hp: number; maxHp: number } | null;
  target: TargetViewModel | null;
}
