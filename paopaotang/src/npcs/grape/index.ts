import { get } from "../../localization";
import type { NpcDefinition } from '..';

export const npcBrainWiring: Pick<NpcDefinition, 'npcId' | 'soulId' | 'affordances'> = {
  npcId: 'grape', soulId: 'paopaotang.grape',
  affordances: [{ action: 'goto', params: { waypoint: { type: 'enum', source: 'waypoint' } } }, { action: 'follow', params: { target: { type: 'enum', source: 'nearby.id' } } }, { action: 'emote', params: { emote: { type: 'enum', source: 'literal', values: ['wave', 'cheer', 'ponder'] } } }],
};

export const npcDefinition = {
  ...npcBrainWiring, displayName: get("paopaotang.src/npcs/grape/index.ts:637:df9eaffa23"),
  body: { binding: 'resident:grape', prefix: 'NpcC', home: 'W_JUNC', workTalk: get("paopaotang.src/npcs/grape/index.ts:738:1ed5f4cca9") },
} satisfies NpcDefinition;
