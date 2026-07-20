// Engine-agnostic HUD snapshot (SHELL-AND-UI-PORT-SPEC.md §5.1).
// ECS / main.ts assembles this each frame (or on change); hud.ts projects it
// onto the DOM. Hellforge ships a 4-slot domain hotbar; digit keys select only.
// Skill points / tree invest live in the K panel (skill-panel.ts).

export interface SkillSlotState {
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
}

export interface EquipSlotState {
  icon: string;
  /** Rarity colour when filled; null = empty silhouette. */
  color: string | null;
  tooltip: string;
  /** Empty paper-doll / HUD chip (no ItemInstance in slot). */
  empty?: boolean;
  /** Slot label for empty silhouettes (武器 / 头盔 / …). */
  slotLabel?: string;
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
  /** Hellforge ships 4 active skills — not aidiablo's 6-slot bar. */
  skills: SkillSlotState[];
  equipment: EquipSlotState[];
  quest: string;
  areaName: string;
  boss: { name: string; hp: number; maxHp: number } | null;
  target: TargetViewModel | null;
}
