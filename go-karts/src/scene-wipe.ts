/**
 * Short sky/blue wipe used to hide the garage→track hard cut (Party Animals style).
 */
const WIPE_ID = 'forgeax-kart-scene-wipe';
const STYLE_ID = `${WIPE_ID}-style`;

const STYLE = `
#${WIPE_ID}{position:absolute;inset:0;z-index:15000;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,#6eb6ef 0%,#c9e8ff 55%,#eef7ff 100%);
  transition:opacity .22s ease}
#${WIPE_ID}.show{opacity:1}
#${WIPE_ID}.hold{transition:none}
`;

export function playSceneWipe(
  host: HTMLElement,
  options: {
    /** Called once the wipe fully covers the screen (safe to swap scene). */
    onCovered(): void;
    /** Called after the wipe has faded out. */
    onRevealed?(): void;
    coverMs?: number;
    holdMs?: number;
    revealMs?: number;
  },
): void {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  document.getElementById(WIPE_ID)?.remove();
  const el = document.createElement('div');
  el.id = WIPE_ID;
  host.appendChild(el);

  const coverMs = options.coverMs ?? 220;
  const holdMs = options.holdMs ?? 90;
  const revealMs = options.revealMs ?? 280;

  requestAnimationFrame(() => {
    el.classList.add('show');
    window.setTimeout(() => {
      options.onCovered();
      window.setTimeout(() => {
        el.style.transition = `opacity ${revealMs}ms ease`;
        el.classList.remove('show');
        window.setTimeout(() => {
          el.remove();
          options.onRevealed?.();
        }, revealMs + 20);
      }, holdMs);
    }, coverMs);
  });
}
