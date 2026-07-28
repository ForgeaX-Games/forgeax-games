/** Tunables for Demo v0.1 — keep numbers here, not scattered. */

export const GAME_CONFIG = {
  title: '今晚别变回人',
  maxPlayers: 4,
  minPlayersToStart: 2,
  sugarCoatStart: 2,
  sugarCoatMax: 2,
  snapshotHz: 20,
  reconnectWindowSec: 120,
  minigameHardCapSec: 90,
  roomCodeLength: 4,
  castCardsPerPlayer: 3,
  demoChapterId: 'chapter_mx',
} as const;

export const ROLE_LABELS = {
  soft: '软糖',
  melt: '融糖',
  hard: '硬糖',
  burst: '爆糖',
} as const;

export const PHASE_LABELS = {
  Lobby: '大厅',
  LoadingCutscene: '坠入糖果世界',
  CauldronCasting: '坩埚投料',
  RoleReveal: '糖型揭晓',
  NarrativePlay: '影游',
  MinigameLoad: '小关加载',
  MinigamePlay: '小游戏',
  NodeSettle: '糖衣结算',
  FinaleNarrative: '终章影游',
  MatchResult: '结算',
} as const;
