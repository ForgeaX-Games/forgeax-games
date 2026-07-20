// Quest state machine for purge-slagdeep-hollow (Spec §9).
// Pure transitions + transactional turn-in against CharacterDomain.
// CombatRunDomain owns transient objectives; this module never serializes them.

import type { QuestId, QuestSave, QuestStatus } from './content-ids';
import type { CharacterDomain } from './character-domain';
import {
  createFrostforgedWand,
  FROSTFORGED_WAND_REWARD,
  type ItemInstance,
  type QuestRewardDef,
} from './items';

export { FROSTFORGED_WAND_REWARD, type QuestRewardDef };

export const PURGE_QUEST_ID: QuestId = 'purge-slagdeep-hollow';

export const QUEST_TITLE = '清剿熔渣深窟';
export const QUEST_TITLE_EN = 'Purge Slagdeep Hollow';

export const QUEST_REWARD_XP = 120;
export const QUEST_REWARD_GOLD = 250;

export type QuestCommand =
  | { op: 'accept' }
  | { op: 'mark-ready' }
  | { op: 'complete' };

export type QuestTransitionFail =
  | 'invalid-transition'
  | 'already-completed'
  | 'not-available'
  | 'not-active'
  | 'not-ready';

export type QuestTransitionResult =
  | { ok: true; state: QuestSave }
  | { ok: false; reason: QuestTransitionFail };

export type TurnInResult =
  | {
      ok: true;
      state: QuestSave;
      xp: number;
      gold: number;
      item: ItemInstance;
    }
  | {
      ok: false;
      reason: 'inventory-full' | 'not-ready' | 'already-completed' | 'invalid-transition';
    };

export interface QuestDef {
  readonly id: QuestId;
  readonly title: string;
  readonly titleEn: string;
  readonly reward: QuestRewardDef;
  readonly xp: number;
  readonly gold: number;
}

export const PURGE_QUEST: QuestDef = {
  id: PURGE_QUEST_ID,
  title: QUEST_TITLE,
  titleEn: QUEST_TITLE_EN,
  reward: FROSTFORGED_WAND_REWARD,
  xp: QUEST_REWARD_XP,
  gold: QUEST_REWARD_GOLD,
};

const VALID: Record<QuestStatus, ReadonlySet<QuestCommand['op']>> = {
  available: new Set(['accept']),
  active: new Set(['mark-ready']),
  ready: new Set(['complete']),
  completed: new Set(),
};

export function transitionQuest(
  state: QuestSave,
  command: QuestCommand,
): QuestTransitionResult {
  if (state.status === 'completed') {
    return { ok: false, reason: 'already-completed' };
  }
  if (!VALID[state.status].has(command.op)) {
    if (command.op === 'accept' && state.status !== 'available') {
      return { ok: false, reason: 'not-available' };
    }
    if (command.op === 'mark-ready' && state.status !== 'active') {
      return { ok: false, reason: 'not-active' };
    }
    if (command.op === 'complete' && state.status !== 'ready') {
      return { ok: false, reason: 'not-ready' };
    }
    return { ok: false, reason: 'invalid-transition' };
  }
  switch (command.op) {
    case 'accept':
      return { ok: true, state: { status: 'active' } };
    case 'mark-ready':
      return { ok: true, state: { status: 'ready' } };
    case 'complete':
      return { ok: true, state: { status: 'completed' } };
    default: {
      const _e: never = command;
      return _e;
    }
  }
}

/**
 * Accept purge-slagdeep-hollow on the character domain.
 * Idempotent: already active/ready/completed → fail without mutation.
 */
export function acceptQuest(character: CharacterDomain, questId: QuestId = PURGE_QUEST_ID): QuestTransitionResult {
  const snap = character.snapshot();
  const current = snap.quests[questId];
  const next = transitionQuest(current, { op: 'accept' });
  if (!next.ok) return next;
  character.dispatch({ op: 'set-quest-status', questId, status: next.state.status });
  return next;
}

/**
 * Mark quest ready when both CombatRun objectives are complete.
 * Idempotent for already-ready/completed.
 */
export function markQuestReady(character: CharacterDomain, questId: QuestId = PURGE_QUEST_ID): QuestTransitionResult {
  const current = character.snapshot().quests[questId];
  if (current.status === 'ready' || current.status === 'completed') {
    return { ok: true, state: current };
  }
  const next = transitionQuest(current, { op: 'mark-ready' });
  if (!next.ok) return next;
  character.dispatch({ op: 'set-quest-status', questId, status: next.state.status });
  return next;
}

/**
 * Transactional turn-in: insert wand first; only then grant XP/gold and complete.
 * Bag full → inventory-full, grant nothing, remain ready. Success awards once.
 */
export function turnInQuest(
  character: CharacterDomain,
  questId: QuestId = PURGE_QUEST_ID,
): TurnInResult {
  const current = character.snapshot().quests[questId];
  if (current.status === 'completed') {
    return { ok: false, reason: 'already-completed' };
  }
  if (current.status !== 'ready') {
    return { ok: false, reason: 'not-ready' };
  }

  const item = createFrostforgedWand(PURGE_QUEST.reward);
  const take = character.dispatch({ op: 'take-item', item });
  if (!take.ok) {
    if (take.reason === 'bag-full') {
      return { ok: false, reason: 'inventory-full' };
    }
    return { ok: false, reason: 'invalid-transition' };
  }

  character.dispatch({ op: 'grant-xp', amount: PURGE_QUEST.xp });
  character.dispatch({ op: 'add-gold', amount: PURGE_QUEST.gold });
  const completed = transitionQuest({ status: 'ready' }, { op: 'complete' });
  if (!completed.ok) {
    // Item already inserted — force completed to avoid double-claim on retry.
    character.dispatch({ op: 'set-quest-status', questId, status: 'completed' });
    return {
      ok: true,
      state: { status: 'completed' },
      xp: PURGE_QUEST.xp,
      gold: PURGE_QUEST.gold,
      item,
    };
  }
  character.dispatch({ op: 'set-quest-status', questId, status: completed.state.status });
  return {
    ok: true,
    state: completed.state,
    xp: PURGE_QUEST.xp,
    gold: PURGE_QUEST.gold,
    item,
  };
}

export function questStatus(
  character: CharacterDomain,
  questId: QuestId = PURGE_QUEST_ID,
): QuestStatus {
  return character.snapshot().quests[questId].status;
}
