import { Camera, Transform, perspective } from '@forgeax/engine-runtime';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { World } from '@forgeax/engine-ecs';
import { createGameState } from './src/core/game-state';
import { loadGame, saveGame } from './src/core/save-game';
import type { GamePhase, GameState } from './src/core/types';
import { tryBuildRoad } from './src/core/rules';
import { installAudio } from './src/systems/audio-system';
import {
  advancePhase,
  bootstrapNewGame,
  cancelScheduledAutoAdvance,
  humanBankTrade,
  humanBuildAtVertex,
  humanBuyDevCard,
  humanCancelDevelopMode,
  humanCompleteKnightRobber,
  humanCompleteMonopoly,
  humanConfirmSelectionIfReady,
  humanPlayDevCard,
  humanPlayerTrade,
  humanStartRoadMode,
  humanStartUpgradeMode,
  humanStartVillageMode,
  autoAdvanceDelayMs,
  scheduleAutoAdvanceUntilBlocked,
  setHumanSelection,
  setHumanTile,
  toggleSkipConfirm,
} from './src/systems/phase-controller';
import { installBoardUi } from './src/ui/board-ui';
import { installHowToPlay } from './src/ui/how-to-play';
import { installHud } from './src/ui/hud';
import { installMainMenu } from './src/ui/main-menu';

export function bootstrap(world: World, ctx?: BootstrapContext) {

  // Controlled UI boundary: mount all DOM into ctx.uiRoot (■ Stop removes the
  // whole container). Non-DOM side effects (audio, timers) register via
  // onCleanup so Stop flushes them in reverse order. Fall back to document.body
  // / no-op when the host does not provide them (web/dev, standalone export).
  const uiMount: HTMLElement =
    ctx?.uiRoot ?? (typeof document !== 'undefined' ? document.body : (undefined as never));
  const onCleanup = ctx?.registerCleanup ?? (() => {});

  const canvas = document.querySelector<HTMLCanvasElement>('#app') ?? document.querySelector('canvas');
  const aspect =
    canvas && canvas.clientWidth > 0
      ? Math.max(canvas.clientWidth / canvas.clientHeight, 16 / 9)
      : 16 / 9;

  world.spawn(
    { component: Transform, data: { posY: 8, posZ: 12 } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: 50, aspect, near: 0.1, far: 100 }),
        clearR: 0.05,
        clearG: 0.08,
        clearB: 0.14,
      },
    },
  ).unwrap();

  let state: GameState = createGameState();
  let activeSlotId: string | null = null;
  const audio = installAudio();
  const hud = installHud(uiMount);
  const boardUi = installBoardUi(uiMount);
  const mainMenu = installMainMenu(uiMount);
  const howTo = installHowToPlay(uiMount);

  // Non-DOM side effects that Stop must flush (reverse order): pending
  // auto-advance timer, then each component's own teardown (rAF loop / audio
  // elements + window listeners / ResizeObserver / injected <style>).
  onCleanup(() => cancelScheduledAutoAdvance());
  onCleanup(() => audio.dispose());
  onCleanup(() => hud.dispose());
  onCleanup(() => boardUi.dispose());
  onCleanup(() => mainMenu.dispose());
  onCleanup(() => howTo.dispose());

  hud.bind(state);

  function setGameVisible(visible: boolean): void {
    hud.setVisible(visible);
    boardUi.setVisible(visible);
  }

  function refresh() {
    hud.refresh();
    boardUi.refresh(state);
  }

  function clearTurnPresentation(): void {
    boardUi.clearTurnHighlights();
    hud.clearHarvestPops();
  }

  function applyHarvestFx(phaseBefore: GamePhase) {
    if (phaseBefore === 'turn_roll') {
      if (state.diceSum === 7) {
        boardUi.setRobberHighlight(state);
      } else if (state.phase === 'turn_harvest') {
        boardUi.setHarvestHighlight(state, state.diceSum);
      }
    }
    if (phaseBefore === 'turn_harvest') {
      const gains = state.lastHarvestGains;
      if (gains.length > 0) {
        hud.playHarvestPops(gains);
        boardUi.setHarvestHighlight(state, state.diceSum);
      }
      hud.refresh();
    }
  }

  function autoAdvanceHooks() {
    return {
      onStep(phaseBefore: GamePhase) {
        if (
          state.gameEnded ||
          (phaseBefore === 'turn_develop' && (state.phase === 'turn_roll' || state.phase === 'game_over'))
        ) {
          clearTurnPresentation();
        }
        if (phaseBefore === 'turn_roll') audio.playDice();
        applyHarvestFx(phaseBefore);
      },
      onRefresh: refresh,
    };
  }

  function afterPhaseStep(humanAction = false) {
    refresh();
    scheduleAutoAdvanceUntilBlocked(state, autoAdvanceHooks(), {
      initialDelayMs: humanAction ? 700 : 500,
    });
  }

  function enterGame(next: GameState, slotId: string | null = null, autoBootstrap = false) {
    cancelScheduledAutoAdvance();
    state = next;
    activeSlotId = slotId;
    if (autoBootstrap) {
      if (state.phase === 'init') bootstrapNewGame(state);
      if (state.skipConfirm) {
        scheduleAutoAdvanceUntilBlocked(state, autoAdvanceHooks(), { initialDelayMs: 600 });
      }
    }
    hud.bind(state);
    mainMenu.hide();
    hud.hidePauseMenu();
    setGameVisible(true);
    refresh();
    audio.startBgm();
  }

  function returnToMainMenu() {
    cancelScheduledAutoAdvance();
    clearTurnPresentation();
    hud.hidePauseMenu();
    setGameVisible(false);
    mainMenu.show();
    mainMenu.refresh();
  }

  function doSave(showToast = true): boolean {
    if (state.phase === 'init') {
      if (showToast) hud.flashToast('尚未开始，无法保存');
      return false;
    }
    const result = saveGame(state, activeSlotId);
    if (result.ok) activeSlotId = result.slotId;
    if (showToast) hud.flashToast(result.ok ? '游戏已保存' : '保存失败');
    return result.ok;
  }

  mainMenu.setCallbacks({
    onNewGame() {
      audio.playClick();
      activeSlotId = null;
      enterGame(createGameState(), null, true);
    },
    onLoadSave(slotId) {
      audio.playClick();
      const loaded = loadGame(slotId);
      if (!loaded) {
        mainMenu.refresh();
        return;
      }
      enterGame(loaded, slotId);
    },
    onShowHelp() {
      audio.playClick();
      howTo.show();
    },
  });

  hud.setCallbacks({
    onNextPhase() {
      cancelScheduledAutoAdvance();
      if (state.phase === 'turn_roll') audio.playDice();
      else audio.playClick();
      const before = state.phase;
      advancePhase(state);
      if (before === 'turn_develop' && (state.phase === 'turn_roll' || state.phase === 'game_over')) {
        clearTurnPresentation();
      }
      applyHarvestFx(before);
      refresh();
      scheduleAutoAdvanceUntilBlocked(state, autoAdvanceHooks(), {
        initialDelayMs: autoAdvanceDelayMs(before),
      });
    },
    onToggleSkipConfirm() {
      audio.playClick();
      toggleSkipConfirm(state, autoAdvanceHooks());
      refresh();
    },
    onBuildRoad() {
      audio.playClick();
      if (humanStartRoadMode(state)) refresh();
    },
    onBuildVillage() {
      audio.playClick();
      if (humanStartVillageMode(state)) refresh();
    },
    onUpgradeTown() {
      audio.playClick();
      if (humanStartUpgradeMode(state)) refresh();
    },
    onTrade() {
      /* trade panel always visible in bottom bar */
    },
    onBuyDevCard() {
      audio.playClick();
      if (humanBuyDevCard(state)) refresh();
    },
    onPlayDevCard(index) {
      audio.playClick();
      humanPlayDevCard(state, index);
      refresh();
    },
    onMonopolyPick(resource) {
      audio.playClick();
      if (humanCompleteMonopoly(state, resource)) refresh();
    },
    onCancelMode() {
      audio.playClick();
      humanCancelDevelopMode(state);
      refresh();
    },
    onBankTrade(give, receive) {
      audio.playClick();
      if (humanBankTrade(state, give, receive)) refresh();
    },
    onPlayerTrade(toId, offer, request) {
      audio.playClick();
      if (humanPlayerTrade(state, toId, offer, request)) refresh();
    },
    onSaveGame() {
      audio.playClick();
      doSave(true);
    },
    onReturnMainMenu() {
      audio.playClick();
      doSave(false);
      returnToMainMenu();
    },
    onShowHelp() {
      audio.playClick();
      howTo.show();
    },
  });

  boardUi.onVertexClick((vid) => {
    audio.playClick();
    if (state.phase === 'turn_develop' && (state.humanDevelopMode === 'village' || state.humanDevelopMode === 'upgrade')) {
      humanBuildAtVertex(state, vid);
      refresh();
      return;
    }
    setHumanSelection(state, vid, null);
    if (humanConfirmSelectionIfReady(state)) {
      afterPhaseStep(true);
    } else {
      refresh();
    }
  });

  boardUi.onEdgeClick((eid) => {
    audio.playClick();
    if (state.phase === 'turn_develop' && state.humanDevelopMode === 'road') {
      if (tryBuildRoad(state, state.currentPlayer, eid)) {
        // stay in road mode for multiple builds
      }
      refresh();
      return;
    }
    setHumanSelection(state, null, eid);
    if (humanConfirmSelectionIfReady(state)) {
      afterPhaseStep(true);
    } else {
      refresh();
    }
  });

  boardUi.onTileClick((tid) => {
    audio.playClick();
    if (state.phase === 'turn_develop' && state.humanDevelopMode === 'knight') {
      humanCompleteKnightRobber(state, tid);
      refresh();
      return;
    }
    setHumanTile(state, tid);
    if (humanConfirmSelectionIfReady(state)) {
      afterPhaseStep(true);
    } else {
      refresh();
    }
  });

  setGameVisible(false);
  mainMenu.show();
}
