// Veyra dialogue — four linear branches keyed by purge-slagdeep-hollow status.
// Dialogue reads quest state and exposes command intents; it does not mutate
// rewards or area access (Spec §9).

import type { NpcId, QuestId, QuestSave, QuestStatus } from './content-ids';
import { PURGE_QUEST_ID, QUEST_TITLE } from './quests';

export type DialogueAction =
  | { kind: 'continue' }
  | { kind: 'accept'; questId: QuestId }
  | { kind: 'turn-in'; questId: QuestId }
  | { kind: 'close' };

export interface DialogueChoice {
  readonly id: string;
  readonly label: string;
  readonly action: DialogueAction;
}

export interface DialogueNode {
  readonly npcId: NpcId;
  readonly speaker: string;
  readonly body: string;
  readonly choices: readonly DialogueChoice[];
  readonly questStatus: QuestStatus;
}

const VEYRA: NpcId = 'npc-cinderwarden-veyra';
const SPEAKER = '烬守者维拉';

const BRANCHES: Record<QuestStatus, { body: string; choices: readonly DialogueChoice[] }> = {
  available: {
    body:
      `旅人，熔渣深窟的裂口仍在喷吐余烬。接受「${QUEST_TITLE}」，穿过灰烬荒原，清剿穴内魔物与督军，再回来找我。`,
    choices: [
      {
        id: 'accept',
        label: '接受任务',
        action: { kind: 'accept', questId: PURGE_QUEST_ID },
      },
      {
        id: 'decline',
        label: '稍后再说',
        action: { kind: 'close' },
      },
    ],
  },
  active: {
    body:
      '深窟入口已为你敞开。先清尽穴内爪牙，再击败熔渣督军——两样都完成，再回来交差。',
    choices: [
      {
        id: 'continue',
        label: '这就去',
        action: { kind: 'close' },
      },
    ],
  },
  ready: {
    body:
      '你带回了督军倒下的气息。余烬哨站欠你一份谢礼——霜铸魔杖、经验与金币。准备好了就交还任务。',
    choices: [
      {
        id: 'turn-in',
        label: '交还任务',
        action: { kind: 'turn-in', questId: PURGE_QUEST_ID },
      },
      {
        id: 'later',
        label: '稍等片刻',
        action: { kind: 'close' },
      },
    ],
  },
  completed: {
    body:
      '深窟暂时沉寂了。霜铸魔杖既已在你手中，去荒原磨砺你的霜牙吧。若再有裂口，我会再唤你。',
    choices: [
      {
        id: 'farewell',
        label: '告辞',
        action: { kind: 'close' },
      },
    ],
  },
};

export function dialogueFor(
  npcId: NpcId,
  quests: Readonly<Record<QuestId, QuestSave>>,
): DialogueNode {
  if (npcId !== VEYRA) {
    return {
      npcId,
      speaker: '未知',
      body: '……',
      choices: [{ id: 'close', label: '离开', action: { kind: 'close' } }],
      questStatus: quests[PURGE_QUEST_ID]?.status ?? 'available',
    };
  }
  const status = quests[PURGE_QUEST_ID]?.status ?? 'available';
  const branch = BRANCHES[status];
  return {
    npcId: VEYRA,
    speaker: SPEAKER,
    body: branch.body,
    choices: branch.choices,
    questStatus: status,
  };
}
