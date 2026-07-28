// Hellforge crafting — forge recipes SSOT (拆解 / 重铸 / 三合一).
//
// Pure data + validators + result builders. Domain owns bag indices,
// material counters, and fail reasons; UI reads yields/costs/can* for
// button enablement. Mirrors meltGoldValue purity in items.ts.

import { rollItem, type ItemSlot, type ItemInstance, type Rarity } from './items';

/** Shard currency tiers (白/蓝/黄). Legendary has no shard tier. */
export type MaterialTier = 'common' | 'magic' | 'rare';

export type MaterialCounts = Readonly<Record<MaterialTier, number>>;

/**
 * Structural craft input — accepts DeepReadonly snapshot items (readonly
 * nested affixes) as well as plain Item/ItemInstance. Validators/builders
 * only read rarity/slot/ilvl.
 */
export type CraftItemView = {
  readonly rarity: Rarity;
  readonly slot: ItemSlot;
  readonly ilvl: number;
};

/** L5 salvage yield — also the re-roll cost for the matching tier. */
export const SALVAGE_YIELD: Readonly<Record<MaterialTier, number>> = {
  common: 2,
  magic: 3,
  rare: 4,
};

/** Re-roll shard cost = salvage yield (same table). */
export const REROLL_COST: Readonly<Record<MaterialTier, number>> = SALVAGE_YIELD;

function isMaterialTier(rarity: Rarity): rarity is MaterialTier {
  return rarity === 'common' || rarity === 'magic' || rarity === 'rare';
}

function emptyCounts(): Record<MaterialTier, number> {
  return { common: 0, magic: 0, rare: 0 };
}

function countsFor(tier: MaterialTier, n: number): MaterialCounts {
  const c = emptyCounts();
  c[tier] = n;
  return c;
}

/** common→magic→rare; rare is the ceiling (null). */
export function rarityStepUp(rarity: MaterialTier): MaterialTier | null {
  if (rarity === 'common') return 'magic';
  if (rarity === 'magic') return 'rare';
  return null;
}

/** Non-legendary craftable item — 拆解 / 重铸 input gate. */
export function canSalvage(item: CraftItemView): boolean {
  return isMaterialTier(item.rarity);
}

/** Same item gate as salvage; domain still checks shard balance. */
export function canReroll(item: CraftItemView): boolean {
  return isMaterialTier(item.rarity);
}

/**
 * 三合一: exactly 3 items, same ItemSlot, same rarity below rare.
 * Rare/legendary cannot fuse (ceiling / locked).
 */
export function canFuse(items: readonly CraftItemView[]): boolean {
  if (items.length !== 3) return false;
  const [a, b, c] = items;
  if (!a || !b || !c) return false;
  if (!isMaterialTier(a.rarity) || rarityStepUp(a.rarity) === null) return false;
  return a.slot === b.slot && a.slot === c.slot
    && a.rarity === b.rarity && a.rarity === c.rarity;
}

/** Shards granted by salvaging — null when item cannot be salvaged. */
export function salvageYield(item: CraftItemView): MaterialCounts | null {
  if (!canSalvage(item) || !isMaterialTier(item.rarity)) return null;
  return countsFor(item.rarity, SALVAGE_YIELD[item.rarity]);
}

/** Shards required to re-roll — equals salvageYield for that rarity. */
export function rerollCost(item: CraftItemView): MaterialCounts | null {
  if (!canReroll(item) || !isMaterialTier(item.rarity)) return null;
  return countsFor(item.rarity, REROLL_COST[item.rarity]);
}

/**
 * Re-roll result: fresh `rollItem(rarity, ilvl, slot)` — new affixes +
 * instanceId; slot/rarity/ilvl preserved.
 */
export function buildRerollResult(item: CraftItemView): ItemInstance | null {
  if (!canReroll(item)) return null;
  return rollItem(item.rarity, item.ilvl, item.slot);
}

/**
 * Fuse result: `rollItem(step(rarity), max(ilvlᵢ), slot)` with a fresh
 * instanceId. Null when `canFuse` fails.
 */
export function buildFuseResult(items: readonly CraftItemView[]): ItemInstance | null {
  if (!canFuse(items)) return null;
  const head = items[0]!;
  if (!isMaterialTier(head.rarity)) return null;
  const next = rarityStepUp(head.rarity);
  if (!next) return null;
  let maxIlvl = head.ilvl;
  for (let i = 1; i < items.length; i++) {
    const ilvl = items[i]!.ilvl;
    if (ilvl > maxIlvl) maxIlvl = ilvl;
  }
  return rollItem(next, maxIlvl, head.slot);
}
