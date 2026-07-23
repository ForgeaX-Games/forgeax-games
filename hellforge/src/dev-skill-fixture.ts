// DEV-only skill-tree fixture — gated by import.meta.env.DEV AND ?hfSkillFixture=1.
// Production builds expose no control and ignore the query param.

import type { CharacterDomain, CharacterSnapshot } from './character-domain';
import type { SkillNodeId } from './content-ids';
import { emptySkillRanks } from './skill-tree';

export const HF_SKILL_FIXTURE_PARAM = 'hfSkillFixture';

export function isSkillFixtureEnabled(): boolean {
  // tsconfig.check.json pin `types` to bun/webgpu — no Vite ImportMeta.env.
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (!env?.DEV) return false;
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    return q.get(HF_SKILL_FIXTURE_PARAM) === '1';
  } catch {
    return false;
  }
}

/** Level-10 + 9 unspent points so every early node / capstone path is reachable. */
export function fixtureProgression(): {
  level: number;
  xp: number;
  unspentSkillPoints: number;
  skillRanks: Record<SkillNodeId, number>;
  hotbar: CharacterSnapshot['hotbar'];
  selectedHotbarSlot: 0 | 1 | 2 | 3;
} {
  return {
    level: 10,
    xp: 0,
    unspentSkillPoints: 9,
    skillRanks: emptySkillRanks(),
    hotbar: ['frost', 'magma', null, null],
    selectedHotbarSlot: 0,
  };
}

export interface SkillFixtureCallbacks {
  getDomain(): CharacterDomain;
  onChange(): void;
}

export interface SkillFixtureHandle {
  readonly enabled: boolean;
  dispose(): void;
}

/**
 * Mount a tiny DEV control that can apply/restore a progression snapshot for
 * exercising all 15 nodes. Returns a no-op handle in production / without the
 * query param — no DOM, no query-param side effects.
 */
export function installSkillFixture(
  mount: HTMLElement,
  cb: SkillFixtureCallbacks,
): SkillFixtureHandle {
  if (!isSkillFixtureEnabled()) {
    return { enabled: false, dispose: () => {} };
  }

  let backup: CharacterSnapshot | null = null;

  const root = document.createElement('div');
  root.id = 'hellforge-skill-fixture';
  root.setAttribute('data-hf-skill-fixture', '1');
  root.style.cssText =
    'position:absolute;right:12px;bottom:12px;z-index:200;pointer-events:auto;' +
    'display:flex;gap:6px;font:600 11px monospace;';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = '技能夹具';
  applyBtn.title = 'DEV: level 10 + 9 skill points';
  applyBtn.style.cssText =
    'padding:6px 10px;cursor:pointer;border:1px solid #e0b84a;background:#201808;color:#f5d878;';

  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.textContent = '还原';
  restoreBtn.disabled = true;
  restoreBtn.style.cssText =
    'padding:6px 10px;cursor:pointer;border:1px solid #666;background:#15100c;color:#aaa;';

  applyBtn.addEventListener('click', () => {
    const domain = cb.getDomain();
    if (!backup) backup = domain.snapshot() as CharacterSnapshot;
    domain.dispatch({ op: 'dev-set-progression', ...fixtureProgression() });
    restoreBtn.disabled = false;
    cb.onChange();
  });

  restoreBtn.addEventListener('click', () => {
    if (!backup) return;
    const domain = cb.getDomain();
    domain.dispatch({
      op: 'dev-set-progression',
      level: backup.level,
      xp: backup.xp,
      unspentSkillPoints: backup.unspentSkillPoints,
      skillRanks: backup.skillRanks as Record<SkillNodeId, number>,
      hotbar: backup.hotbar,
      selectedHotbarSlot: backup.selectedHotbarSlot,
    });
    backup = null;
    restoreBtn.disabled = true;
    cb.onChange();
  });

  root.append(applyBtn, restoreBtn);
  mount.appendChild(root);

  return {
    enabled: true,
    dispose: () => root.remove(),
  };
}
