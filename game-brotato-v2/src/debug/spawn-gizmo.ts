import type { GameHost } from '@forgeax/engine-app';
import { Camera } from '@forgeax/engine-render';
import { Update, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { CAMERA_RIG_RESOURCE_KEY, type CameraRig } from '../config/camera-rig.ts';
import { SPAWN } from '../config/spawn.ts';
import { Player, SpawnMarker } from '../ecs/components.ts';

export const SPAWN_GIZMO_SYSTEM_NAME = 'brotato-v2/spawn-gizmo';

export interface SpawnGizmoController {
  readonly setVisible: (visible: boolean) => void;
  readonly toggle: () => boolean;
  readonly dispose: () => void;
}

function canvasPoint(host: GameHost, x: number, z: number, centerX: number, centerZ: number, scale: number): readonly [number, number] {
  const rect = host.canvas.getBoundingClientRect();
  return [
    rect.left + rect.width / 2 + (x - centerX) * scale,
    rect.top + rect.height / 2 - (z - centerZ) * scale,
  ];
}

export function createSpawnGizmo(host: GameHost): SpawnGizmoController {
  const parent = host.uiRoot ?? host.canvas.parentElement ?? document.body;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-label', 'Enemy spawn deployment gizmo');
  svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:44;display:none;overflow:visible';
  const ringGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const ringInner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const ringOuter = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [ring, color, dash] of [[ringInner, '#65e7ff', '6 7'], [ringOuter, '#ffd36a', '2 8']] as const) {
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', color);
    ring.setAttribute('stroke-width', '2');
    ring.setAttribute('stroke-dasharray', dash);
    ring.setAttribute('opacity', '0.8');
    ringGroup.append(ring);
  }
  const viewRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  viewRect.setAttribute('fill', 'none');
  viewRect.setAttribute('stroke', '#ffffff');
  viewRect.setAttribute('stroke-width', '1.5');
  viewRect.setAttribute('stroke-dasharray', '4 5');
  viewRect.setAttribute('opacity', '0.55');
  const markerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(viewRect, ringGroup, markerGroup);
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
      return visible;
    },
    dispose: () => svg.remove(),
  };
}

export function installSpawnGizmoSystem(world: World, host: GameHost, controller: SpawnGizmoController): () => void {
  world
    .addSystem(Update, {
      name: SPAWN_GIZMO_SYSTEM_NAME,
      queries: [
        { read: [Transform], with: [Player] },
        { read: [Transform], with: [Camera] },
        { read: [Transform, SpawnMarker] },
      ],
      fn: (world, [players, cameras, markers]) => {
        const svg = host.uiRoot?.querySelector<SVGSVGElement>('svg[aria-label="Enemy spawn deployment gizmo"]')
          ?? host.canvas.parentElement?.querySelector<SVGSVGElement>('svg[aria-label="Enemy spawn deployment gizmo"]');
        if (svg === null || svg === undefined || svg.style.display === 'none') return;
        const player = [...players][0];
        const camera = [...cameras][0];
        if (player === undefined || camera === undefined) return;
        const playerTransform = player.get(Transform);
        const cameraTransform = camera.get(Transform);
        const rig = world.hasResource(CAMERA_RIG_RESOURCE_KEY)
          ? world.getResource<CameraRig>(CAMERA_RIG_RESOURCE_KEY)
          : undefined;
        const halfWidth = rig?.halfWidth ?? 12.5;
        const halfDepth = rig?.halfDepth ?? 12.5;
        const rect = host.canvas.getBoundingClientRect();
        const scale = Math.min(rect.width / Math.max(1, halfWidth * 2), rect.height / Math.max(1, halfDepth * 2));
        const cameraX = cameraTransform.pos[0] ?? 0;
        const cameraZ = cameraTransform.pos[2] ?? 0;
        const playerX = playerTransform.pos[0] ?? 0;
        const playerZ = playerTransform.pos[2] ?? 0;
        const center = canvasPoint(host, playerX, playerZ, cameraX, cameraZ, scale);
        for (const [ring, radius] of [[svg.querySelector('circle:nth-of-type(1)'), SPAWN.placement.minRadius], [svg.querySelector('circle:nth-of-type(2)'), SPAWN.placement.maxRadius]] as const) {
          ring?.setAttribute('cx', String(center[0]));
          ring?.setAttribute('cy', String(center[1]));
          ring?.setAttribute('r', String(radius * scale));
        }
        const topLeft = canvasPoint(host, cameraX - halfWidth + SPAWN.placement.viewInset, cameraZ + halfDepth - SPAWN.placement.viewInset, cameraX, cameraZ, scale);
        viewRectAttributes(svg, topLeft[0], topLeft[1], (halfWidth * 2 - SPAWN.placement.viewInset * 2) * scale, (halfDepth * 2 - SPAWN.placement.viewInset * 2) * scale);
        const markerGroup = svg.querySelector<SVGGElement>('g:last-child');
        if (markerGroup === null) return;
        markerGroup.replaceChildren();
        for (const row of markers) {
          const transform = row.get(Transform);
          const marker = row.get(SpawnMarker);
          const point = canvasPoint(host, transform.pos[0] ?? 0, transform.pos[2] ?? 0, cameraX, cameraZ, scale);
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', String(point[0]));
          dot.setAttribute('cy', String(point[1]));
          dot.setAttribute('r', '6');
          dot.setAttribute('fill', '#ff5a49');
          dot.setAttribute('stroke', '#fff2d4');
          dot.setAttribute('stroke-width', '1');
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', String(point[0] + 8));
          label.setAttribute('y', String(point[1] - 8));
          label.setAttribute('fill', '#fff2d4');
          label.setAttribute('font-size', '11');
          label.textContent = `${Math.max(0, marker.ttl).toFixed(1)}s`;
          markerGroup.append(dot, label);
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, SPAWN_GIZMO_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
    controller.setVisible(false);
  };
}

function viewRectAttributes(svg: SVGSVGElement, x: number, y: number, width: number, height: number): void {
  const viewRect = svg.querySelector<SVGRectElement>('rect');
  viewRect?.setAttribute('x', String(x));
  viewRect?.setAttribute('y', String(y));
  viewRect?.setAttribute('width', String(Math.max(0, width)));
  viewRect?.setAttribute('height', String(Math.max(0, height)));
}
