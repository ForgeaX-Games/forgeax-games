import type { BootstrapContext, GameProjectionValue } from '@forgeax/engine-app';
import { Time, Update, type World } from '@forgeax/engine-ecs';
import {
  createInputSnapshot, INPUT_MAP_KEY, INPUT_SNAPSHOT_RESOURCE_KEY,
  type ActionConfig, type InputSnapshot,
} from '@forgeax/engine-input';
import { EngineBoard2048 } from './src/engine-board';
import { cloneGame, createGame, move, type Direction, type Game2048 } from './src/game-2048';

const key = (value: string) => ({ type: 'key', key: value } as const);
const INPUT_MAP: readonly ActionConfig[] = [
  { action: 'left', bindings: [key('ArrowLeft'), key('a'), key('A')] },
  { action: 'right', bindings: [key('ArrowRight'), key('d'), key('D')] },
  { action: 'up', bindings: [key('ArrowUp'), key('w'), key('W')] },
  { action: 'down', bindings: [key('ArrowDown'), key('s'), key('S')] },
  { action: 'restart', bindings: [key('r'), key('R')] },
  { action: 'undo', bindings: [key('u'), key('U')] },
];

function directionForKey(value: unknown): Direction | null {
  if (value === 'ArrowLeft' || value === 'a' || value === 'A') return 'left';
  if (value === 'ArrowRight' || value === 'd' || value === 'D') return 'right';
  if (value === 'ArrowUp' || value === 'w' || value === 'W') return 'up';
  if (value === 'ArrowDown' || value === 's' || value === 'S') return 'down';
  return null;
}

export async function bootstrap(world: World, ctx?: BootstrapContext): Promise<void> {
  const board = new EngineBoard2048(world);
  ctx?.registerCleanup?.(() => board.dispose());
  world.insertResource(INPUT_MAP_KEY, INPUT_MAP);
  const emptyInput = createInputSnapshot();
  const readInput = (): InputSnapshot => world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
    ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
    : emptyInput;

  let game: Game2048 = createGame();
  let previous: Game2048 | null = null;
  let best = 0;
  const hud = mountHud(ctx?.uiRoot ?? document.body);

  const render = (): void => {
    best = Math.max(best, game.score);
    hud.score.textContent = String(game.score);
    hud.best.textContent = String(best);
    hud.moves.textContent = String(game.moves);
    hud.undo.disabled = previous === null;
    hud.status.textContent = game.over
      ? 'No more moves — press R to restart'
      : game.won ? '2048 reached — keep going!' : 'Use arrow keys or WASD';
    board.sync(game.grid, game.spawnedIndex, game.mergedIndices);
  };
  const restart = (): void => {
    previous = null;
    game = createGame();
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
    if (!result.changed) return false;
    previous = before;
    game = result.game;
    render();
    return true;
  };
  hud.restart.onclick = restart;
  hud.undo.onclick = undo;

  world.addSystem(Update, {
    name: 'prism-2048-input-and-animation',
    after: ['input-frame-start-scan'],
    queries: [],
    fn: (runtimeWorld) => {
      const input = readInput();
      const direction: Direction | null = input.action('left').justPressed() ? 'left'
        : input.action('right').justPressed() ? 'right'
          : input.action('up').justPressed() ? 'up'
            : input.action('down').justPressed() ? 'down' : null;
      if (direction) performMove(direction);
      if (input.action('restart').justPressed()) restart();
      if (input.action('undo').justPressed()) undo();
      board.tick(runtimeWorld.getResource(Time).delta);
    },
  }).unwrap();

  installProjection(ctx, () => game, () => best, performMove, restart, undo);
  render();
}

interface Hud {
  readonly score: HTMLElement;
  readonly best: HTMLElement;
  readonly moves: HTMLElement;
  readonly status: HTMLElement;
  readonly restart: HTMLButtonElement;
  readonly undo: HTMLButtonElement;
}

function mountHud(root: HTMLElement): Hud {
  const shell = document.createElement('section');
  shell.setAttribute('aria-label', 'Prism 2048 controls');
  shell.style.cssText = 'position:absolute;inset:0;pointer-events:none;color:#f4f7ff;font:600 13px/1.35 Inter,system-ui,sans-serif;text-shadow:0 2px 12px #000';
  shell.innerHTML = [
    '<div style="position:absolute;left:22px;top:20px;display:flex;align-items:center;gap:14px">',
    '<div><div style="font-size:11px;letter-spacing:.28em;color:#8fe9ff">FORGEAX ENGINE</div>',
    '<div style="font-size:28px;font-weight:800;letter-spacing:-.04em">PRISM 2048</div></div>',
    '<div style="display:flex;gap:8px">',
    '<div style="padding:7px 12px;border:1px solid #58d8ff55;border-radius:10px;background:#071329bb">SCORE <b data-score style="display:block;font-size:17px">0</b></div>',
    '<div style="padding:7px 12px;border:1px solid #e45dff55;border-radius:10px;background:#180b29bb">BEST <b data-best style="display:block;font-size:17px">0</b></div>',
    '</div></div>',
    '<div style="position:absolute;right:22px;top:20px;display:flex;gap:8px;pointer-events:auto">',
    '<button data-undo style="' + buttonStyle() + '">Undo · U</button>',
    '<button data-restart style="' + buttonStyle() + '">New Game · R</button></div>',
    '<div style="position:absolute;left:22px;bottom:20px;padding:9px 13px;border:1px solid #ffffff20;border-radius:10px;background:#050815bb">',
    '<span data-status>Use arrow keys or WASD</span>',
    '<span style="margin-left:14px;color:#99a8c8">MOVES <b data-moves>0</b></span></div>',
  ].join('');
  root.appendChild(shell);
  return {
    score: shell.querySelector('[data-score]')!,
    best: shell.querySelector('[data-best]')!,
    moves: shell.querySelector('[data-moves]')!,
    status: shell.querySelector('[data-status]')!,
    restart: shell.querySelector<HTMLButtonElement>('[data-restart]')!,
    undo: shell.querySelector<HTMLButtonElement>('[data-undo]')!,
  };
}

function buttonStyle(): string {
  return 'pointer-events:auto;border:1px solid #8bdcff55;border-radius:10px;padding:10px 13px;color:#edf8ff;background:#071329dd;font:700 12px Inter,system-ui,sans-serif;cursor:pointer';
}

function installProjection(
  ctx: BootstrapContext | undefined,
  readGame: () => Game2048,
  readBest: () => number,
  performMove: (direction: Direction) => boolean,
  restart: () => void,
  undo: () => void,
): void {
  if (!ctx?.gameProjection) return;
  const disposers = [
    ctx.gameProjection.registerRead({
      id: '2048.snapshot',
      title: 'Read Prism 2048 state',
      description: 'Read the live ECS-backed board and score.',
      read: (): GameProjectionValue => {
        const game = readGame();
        return {
          grid: [...game.grid], score: game.score, best: readBest(), moves: game.moves,
          over: game.over, won: game.won, spawnedIndex: game.spawnedIndex,
          mergedIndices: [...game.mergedIndices], renderer: 'ForgeaX ECS MeshRenderer',
        };
      },
    }),
    ctx.gameProjection.registerAction({
      id: 'input',
      title: 'Send Prism 2048 input',
      description: 'Accept the standard gameplay key transition used by Studio verification.',
      argsSchema: {
        type: 'object',
        required: ['type', 'key', 'phase'],
        properties: {
          type: { type: 'string', enum: ['key'] },
          key: { type: 'string' },
          phase: { type: 'string', enum: ['down', 'up'] },
        },
      },
      run: (args) => {
        if (typeof args !== 'object' || args === null) return;
        const input = args as { type?: unknown; key?: unknown; phase?: unknown };
        if (input.type !== 'key' || input.phase !== 'down') return;
        const direction = directionForKey(input.key);
        if (direction) performMove(direction);
        else if (input.key === 'r' || input.key === 'R') restart();
        else if (input.key === 'u' || input.key === 'U') undo();
      },
    }),
    ctx.gameProjection.registerAction({
      id: '2048.move',
      title: 'Move Prism tiles',
      description: 'Move the live board through the same owner as keyboard input.',
      argsSchema: {
        type: 'object', required: ['direction'],
        properties: { direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] } },
      },
      run: (args) => {
        const direction = typeof args === 'object' && args !== null
          ? (args as { direction?: unknown }).direction : undefined;
        if (direction !== 'left' && direction !== 'right' && direction !== 'up' && direction !== 'down') {
          throw new Error('direction must be left, right, up, or down');
        }
        performMove(direction);
      },
    }),
    ctx.gameProjection.registerAction({
      id: '2048.restart', title: 'Restart Prism 2048',
      description: 'Start a fresh board.', run: restart,
    }),
    ctx.gameProjection.registerAction({
      id: '2048.undo', title: 'Undo Prism 2048',
      description: 'Undo the previous successful move.', run: undo,
    }),
  ];
  ctx.registerCleanup?.(() => disposers.reverse().forEach((dispose) => dispose()));
}
