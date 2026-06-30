export const PICK_TILE_CLASS = 'hz-pick-tile';
export const PICK_ROW_CLASS = 'hz-pick-row';

const STYLE_ID = 'hua-zhuan-pick-styles';

const CSS = `
@keyframes hz-tile-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.07); }
}

@keyframes hz-row-flow {
  0% { background-position: 0% 50%; }
  100% { background-position: 250% 50%; }
}

@keyframes hz-row-glow {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.9; }
}

.${PICK_TILE_CLASS} {
  z-index: 30;
  transform-origin: center center;
  animation: hz-tile-breathe 1.7s ease-in-out infinite;
}

.${PICK_TILE_CLASS}::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 3px solid #1a1008;
  border-radius: 4px;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.45),
    inset 0 0 4px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  box-sizing: border-box;
}

.${PICK_ROW_CLASS} {
  box-sizing: border-box;
  border-radius: 8px;
  z-index: 25;
  overflow: visible;
}

.${PICK_ROW_CLASS}::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 10px;
  padding: 4px;
  background: linear-gradient(
    110deg,
    #14532d 0%,
    #22c55e 18%,
    #86efac 36%,
    #4ade80 54%,
    #16a34a 72%,
    #bbf7d0 86%,
    #14532d 100%
  );
  background-size: 250% 250%;
  animation: hz-row-flow 2.6s linear infinite;
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
  z-index: 0;
}

.${PICK_ROW_CLASS}::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 7px;
  background: rgba(34, 197, 94, 0.1);
  box-shadow:
    inset 0 0 14px rgba(74, 222, 128, 0.28),
    0 0 10px rgba(34, 197, 94, 0.2);
  animation: hz-row-glow 2.6s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}
`;

/** Inject pick-highlight keyframes once per page */
export function ensureSelectionStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
