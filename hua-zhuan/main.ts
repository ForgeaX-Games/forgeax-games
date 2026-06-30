import { Camera, Transform, perspective } from '@forgeax/engine-runtime';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { World } from '@forgeax/engine-ecs';
import { createGameState } from './src/core/game-state';
import { installAudio } from './src/systems/audio-system';
import { advancePhase, finalizePendingTake, prepareTakeTurn, queueHumanAction } from './src/systems/phase-controller';
import { installBoardUi } from './src/ui/board-ui';
import { installHud } from './src/ui/hud';
import { installTurnHintUi } from './src/ui/turn-hint-ui';
import { installScoringGuideUi } from './src/ui/scoring-guide-ui';
import { installGameOverModal } from './src/ui/game-over-modal';
import { syncTakeSelection } from './src/ui/take-interaction';
import { createTakeSelection } from './src/ui/take-selection';
import type { TakeSource, TileColor } from './src/core/types';

export function bootstrap(world: World, ctx?: BootstrapContext) {

  const canvas = document.querySelector<HTMLCanvasElement>('#app') ?? document.querySelector('canvas');
  const aspect =
    canvas && canvas.clientWidth > 0
      ? canvas.clientWidth / canvas.clientHeight
      : 16 / 9;

  world.spawn(
    { component: Transform, data: { posY: 2, posZ: 5 } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: 50, aspect, near: 0.1, far: 100 }),
        clearR: 0.12,
        clearG: 0.14,
        clearB: 0.2,
      },
    },
  ).unwrap();

  const state = createGameState();
  const audio = installAudio();
  const selection = createTakeSelection();
  const hud = installHud();
  const turnHint = installTurnHintUi();
  const scoringGuide = installScoringGuideUi();
  const gameOverModal = installGameOverModal();
  const boardUi = installBoardUi({
    selection,
    onSourceColorPick: (source, color) => {
      if (state.phase !== 'take_turn' || !state.players[state.currentPlayer]!.isHuman) return;
      audio.playClick();
      state.pendingAction = null;
      selection.setSourceColor(source, color);
      state.nextButtonLabel = '（请选择图案行）';
      refresh();
    },
    onPatternRowPick: (row) => {
      if (state.phase !== 'take_turn' || !state.players[state.currentPlayer]!.isHuman) return;
      const sel = selection.get();
      if (!sel.source || sel.color === null) return;
      audio.playClick();
      selection.setTargetRow(row);
      queueHumanAction(state, { source: sel.source, color: sel.color, targetRow: row });
      refresh();
    },
  });

  hud.bind(state, selection, () => turnHint.isAutoAiEnabled());

  let takeInFlight = false;
  let autoTakeQueued = false;

  async function runTakeTurnFlow(): Promise<void> {
    if (takeInFlight || state.phase !== 'take_turn') return;

    const p = state.players[state.currentPlayer]!;
    if (p.isHuman) {
      if (!state.pendingAction) return;
    } else if (!turnHint.isAutoAiEnabled()) {
      if (!state.pendingAction) return;
    } else {
      const prep = prepareTakeTurn(state);
      if (prep === 'skipped') {
        refresh();
        scheduleAutoTake();
        return;
      }
      if (prep !== 'pending' || !state.pendingAction) return;
    }

    takeInFlight = true;
    const action = state.pendingAction!;
    refresh();
    await boardUi.playTakeFlight(state, action, () => {
      finalizePendingTake(state);
      syncTakeSelection(state, selection);
      selection.clear();
    });
    takeInFlight = false;
    refresh();
    scheduleAutoTake();
  }

  function scheduleAutoTake(): void {
    if (autoTakeQueued) return;
    autoTakeQueued = true;
    queueMicrotask(() => {
      autoTakeQueued = false;
      void runTakeTurnFlow();
    });
  }

  function refresh() {
    syncTakeSelection(state, selection);
    hud.refresh();
    boardUi.refresh(state);
    turnHint.refresh(state);
    scoringGuide.refresh(state);
    gameOverModal.refresh(state);
    scheduleAutoTake();
  }

  selection.subscribe(() => refresh());

  turnHint.onAutoAiChange(() => {
    refresh();
    scheduleAutoTake();
  });

  gameOverModal.onRestart(() => {
    audio.playClick();
    advancePhase(state);
    selection.clear();
    refresh();
  });

  hud.onNextPhase(() => {
    void (async () => {
      audio.playClick();
      if (state.phase === 'take_turn') {
        if (!state.players[state.currentPlayer]!.isHuman && turnHint.isAutoAiEnabled()) return;
        const prep = prepareTakeTurn(state);
        if (prep === 'skipped') {
          refresh();
          return;
        }
        if (prep === 'human_wait' && !state.pendingAction) return;
        await runTakeTurnFlow();
      } else {
        advancePhase(state);
      }
      selection.clear();
      refresh();
    })();
  });

  hud.onHumanTake((action) => {
    audio.playClick();
    if (queueHumanAction(state, action)) refresh();
  });

  hud.onSelectionChange((source: TakeSource, color: TileColor) => {
    state.pendingAction = null;
    selection.setSourceColor(source, color);
    state.nextButtonLabel = '（请选择图案行）';
    refresh();
  });

  hud.onRowPick((row) => {
    const sel = selection.get();
    if (!sel.source || sel.color === null) return;
    selection.setTargetRow(row);
    queueHumanAction(state, { source: sel.source, color: sel.color, targetRow: row });
    refresh();
  });

  refresh();
  audio.startBgm();
}
