import { get } from "../../localization";
import type { NpcDefinition } from '..';

export const npcBrainWiring: Pick<NpcDefinition, 'npcId' | 'soulId' | 'affordances'> = {
  npcId: 'strawberry', soulId: 'paopaotang.strawberry',
  affordances: [{ action: 'goto', params: { waypoint: { type: 'enum', source: 'waypoint' } } }, { action: 'follow', params: { target: { type: 'enum', source: 'nearby.id' } } }, { action: 'emote', params: { emote: { type: 'enum', source: 'literal', values: ['wave', 'cheer', 'ponder'] } } }],
};

export const npcDefinition = {
  ...npcBrainWiring, displayName: get("paopaotang.src/npcs/strawberry/index.ts:647:54658e4758"),
  body: { binding: 'resident:strawberry', prefix: 'NpcD', home: 'HOUSE_D', workTalk: get("paopaotang.src/npcs/strawberry/index.ts:754:7fb12fb865") },
} satisfies NpcDefinition;
