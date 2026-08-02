import { get } from "../../localization";
import type { NpcDefinition } from '..';

// <forgeax:npc-brain-config>
export const npcBrainWiring: Pick<NpcDefinition, 'npcId' | 'soulId' | 'affordances'> = {
  npcId: "guide",
  soulId: "paopaotang.guide",
  affordances: [
  {
    "action": "goto",
    "params": {
      "waypoint": {
        "type": "enum",
        "source": "waypoint"
      }
    }
  },
  {
    "action": "emote",
    "params": {
      "emote": {
        "type": "enum",
        "source": "literal",
        "values": [
          "wave"
        ]
      }
    }
  },
],
};
// </forgeax:npc-brain-config>

/** Game-owned Body binding and behavior hooks. npc_wire only updates npcBrainWiring. */
export const npcDefinition = {
  ...npcBrainWiring,
  displayName: 'Guide',
  // Body: a dedicated humanoid rig authored into the scene pack (prefix 'Guide',
  // tools/add-guide-rig.mjs). Home = the fountain plaza, where new players spawn,
  // so the guide greets them the moment they arrive.
  body: {
    binding: 'resident:guide',
    prefix: 'Guide',
    home: 'PLAZA_E',
    workTalk: get("paopaotang.src/npcs/guide/index.ts:1057:22791f77ef"),
  },
  // 'guide' role: TownSim keeps this resident a patient greeter — it never clocks
  //  localized comment
  // steers it via goto/wave intents.
  behavior: { role: 'guide' },
} satisfies NpcDefinition;
