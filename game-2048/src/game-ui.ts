import { mountUi, type UiAsset } from '@forgeax/engine-ui';

import { directionFromSwipe, type Direction, type Game2048 } from './game-2048';

export const BOARD_UI_GUID = '56efb9cc-861a-4e99-8310-8079096d6eac';

interface UiActions {
  readonly onRestart: () => void;
  readonly onUndo: () => void;
  readonly onContinue: () => void;
  readonly onMove: (direction: Direction) => void;
}

export interface GameUi {
  readonly render: (game: Game2048, best: number, canUndo: boolean) => void;
  readonly nudge: (direction: Direction) => void;
  readonly dispose: () => void;
}

const TILE_COLORS: Record<number, [string, string]> = {
  2: ['#eee4da', '#61574f'], 4: ['#ede0c8', '#61574f'],
  8: ['#f2b179', '#fffaf2'], 16: ['#f59563', '#fffaf2'],
  32: ['#f67c5f', '#fffaf2'], 64: ['#f65e3b', '#fffaf2'],
  128: ['#edcf72', '#fffaf2'], 256: ['#edcc61', '#fffaf2'],
  512: ['#edc850', '#fffaf2'], 1024: ['#edc53f', '#fffaf2'],
  2048: ['#edc22e', '#fffaf2'],
};

export function mountGameUi(asset: UiAsset, host: HTMLElement, actions: UiActions): GameUi {
  const mounted = mountUi(asset, {
    root: host,
    layer: 40,
    onAction: (action) => {
      if (action === 'restart') actions.onRestart();
      else if (action === 'undo') actions.onUndo();
      else if (action === 'continue') actions.onContinue();
    },
  });
  if (!mounted.ok) throw new Error(`2048 UI mount failed (${mounted.error.code}): ${mounted.error.hint ?? mounted.error.expected}`);
  const root = mounted.value.host.shadowRoot;
  if (!root) {
    mounted.value.dispose();
    throw new Error('2048 UI mount failed: open ShadowRoot is unavailable');
  }

  const tiles = required(root, '[data-tiles]');
  const score = required(root, '[data-score]');
  const scoreDelta = required(root, '[data-score-delta]');
  const best = required(root, '[data-best]');
  const status = required(root, '[data-status]');
  const overlay = required(root, '[data-overlay]');
  const overlayTitle = required(root, '[data-overlay-title]');
  const overlayCopy = required(root, '[data-overlay-copy]');
  const undoButton = requiredButton(root, '[data-undo]');
  const continueButton = requiredButton(root, '[data-continue]');
  const board = required(root, '[data-board]');
  const reducedMotion = root.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  let pointerStart: { x: number; y: number; id: number } | null = null;
  let renderedScore = 0;

  board.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    board.setPointerCapture?.(event.pointerId);
  }, { signal: mounted.value.signal });
  board.addEventListener('pointerup', (event) => {
    if (pointerStart?.id !== event.pointerId) return;
    const direction = directionFromSwipe(pointerStart, event, 24);
    pointerStart = null;
    if (direction) actions.onMove(direction);
  }, { signal: mounted.value.signal });
  board.addEventListener('pointercancel', () => { pointerStart = null; }, { signal: mounted.value.signal });

  const render = (game: Game2048, bestScore: number, canUndo: boolean): void => {
    const gained = game.score - renderedScore;
    score.textContent = game.score.toLocaleString();
    if (gained > 0 && !reducedMotion) {
      scoreDelta.textContent = `+${gained.toLocaleString()}`;
      scoreDelta.animate([
        { transform: 'translateY(8px)', opacity: 0 },
        { transform: 'translateY(-2px)', opacity: 1, offset: .28 },
        { transform: 'translateY(-22px)', opacity: 0 },
      ], { duration: 620, easing: 'cubic-bezier(.2,.75,.25,1)' });
    }
    renderedScore = game.score;
    best.textContent = bestScore.toLocaleString();
    status.textContent = game.over ? 'No moves left — what a run!'
      : game.won && !game.acknowledgedWin ? 'You reached the golden tile!'
        : game.moves === 0 ? 'Swipe or use arrow keys to begin'
          : `${game.moves} move${game.moves === 1 ? '' : 's'} · Keep building`;
    undoButton.disabled = !canUndo;
    const previousTiles = readRenderedTiles(tiles);
    const nextTiles = game.grid.flatMap((value, index) => value === 0 ? [] : [tile(value, index, game)]);
    tiles.replaceChildren(...nextTiles);
    if (!reducedMotion) animateTileTransition(tiles, nextTiles, previousTiles, game);
    const showWin = game.won && !game.acknowledgedWin;
    overlay.hidden = !game.over && !showWin;
    overlayTitle.textContent = game.over ? 'Game over' : '2048!';
    overlayCopy.textContent = game.over
      ? `You scored ${game.score.toLocaleString()} in ${game.moves} moves.`
      : 'Brilliant. The board is yours — keep going?';
    continueButton.hidden = game.over;
  };

  const nudge = (direction: Direction): void => {
    required(root, '[data-board]').animate([
      { transform: 'translate(0,0)' },
      { transform: `translate(${direction === 'left' ? -4 : direction === 'right' ? 4 : 0}px,${direction === 'up' ? -4 : direction === 'down' ? 4 : 0}px)` },
      { transform: 'translate(0,0)' },
    ], { duration: 140, easing: 'ease-out' });
  };

  return { render, nudge, dispose: () => mounted.value.dispose() };
}

function tile(value: number, index: number, game: Game2048): HTMLElement {
  const element = document.createElement('div');
  const row = Math.floor(index / 4);
  const col = index % 4;
  const [background, color] = TILE_COLORS[value] ?? ['#342d44', '#fffaf2'];
  element.className = 'fx2048-tile';
  element.dataset.index = String(index);
  element.dataset.value = String(value);
  if (game.spawnedIndex === index) element.classList.add('is-new');
  element.style.setProperty('--row', String(row));
  element.style.setProperty('--col', String(col));
  element.style.setProperty('--tile-bg', background);
  element.style.setProperty('--tile-fg', color);
  element.style.setProperty('--digits', String(String(value).length));
  element.textContent = String(value);
  return element;
}

interface RenderedTile {
  readonly index: number;
  readonly value: number;
  readonly rect: DOMRect;
  used: boolean;
}

function readRenderedTiles(container: HTMLElement): RenderedTile[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.fx2048-tile[data-index][data-value]')).flatMap((element) => {
    const index = Number(element.dataset.index);
    const value = Number(element.dataset.value);
    return Number.isInteger(index) && Number.isFinite(value)
      ? [{ index, value, rect: element.getBoundingClientRect(), used: false }]
      : [];
  });
}

function animateTileTransition(
  container: HTMLElement,
  nextTiles: readonly HTMLElement[],
  previousTiles: RenderedTile[],
  game: Game2048,
): void {
  for (const element of nextTiles) {
    const index = Number(element.dataset.index);
    const value = Number(element.dataset.value);
    if (game.spawnedIndex === index) continue;
    const merged = game.mergedIndices.includes(index);
    const sourceValue = merged ? value / 2 : value;
    const target = element.getBoundingClientRect();
    const sources = previousTiles
      .filter((candidate) => !candidate.used && candidate.value === sourceValue)
      .sort((a, b) => distance(a.index, index) - distance(b.index, index));
    const source = sources[0];
    if (!source) continue;
    source.used = true;

    if (merged) {
      const second = sources[1];
      if (second) second.used = true;
      for (const origin of second ? [source, second] : [source]) {
        const ghost = tile(sourceValue, index, { ...game, spawnedIndex: null, mergedIndices: [] });
        ghost.setAttribute('aria-hidden', 'true');
        container.append(ghost);
        const dx = origin.rect.left - target.left;
        const dy = origin.rect.top - target.top;
        const animation = ghost.animate([
          { transform: `translate(${dx}px,${dy}px)`, opacity: 1 },
          { transform: 'translate(0,0)', opacity: 0 },
        ], { duration: 145, easing: 'cubic-bezier(.2,.8,.3,1)' });
        void animation.finished.then(() => ghost.remove(), () => ghost.remove());
      }
      element.animate([
        { transform: 'scale(.82)', opacity: 0, offset: 0 },
        { transform: 'scale(.82)', opacity: 0, offset: .7 },
        { transform: 'scale(1.16)', opacity: 1, offset: .88 },
        { transform: 'scale(1)', opacity: 1, offset: 1 },
      ], { duration: 220, easing: 'ease-out' });
      continue;
    }

    const dx = source.rect.left - target.left;
    const dy = source.rect.top - target.top;
    if (dx === 0 && dy === 0) continue;
    element.animate([
      { transform: `translate(${dx}px,${dy}px)` },
      { transform: 'translate(0,0)' },
    ], { duration: 145, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
}

function distance(from: number, to: number): number {
  return Math.abs(Math.floor(from / 4) - Math.floor(to / 4)) + Math.abs((from % 4) - (to % 4));
}

function required(root: ParentNode, selector: string): HTMLElement {
  const value = root.querySelector<HTMLElement>(selector);
  if (!value) throw new Error(`2048 UI asset missing ${selector}`);
  return value;
}

function requiredButton(root: ParentNode, selector: string): HTMLButtonElement {
  const value = root.querySelector<HTMLButtonElement>(selector);
  if (!value) throw new Error(`2048 UI asset missing ${selector}`);
  return value;
}
