import type { GameHost } from '@forgeax/engine-app';
import { Update, type World } from '@forgeax/engine-ecs';

export const TARGET_LINES_STATE_KEY = 'BrotatoV2TargetLines';
export const TARGET_LINES_SYSTEM_NAME = 'brotato-v2/target-lines';

export interface TargetLine {
  readonly slotIndex: number;
  readonly weaponX: number;
  readonly weaponZ: number;
  readonly targetId: number;
  readonly targetX: number;
  readonly targetZ: number;
}

export interface TargetLineState {
  readonly lines: TargetLine[];
}

export interface TargetLinesController {
  readonly setVisible: (visible: boolean) => void;
  readonly toggle: () => void;
  readonly dispose: () => void;
}

function worldToScreen(host: GameHost, x: number, z: number): readonly [number, number] {
  const rect = host.canvas.getBoundingClientRect();
  const scale = Math.min(rect.width, rect.height) / 25;
  return [rect.left + rect.width / 2 + x * scale, rect.top + rect.height / 2 - z * scale];
}

export function createTargetLines(host: GameHost): TargetLinesController {
  const parent = host.uiRoot ?? host.canvas.parentElement ?? document.body;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-label', 'Weapon target assignment gizmo');
  svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:45;display:none;overflow:visible';
  const lines = [0, 1].map((slotIndex) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.dataset.slotIndex = String(slotIndex);
    line.setAttribute('stroke', slotIndex === 0 ? '#62e9ff' : '#ffce68');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-dasharray', '8 6');
    line.style.display = 'none';
    svg.append(line);
    return line;
  });
  parent.append(svg);
  let visible = false;
  return {
    setVisible: (next) => {
      visible = next;
      svg.style.display = visible ? 'block' : 'none';
    },
    toggle: () => {
      visible = !visible;
      svg.style.display = visible ? 'block' : 'none';
    },
    dispose: () => svg.remove(),
  };
}

export function installTargetLinesSystem(world: World, host: GameHost, controller: TargetLinesController): () => void {
  world
    .addSystem(Update, {
      name: TARGET_LINES_SYSTEM_NAME,
      queries: [],
      fn: (world) => {
        const state = world.hasResource(TARGET_LINES_STATE_KEY)
          ? world.getResource<TargetLineState>(TARGET_LINES_STATE_KEY)
          : undefined;
        const svg = host.uiRoot?.querySelector<SVGSVGElement>('svg[aria-label="Weapon target assignment gizmo"]')
          ?? host.canvas.parentElement?.querySelector('svg[aria-label="Weapon target assignment gizmo"]');
        if (svg === null || svg === undefined || state === undefined) return;
        for (const [slotIndex, line] of linesForSvg(svg).entries()) {
          const target = state.lines.find((candidate) => candidate.slotIndex === slotIndex);
          if (target === undefined) {
            line.style.display = 'none';
            continue;
          }
          const start = worldToScreen(host, target.weaponX, target.weaponZ);
          const end = worldToScreen(host, target.targetX, target.targetZ);
          line.setAttribute('x1', String(start[0]));
          line.setAttribute('y1', String(start[1]));
          line.setAttribute('x2', String(end[0]));
          line.setAttribute('y2', String(end[1]));
          line.style.display = 'block';
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, TARGET_LINES_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
    controller.dispose();
  };
}

function linesForSvg(svg: SVGSVGElement): SVGLineElement[] {
  return [...svg.querySelectorAll<SVGLineElement>('line[data-slot-index]')]
    .sort((left, right) => Number(left.dataset.slotIndex) - Number(right.dataset.slotIndex));
}
