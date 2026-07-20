// Engine-agnostic HUD snapshot (SHELL-AND-UI-PORT-SPEC.md §5.1).
// ECS / main.ts assembles this each frame (or on change); hud.ts projects it
// onto the DOM. Adapted from aidiablo's PlayerSnapshot subset to hellforge's
// actual kit: 4 string-id skills (not 6 numeric), no skill-point spend, no
// Q/W potion belt (potions are ground-loot auto-pickup).

export interface SkillSlotState {
  icon: string;
  name: string;
  key: string;
  manaCost: number;
  cooldownPct: number;
  locked: boolean;
  unlockLevel: number;
  affordable: boolean;
}

export interface EquipSlotState {
  icon: string;
  color: string | null;
  tooltip: string;
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
  /** Hellforge ships 4 active skills — not aidiablo's 6-slot bar. */
  skills: SkillSlotState[];
  equipment: EquipSlotState[];
  quest: string;
  areaName: string;
  boss: { name: string; hp: number; maxHp: number } | null;
}
