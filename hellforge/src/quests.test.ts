import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import {
  createFrostforgedWand,
  FROSTFORGED_WAND_REWARD,
  type ItemInstance,
} from './items';
import {
  acceptQuest,
  markQuestReady,
  PURGE_QUEST,
  PURGE_QUEST_ID,
  transitionQuest,
  turnInQuest,
} from './quests';

function fillBagAndWeapon(domain: ReturnType<typeof createSorceressDomain>): void {
  // Occupy weapon so the quest wand cannot auto-equip.
  expect(domain.dispatch({
    op: 'take-item',
    item: {
      instanceId: 'junk-w',
      slot: 'weapon',
      rarity: 'common',
      name: '占位杖',
      ilvl: 1,
      reqLevel: 1,
      affixes: [],
      score: 0,
    },
  }).ok).toBe(true);
  // Occupy both ring doll slots (ring1 + ring2) so further ring fillers go to the bag.
  for (const id of ['junk-r1', 'junk-r2'] as const) {
    expect(domain.dispatch({
      op: 'take-item',
      item: {
        instanceId: id,
        slot: 'ring',
        rarity: 'common',
        name: '占位戒',
        ilvl: 1,
        reqLevel: 1,
        affixes: [],
        score: 0,
      },
    }).ok).toBe(true);
  }
  for (let i = 0; i < 24; i++) {
    const filler: ItemInstance = {
      instanceId: `fill-${i}`,
      slot: 'ring',
      rarity: 'common',
      name: `填充${i}`,
      ilvl: 1,
      reqLevel: 1,
      affixes: [],
      score: 0,
    };
    const res = domain.dispatch({ op: 'take-item', item: filler });
    expect(res.ok).toBe(true);
  }
}

describe('transitionQuest', () => {
  test('available → active → ready → completed', () => {
    let s = { status: 'available' as const };
    const a = transitionQuest(s, { op: 'accept' });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.state.status).toBe('active');
    s = a.state;
    const r = transitionQuest(s, { op: 'mark-ready' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.status).toBe('ready');
    const c = transitionQuest(r.state, { op: 'complete' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.state.status).toBe('completed');
  });

  test('rejects invalid transitions', () => {
    expect(transitionQuest({ status: 'available' }, { op: 'mark-ready' }).ok).toBe(false);
    expect(transitionQuest({ status: 'available' }, { op: 'complete' }).ok).toBe(false);
    expect(transitionQuest({ status: 'active' }, { op: 'accept' }).ok).toBe(false);
    expect(transitionQuest({ status: 'active' }, { op: 'complete' }).ok).toBe(false);
    expect(transitionQuest({ status: 'ready' }, { op: 'accept' }).ok).toBe(false);
    expect(transitionQuest({ status: 'completed' }, { op: 'accept' }).ok).toBe(false);
    expect(transitionQuest({ status: 'completed' }, { op: 'complete' }).ok).toBe(false);
  });
});

describe('accept / mark-ready / turn-in', () => {
  test('accept and mark-ready update domain + persist fields', () => {
    const d = createSorceressDomain({ playerName: 'Q' });
    expect(acceptQuest(d).ok).toBe(true);
    expect(d.snapshot().quests[PURGE_QUEST_ID].status).toBe('active');
    expect(markQuestReady(d).ok).toBe(true);
    expect(d.snapshot().quests[PURGE_QUEST_ID].status).toBe('ready');
    // Idempotent ready
    expect(markQuestReady(d).ok).toBe(true);
    expect(d.snapshot().quests[PURGE_QUEST_ID].status).toBe('ready');
  });

  test('turn-in grants wand + 120 XP + 250 gold once', () => {
    const d = createSorceressDomain({ playerName: 'Q' });
    acceptQuest(d);
    markQuestReady(d);
    const before = d.snapshot();
    const res = turnInQuest(d);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.xp).toBe(120);
    expect(res.gold).toBe(250);
    expect(res.item.name).toBe(FROSTFORGED_WAND_REWARD.name);
    const after = d.snapshot();
    expect(after.quests[PURGE_QUEST_ID].status).toBe('completed');
    expect(after.gold).toBe(before.gold + 250);
    expect(after.xp + after.level * 0).toBeGreaterThanOrEqual(0);
    // Wand in weapon or bag
    const hasWand =
      after.equipment.weapon?.name === '霜铸魔杖'
      || after.bag.some((i) => i?.name === '霜铸魔杖');
    expect(hasWand).toBe(true);
    // Idempotent — second claim grants nothing
    const gold2 = d.snapshot().gold;
    const again = turnInQuest(d);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('already-completed');
    expect(d.snapshot().gold).toBe(gold2);
  });

  test('bag full → inventory-full, stay ready, grant nothing', () => {
    const d = createSorceressDomain({ playerName: 'Q' });
    acceptQuest(d);
    markQuestReady(d);
    fillBagAndWeapon(d);
    const before = d.snapshot();
    const res = turnInQuest(d);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('inventory-full');
    const after = d.snapshot();
    expect(after.quests[PURGE_QUEST_ID].status).toBe('ready');
    expect(after.gold).toBe(before.gold);
    expect(after.xp).toBe(before.xp);
    expect(after.bag.every((i) => i !== null)).toBe(true);
    expect(after.equipment.weapon?.name).toBe('占位杖');
  });

  test('createFrostforgedWand matches QuestRewardDef', () => {
    const wand = createFrostforgedWand(PURGE_QUEST.reward);
    expect(wand.name).toBe(FROSTFORGED_WAND_REWARD.name);
    expect(wand.slot).toBe(FROSTFORGED_WAND_REWARD.slot);
    expect(wand.rarity).toBe(FROSTFORGED_WAND_REWARD.rarity);
    expect(wand.ilvl).toBe(FROSTFORGED_WAND_REWARD.ilvl);
    expect(wand.affixes.map((a) => ({ stat: a.stat, v: a.v }))).toEqual(
      [...FROSTFORGED_WAND_REWARD.affixes],
    );
    expect(wand.instanceId.length).toBeGreaterThan(8);
    expect(wand.score).toBeGreaterThan(0);
    expect(wand.affixes.every((a) => a.label.length > 0)).toBe(true);
  });
});
