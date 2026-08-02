import { get } from "./localization-runtime";
//  localized comment
//  localized comment
//
// Used by main.ts:
//  localized comment
//   - ENEMY_DEATH_LINES: a jelly's dying words when the player blasts it
//  localized comment
//   - ENEMY_GLOAT_LINES: survivors gloating when the player dies
//   - PLAYER_WIN_LINE:   the player's closer after clearing the arena

export type Speaker = 'player' | 'enemy';
export interface BanterLine { who: Speaker; text: string }

// display names match enemyMats order in main.ts: purple / teal / orange
export const ENEMY_NAMES: readonly string[] = [get("paopaotang.src/trashtalk.ts:735:60d1fce67a"), get("paopaotang.src/trashtalk.ts:741:dda9fae1ef"), get("paopaotang.src/trashtalk.ts:747:69b2e07c66")];

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

//  localized comment
const INTRO_SCRIPTS: ReadonlyArray<ReadonlyArray<BanterLine>> = [
  [
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1025:844e907502") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1085:1ed76212e9") },
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1141:30ba9ab0c2") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1196:e169e2107a") },
  ],
  [
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1261:3e052cd97b") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1320:184a23e1dd") },
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1373:65a316d43e") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1429:47afbab43d") },
  ],
  [
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1493:533ef718a6") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1550:655779caec") },
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1607:ec1236f51a") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1659:4c1ecf1c23") },
  ],
  [
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1721:8e8b5e174a") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1777:499f0be27a") },
    { who: 'enemy', text: get("paopaotang.src/trashtalk.ts:1827:d9b0074a97") },
    { who: 'player', text: get("paopaotang.src/trashtalk.ts:1882:676d5bc7a7") },
  ],
];

export const pickIntroScript = (): ReadonlyArray<BanterLine> => pick(INTRO_SCRIPTS);

//  localized comment
export const ENEMY_DEATH_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:2132:f74ec9fb61"),
  get("paopaotang.src/trashtalk.ts:2158:721ef43d4a"),
  get("paopaotang.src/trashtalk.ts:2183:6db18ecd23"),
  get("paopaotang.src/trashtalk.ts:2213:5328ae25c7"),
  get("paopaotang.src/trashtalk.ts:2244:64b3d5cca9"),
  get("paopaotang.src/trashtalk.ts:2275:bb7017dc09"),
  get("paopaotang.src/trashtalk.ts:2300:432dc7cf0e"),
];

// ── the player claps back after a kill (60% chance, delayed a beat) ──────────
export const PLAYER_KILL_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:2470:3a407326f0"),
  get("paopaotang.src/trashtalk.ts:2493:3bb5cbc56b"),
  get("paopaotang.src/trashtalk.ts:2514:0d496f63f5"),
  get("paopaotang.src/trashtalk.ts:2532:e941f53450"),
  get("paopaotang.src/trashtalk.ts:2552:f685ff3c9b"),
];

// ── survivors gloat when the player dies (loud, mean, deserved) ─────────────
export const ENEMY_GLOAT_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:2709:34604a6e77"),
  get("paopaotang.src/trashtalk.ts:2739:26f3046dc8"),
  get("paopaotang.src/trashtalk.ts:2766:ff6d6ca9bc"),
  get("paopaotang.src/trashtalk.ts:2790:ed20043521"),
  get("paopaotang.src/trashtalk.ts:2819:561feb7253"),
  get("paopaotang.src/trashtalk.ts:2849:39af215363"),
];

// ── the player's closer after wiping the arena ───────────────────────────────
export const PLAYER_WIN_LINE = get("paopaotang.src/trashtalk.ts:2988:0852b0b249");

// ════════════════════════════════════════════════════════════════════════════
//  localized comment
// ════════════════════════════════════════════════════════════════════════════

//  localized comment
export const TOWN_CHAT_SCRIPTS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    get("paopaotang.src/trashtalk.ts:3394:82cfed5cea"),
    get("paopaotang.src/trashtalk.ts:3424:3cd3ae87a4"),
    get("paopaotang.src/trashtalk.ts:3446:ffa44afc06"),
  ],
  [
    get("paopaotang.src/trashtalk.ts:3480:0e4b5ebe7b"),
    get("paopaotang.src/trashtalk.ts:3506:750cd22053"),
    get("paopaotang.src/trashtalk.ts:3525:1b1b079d96"),
  ],
  [
    get("paopaotang.src/trashtalk.ts:3553:bc9ecb563e"),
    get("paopaotang.src/trashtalk.ts:3576:357c52d06a"),
    get("paopaotang.src/trashtalk.ts:3603:2b5117bc65"),
  ],
  [
    get("paopaotang.src/trashtalk.ts:3640:49241bf831"),
    get("paopaotang.src/trashtalk.ts:3666:e1877016ab"),
  ],
  [
    get("paopaotang.src/trashtalk.ts:3702:1508d58c05"),
    get("paopaotang.src/trashtalk.ts:3727:2f81fcec7e"),
    get("paopaotang.src/trashtalk.ts:3755:feb1708966"),
  ],
];

//  localized comment
export const HECKLE_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:3898:540439b1aa"),
  get("paopaotang.src/trashtalk.ts:3913:930e683711"),
  get("paopaotang.src/trashtalk.ts:3930:b7f698900d"),
  get("paopaotang.src/trashtalk.ts:3950:8eac494234"),
  get("paopaotang.src/trashtalk.ts:3970:08cfc6ac45"),
  get("paopaotang.src/trashtalk.ts:3984:f43dba88d9"),
  get("paopaotang.src/trashtalk.ts:4005:c702842995"),
];

//  localized comment
export const DUEL_TAUNTS: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:4151:c0c1f587ff"),
  get("paopaotang.src/trashtalk.ts:4178:eaea508a2e"),
  get("paopaotang.src/trashtalk.ts:4200:8d7181bc35"),
  get("paopaotang.src/trashtalk.ts:4222:6ada5de917"),
];
export const DUEL_WIN_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:4298:6c878c1553"),
  get("paopaotang.src/trashtalk.ts:4324:4bba9aaf8a"),
  get("paopaotang.src/trashtalk.ts:4341:f3bb40ce01"),
];
export const DUEL_LOSE_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:4412:8610fbe067"),
  get("paopaotang.src/trashtalk.ts:4433:0ccae48171"),
  get("paopaotang.src/trashtalk.ts:4453:c083b440ca"),
];

//  localized comment
// keyed by stable ResidentDef.key: pudding / soda / grape / strawberry
export const NPC_TALK_SCRIPTS: Readonly<Record<string, ReadonlyArray<ReadonlyArray<string>>>> = {
  pudding: [
    [
      get("paopaotang.src/trashtalk.ts:4743:f3c46d9620"),
      get("paopaotang.src/trashtalk.ts:4784:d6f19ae1d8"),
      get("paopaotang.src/trashtalk.ts:4812:effb33d430"),
    ],
    [
      get("paopaotang.src/trashtalk.ts:4857:1893774ff8"),
      get("paopaotang.src/trashtalk.ts:4890:944507d93a"),
      get("paopaotang.src/trashtalk.ts:4913:8cdceea407"),
    ],
  ],
  soda: [
    [
      get("paopaotang.src/trashtalk.ts:4973:7221687b4e"),
      get("paopaotang.src/trashtalk.ts:5010:e300b5d709"),
      get("paopaotang.src/trashtalk.ts:5040:1b19b94dfa"),
    ],
    [
      get("paopaotang.src/trashtalk.ts:5085:1cd7d60cc7"),
      get("paopaotang.src/trashtalk.ts:5115:e63917d339"),
      get("paopaotang.src/trashtalk.ts:5138:dd46bc0696"),
    ],
  ],
  grape: [
    [
      get("paopaotang.src/trashtalk.ts:5200:9d0d37bf2e"),
      get("paopaotang.src/trashtalk.ts:5234:9ade87e4eb"),
      get("paopaotang.src/trashtalk.ts:5256:ad97af1734"),
    ],
    [
      get("paopaotang.src/trashtalk.ts:5296:01f9a8fd88"),
      get("paopaotang.src/trashtalk.ts:5320:635caff79a"),
      get("paopaotang.src/trashtalk.ts:5338:2311c64ee8"),
    ],
  ],
  strawberry: [
    [
      get("paopaotang.src/trashtalk.ts:5398:28080c375b"),
      get("paopaotang.src/trashtalk.ts:5432:db83a04c33"),
      get("paopaotang.src/trashtalk.ts:5462:9f3e82fa44"),
    ],
    [
      get("paopaotang.src/trashtalk.ts:5505:f871fadedf"),
      get("paopaotang.src/trashtalk.ts:5543:77ea185f2c"),
      get("paopaotang.src/trashtalk.ts:5573:cf68597cfb"),
    ],
  ],
};
// safety net for any resident without a personal script
export const NPC_TALK_FALLBACK: ReadonlyArray<ReadonlyArray<string>> = [
  [
    get("paopaotang.src/trashtalk.ts:5750:9bd7194277"),
    get("paopaotang.src/trashtalk.ts:5789:23f9d5be4b"),
    get("paopaotang.src/trashtalk.ts:5805:65bcbdb19a"),
  ],
];

//  localized comment
export const REFEREE_NAME = get("paopaotang.src/trashtalk.ts:5940:a693082aed");
// pressing E at the booth while a duel is running
export const REFEREE_BUSY_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:6055:c8b4128556"),
  get("paopaotang.src/trashtalk.ts:6088:c31ea05cc4"),
  get("paopaotang.src/trashtalk.ts:6113:ecb553b8bc"),
];
export const REFEREE_SIGNUP_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:6207:bae4c0cdb0"),
  get("paopaotang.src/trashtalk.ts:6233:a8b9c85854"),
  get("paopaotang.src/trashtalk.ts:6262:1126de9326"),
];
export const REFEREE_DUEL_LINES: readonly string[] = [
  get("paopaotang.src/trashtalk.ts:6346:0d30d2acad"),
  get("paopaotang.src/trashtalk.ts:6374:1819aa778e"),
];
