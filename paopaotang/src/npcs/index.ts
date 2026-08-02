import type { Affordance } from '@forgeax/npc-client';

export interface NpcDefinition {
  readonly npcId: string;
  readonly soulId: string;
  readonly displayName: string;
  readonly body: Readonly<{
    binding: string;
    prefix: string;
    home: string;
    workTalk: string;
  }>;
  readonly affordances: readonly Affordance[];
  readonly behavior?: Readonly<Record<string, unknown>>;
}

// Stable pack IDs map to residents as follows:
//  localized comment
// <forgeax:npc-registry>
import { npcDefinition as npc0 } from './pudding';
import { npcDefinition as npc1 } from './soda';
import { npcDefinition as npc2 } from './grape';
import { npcDefinition as npc3 } from './strawberry';
import { npcDefinition as npc4 } from './guide';

export const npcDefinitions: readonly NpcDefinition[] = [
  npc0,
  npc1,
  npc2,
  npc3,
  npc4,
];
// </forgeax:npc-registry>

export const npcDefinitionById: ReadonlyMap<string, NpcDefinition> = new Map(
  npcDefinitions.map((definition) => [definition.npcId, definition]),
);
