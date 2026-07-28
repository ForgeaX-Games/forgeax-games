import type { CandyRole, CastSubmission, ElementTag, MaterialCard } from '../shared/types';
import type { CardDeck } from './CardDeck';

export interface ClassifiedCast {
  playerId: string;
  elements: ElementTag[];
  rarityScore: number;
  flavorTags: string[];
  /** Soft hint toward a role (not final — RoleAllocator decides). */
  bias: Partial<Record<CandyRole, number>>;
}

/**
 * Demo classifier: local tag table. Production may call cloud + local fallback.
 */
export class AiClassifier {
  constructor(private deck: CardDeck) {}

  classify(sub: CastSubmission): ClassifiedCast {
    const cards = sub.cardIds
      .map((id) => this.deck.byId(id))
      .filter((c): c is MaterialCard => !!c);

    const elements = cards.map((c) => c.element);
    const rarityScore = cards.reduce((s, c) => s + c.rarity, 0);
    const flavorTags = cards.flatMap((c) => c.flavorTags);

    const bias: Partial<Record<CandyRole, number>> = {
      soft: 0,
      melt: 0,
      hard: 0,
      burst: 0,
    };
    for (const c of cards) {
      if (c.element === 'glue') bias.soft! += c.rarity;
      if (c.element === 'fat') bias.melt! += c.rarity;
      if (c.element === 'crystal') bias.hard! += c.rarity;
      if (c.element === 'gas') bias.burst! += c.rarity;
    }

    return {
      playerId: sub.playerId,
      elements,
      rarityScore,
      flavorTags,
      bias,
    };
  }

  classifyAll(subs: CastSubmission[]): ClassifiedCast[] {
    return subs.map((s) => this.classify(s));
  }
}
