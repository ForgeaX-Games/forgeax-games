import type { BootstrapContext, GameProjectionValue } from '@forgeax/engine-app';
import { defineSystem, Update, type World } from '@forgeax/engine-ecs';
import {
  createInputSnapshot,
  INPUT_MAP_KEY,
  INPUT_SNAPSHOT_RESOURCE_KEY,
  type ActionConfig,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { quat } from '@forgeax/engine-runtime';
import { Transform } from '@forgeax/engine-scene';
import { Camera, perspective, TONEMAP_REINHARD_EXTENDED } from '@forgeax/engine-render';
import type { UiAsset } from '@forgeax/engine-ui';

import {
  cloneGame,
  createGame,
  directionFromSwipe,
  move,
  restart,
  type Direction,
  type Game2048,
} from './src/game-2048';
import { BOARD_UI_GUID, mountGameUi } from './src/game-ui';
import { persistBestScore, readBestScore } from './src/best-score';

const KEY = (key: string) => ({ type: 'key', key } as const);
const INPUT_MAP: readonly ActionConfig[] = [
  { action: 'left', bindings: [KEY('ArrowLeft'), KEY('a'), KEY('A')] },
  { action: 'right', bindings: [KEY('ArrowRight'), KEY('d'), KEY('D')] },
  { action: 'up', bindings: [KEY('ArrowUp'), KEY('w'), KEY('W')] },
  { action: 'down', bindings: [KEY('ArrowDown'), KEY('s'), KEY('S')] },
  { action: 'restart', bindings: [KEY('r'), KEY('R')] },
  { action: 'undo', bindings: [KEY('u'), KEY('U')] },
];

export async function bootstrap(world: World, ctx?: BootstrapContext): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) throw new Error('2048 requires the host canvas #app');

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

  const cameraRotation = quat.create();
  quat.fromAxisAngle(cameraRotation, [1, 0, 0], -0.72);
  world.spawn(
    { component: Transform, data: { pos: [0, 7.8, 7.2], quat: [...cameraRotation] } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: Math.PI / 4, aspect: canvas.width / canvas.height || 1, near: 0.1, far: 80 }),
        tonemap: TONEMAP_REINHARD_EXTENDED,
        clearColor: [0.035, 0.045, 0.07, 1],
      },
    },
  ).unwrap();
  world.insertResource(INPUT_MAP_KEY, INPUT_MAP);
  const emptyInput = createInputSnapshot();
  const readInput = (): InputSnapshot => world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
    ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
    : emptyInput;

  let game: Game2048 = createGame();
  let previous: Game2048 | null = null;
  const scoreStorage = typeof window === 'undefined' ? undefined : window.localStorage;
  let best = readBestScore(scoreStorage);
  let touchStart: { x: number; y: number; id: number } | null = null;
  let projectedPointerStart: { x: number; y: number; id: number } | null = null;
  let projectedInputEvents = 0;
  let lastProjectedInput: unknown = null;

  if (!ctx?.assets) throw new Error('2048 requires the host AssetRegistry');
  const uiGuid = ctx.assets.parseGuid(BOARD_UI_GUID);
  const loadedUi = await ctx.assets.loadByGuid<UiAsset>(uiGuid);
  if (!loadedUi.ok) throw new Error(`2048 UI load failed (${loadedUi.error.code}): ${loadedUi.error.hint}`);

  const ui = mountGameUi(loadedUi.value, ctx.uiRoot ?? document.body, {
    onRestart: () => resetGame(),
    onUndo: () => undo(),
    onContinue: () => {
      game = { ...game, acknowledgedWin: true };
      render();
    },
    onMove: (direction) => { performMove(direction); },
  });
  ctx?.registerCleanup?.(() => ui.dispose());

  const render = (): void => {
    const nextBest = Math.max(best, game.score);
    if (nextBest !== best) {
      best = nextBest;
      persistBestScore(scoreStorage, best);
    }
    ui.render(game, best, previous !== null);
  };
  const resetGame = (): void => {
    previous = null;
    game = restart(game);
    render();
  };
  const undo = (): void => {
    if (!previous) return;
    game = previous;
    previous = null;
    render();
  };
  const performMove = (direction: Direction): boolean => {
    if (game.over) return false;
    const before = cloneGame(game);
    const result = move(game, direction);
    if (!result.changed) {
      ui.nudge(direction);
      return false;
    }
    previous = before;
    game = result.game;
    render();
    return true;
  };

  const inputSystem = defineSystem({
    name: '2048-input',
    queries: [] as const,
    after: ['input-frame-start-scan'],
    fn: () => {
      const input = readInput();
      const direction: Direction | null = input.action('left').justPressed() ? 'left'
        : input.action('right').justPressed() ? 'right'
          : input.action('up').justPressed() ? 'up'
            : input.action('down').justPressed() ? 'down'
              : null;
      if (direction) performMove(direction);
      if (input.action('restart').justPressed()) resetGame();
      if (input.action('undo').justPressed()) undo();

      for (const event of input.pointerEvents) {
        if (event.phase === 'down' && event.pointerType !== 'mouse') {
          touchStart = { x: event.x, y: event.y, id: event.pointerId };
        }
        if (event.phase === 'up' && touchStart?.id === event.pointerId) {
          const dx = event.x - touchStart.x;
          const dy = event.y - touchStart.y;
          touchStart = null;
          const direction = directionFromSwipe({ x: 0, y: 0 }, { x: dx, y: dy }, 24 * dpr);
          if (direction) performMove(direction);
        }
      }
    },
  });
  world.addSystem(Update, inputSystem);
  render();

  if (ctx?.gameProjection) {
    const disposers = [
      ctx.gameProjection.registerAction({
        id: 'input',
        title: 'Send gameplay input',
        description: 'Apply the standard typed gameplay input contract to this live 2048 run.',
        argsSchema: {
          type: 'object', required: ['type'],
          properties: {
            type: { type: 'string', enum: ['key', 'pointer'] },
            key: { type: 'string' },
            phase: { type: 'string', enum: ['down', 'move', 'up', 'cancel'] },
            x: { type: 'number' },
            y: { type: 'number' },
            pointerId: { type: 'number' },
            pointerType: { type: 'string', enum: ['mouse', 'touch', 'pen'] },
            button: { type: 'string', enum: ['left', 'middle', 'right'] },
          },
        },
        run: (args) => {
          projectedInputEvents += 1;
          lastProjectedInput = args;
          if (typeof args !== 'object' || args === null) return;
          const input = args as {
            type?: unknown; key?: unknown; phase?: unknown; x?: unknown; y?: unknown; pointerId?: unknown;
          };
          if (input.type === 'key' && input.phase === 'down' && typeof input.key === 'string') {
            const direction = directionForKey(input.key);
            if (direction) performMove(direction);
            else if (input.key.toLowerCase() === 'r') resetGame();
            else if (input.key.toLowerCase() === 'u') undo();
            return;
          }
          if (input.type !== 'pointer' || typeof input.x !== 'number' || typeof input.y !== 'number') return;
          const id = typeof input.pointerId === 'number' ? input.pointerId : 0;
          if (input.phase === 'down') projectedPointerStart = { x: input.x, y: input.y, id };
          else if (input.phase === 'cancel') projectedPointerStart = null;
          else if (input.phase === 'up' && projectedPointerStart?.id === id) {
            const direction = directionFromSwipe(projectedPointerStart, { x: input.x, y: input.y });
            projectedPointerStart = null;
            if (direction) performMove(direction);
          }
        },
      }),
      ctx.gameProjection.registerRead({
        id: 'input.status',
        title: 'Read projected input status',
        description: 'Read typed CLI input causality for this live run.',
        read: (): GameProjectionValue => ({ eventCount: projectedInputEvents, lastInput: lastProjectedInput as GameProjectionValue }),
      }),
      ctx.gameProjection.registerRead({
        id: '2048.snapshot',
        title: 'Read 2048 game state',
        description: 'Read the board, score, best score, move count, win, and game-over state.',
        read: (): GameProjectionValue => ({
          grid: [...game.grid],
          score: game.score,
          best,
          moves: game.moves,
          over: game.over,
          won: game.won,
          acknowledgedWin: game.acknowledgedWin,
          spawnedIndex: game.spawnedIndex,
          mergedIndices: [...game.mergedIndices],
        }),
      }),
      ctx.gameProjection.registerAction({
        id: '2048.move',
        title: 'Move tiles',
        description: 'Apply one legal 2048 direction through the same gameplay owner as user input.',
        argsSchema: {
          type: 'object', required: ['direction'],
          properties: { direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] } },
        },
        run: (args) => {
          const direction = typeof args === 'object' && args !== null ? (args as { direction?: unknown }).direction : undefined;
          if (direction !== 'left' && direction !== 'right' && direction !== 'up' && direction !== 'down') {
            throw new Error('direction must be left, right, up, or down');
          }
          performMove(direction);
        },
      }),
      ctx.gameProjection.registerAction({
        id: '2048.restart',
        title: 'Restart 2048',
        description: 'Start a fresh board through the normal game lifecycle.',
        run: () => { resetGame(); },
      }),
    ];
    ctx.registerCleanup?.(() => disposers.reverse().forEach((dispose) => dispose()));
  }
}

function directionForKey(key: string): Direction | null {
  switch (key.toLowerCase()) {
    case 'arrowleft': case 'a': return 'left';
    case 'arrowright': case 'd': return 'right';
    case 'arrowup': case 'w': return 'up';
    case 'arrowdown': case 's': return 'down';
    default: return null;
  }
}
