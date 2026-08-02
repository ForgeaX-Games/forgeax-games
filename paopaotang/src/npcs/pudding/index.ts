import { get } from "../../localization";
import type { NpcDefinition } from '..';

export const npcBrainWiring: Pick<NpcDefinition, 'npcId' | 'soulId' | 'affordances'> = {
  npcId: 'pudding', soulId: 'paopaotang.pudding',
  affordances: [{ action: 'goto', params: { waypoint: { type: 'enum', source: 'waypoint' } } }, { action: 'follow', params: { target: { type: 'enum', source: 'nearby.id' } } }, { action: 'emote', params: { emote: { type: 'enum', source: 'literal', values: ['wave', 'cheer', 'ponder'] } } }],
};

export const npcDefinition = {
  ...npcBrainWiring, displayName: get("paopaotang.src/npcs/pudding/index.ts:641:331fc04211"),
  body: { binding: 'resident:pudding', prefix: 'NpcA', home: 'HOUSE_A', workTalk: get("paopaotang.src/npcs/pudding/index.ts:745:d408e6508e") },
} satisfies NpcDefinition;
