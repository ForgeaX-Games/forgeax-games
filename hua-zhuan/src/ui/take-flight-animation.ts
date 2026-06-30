import { firstPlayerImageUrl, tileImageUrl } from './game-assets';
import type { FlightLeg, FlightPlan } from './take-flight-plan';

const OVERLAY_ID = 'hua-zhuan-flight-overlay';

const FLIGHT_MS = 520;
const STAGGER_MS = 72;
const ARC_PX = 28;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for browser paint so board refresh is visible before removing fly sprites */
export function waitForPaint(frames = 2): Promise<void> {
  return new Promise((resolve) => {
    let n = 0;
    const step = () => {
      n++;
      if (n >= frames) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function ensureOverlay(): HTMLElement {
  let el = document.getElementById(OVERLAY_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.style.cssText =
    'position:fixed;inset:0;z-index:500;pointer-events:auto;overflow:hidden;' +
    'background:transparent;';
  document.body.appendChild(el);
  return el;
}

export function clearTakeFlightOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function animateLeg(leg: FlightLeg, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    void (async () => {
      await sleep(delayMs);
      const overlay = ensureOverlay();
      const img = document.createElement('img');
      img.src =
        leg.sprite === 'first-player' ? firstPlayerImageUrl() : tileImageUrl(leg.color);
      img.draggable = false;
      img.alt = '';
      const from = leg.from.size;
      img.style.cssText =
        'position:absolute;left:0;top:0;object-fit:contain;pointer-events:none;' +
        `width:${from}px;height:${from}px;will-change:transform;`;
      img.style.transform = `translate(${leg.from.cx - from / 2}px, ${leg.from.cy - from / 2}px)`;
      overlay.appendChild(img);

      const t0 = performance.now();
      const tick = (now: number) => {
        const raw = Math.min(1, (now - t0) / FLIGHT_MS);
        const t = easeOutCubic(raw);
        const size = leg.from.size + (leg.to.size - leg.from.size) * t;
        const cx = leg.from.cx + (leg.to.cx - leg.from.cx) * t;
        const cy = leg.from.cy + (leg.to.cy - leg.from.cy) * t + Math.sin(Math.PI * t) * -ARC_PX;
        img.style.width = `${size}px`;
        img.style.height = `${size}px`;
        img.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px)`;
        if (raw < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    })();
  });
}

/** Fly tiles to destination and hold sprites until clearTakeFlightOverlay() */
export async function runTakeFlightAnimation(plan: FlightPlan): Promise<void> {
  if (plan.legs.length === 0) return;
  clearTakeFlightOverlay();
  ensureOverlay();
  const jobs = plan.legs.map((leg, i) => animateLeg(leg, i * STAGGER_MS));
  await Promise.all(jobs);
}
