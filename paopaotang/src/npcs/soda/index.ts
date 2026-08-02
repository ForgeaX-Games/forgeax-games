import { get } from "../../localization";
import type { NpcDefinition } from '..';

export const npcBrainWiring: Pick<NpcDefinition, 'npcId' | 'soulId' | 'affordances'> = {
  npcId: 'soda', soulId: 'paopaotang.soda',
  affordances: [{ action: 'goto', params: { waypoint: { type: 'enum', source: 'waypoint' } } }, { action: 'follow', params: { target: { type: 'enum', source: 'nearby.id' } } }, { action: 'emote', params: { emote: { type: 'enum', source: 'literal', values: ['wave', 'cheer', 'ponder'] } } }],
};

export const npcDefinition = {
  ...npcBrainWiring, displayName: get("paopaotang.src/npcs/soda/index.ts:635:dc120f06ef"),
  body: { binding: 'resident:soda', prefix: 'NpcB', home: 'HOUSE_B', workTalk: get("paopaotang.src/npcs/soda/index.ts:736:ac5515b22e") },
} satisfies NpcDefinition;
