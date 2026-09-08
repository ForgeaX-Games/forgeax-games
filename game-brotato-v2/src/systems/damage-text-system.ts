import type { GameHost } from '@forgeax/engine-app';
import { Time, Update, type World } from '@forgeax/engine-ecs';

export const DAMAGE_TEXT_EVENTS_KEY = 'BrotatoV2DamageTextEvents';
export const DAMAGE_TEXT_SYSTEM_NAME = 'brotato-v2/damage-text';

export interface DamageTextEvent {
  readonly amount: number;
  readonly x: number;
  readonly z: number;
}

export interface DamageTextEvents {
  readonly pending: DamageTextEvent[];
}

interface ActiveText {
  readonly element: HTMLSpanElement;
  readonly x: number;
  readonly z: number;
  age: number;
}

export interface DamageTextLayer {
  readonly show: (event: DamageTextEvent) => void;
  readonly update: (delta: number) => void;
  readonly dispose: () => void;
}

export function createDamageTextLayer(host: GameHost): DamageTextLayer {
  const parent = host.uiRoot ?? host.canvas.parentElement ?? document.body;
  const layer = document.createElement('div');
  layer.setAttribute('aria-label', 'Damage numbers');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:46;overflow:hidden';
  parent.append(layer);
  const active: ActiveText[] = [];
  return {
    show: (event) => {
      const element = document.createElement('span');
      element.textContent = String(Math.max(0, Math.round(event.amount)));
      element.style.cssText = 'position:fixed;color:#fff5c2;font:800 18px/1 ui-sans-serif,system-ui,sans-serif;text-shadow:0 2px 5px #000;transform:translate(-50%,-50%);transition:opacity .1s';
      layer.append(element);
      active.push({ element, x: event.x, z: event.z, age: 0 });
    },
    update: (delta) => {
      const rect = host.canvas.getBoundingClientRect();
      const scale = Math.min(rect.width, rect.height) / 25;
      for (let index = active.length - 1; index >= 0; index -= 1) {
        const item = active[index];
        if (item === undefined) continue;
        item.age += delta;
        if (item.age >= 0.8) {
          item.element.remove();
          active.splice(index, 1);
          continue;
        }
        const x = rect.left + rect.width / 2 + item.x * scale;
        const y = rect.top + rect.height / 2 - item.z * scale - item.age * 42;
        item.element.style.left = `${x}px`;
        item.element.style.top = `${y}px`;
        item.element.style.opacity = String(Math.max(0, 1 - item.age / 0.8));
      }
    },
    dispose: () => {
      for (const item of active) item.element.remove();
      active.length = 0;
      layer.remove();
    },
  };
}

export function installDamageTextSystem(world: World, host: GameHost, layer: DamageTextLayer): () => void {
  world
    .addSystem(Update, {
      name: DAMAGE_TEXT_SYSTEM_NAME,
      queries: [],
      fn: (world) => {
        const delta = Math.max(0, world.getResource(Time).delta);
        const events = world.hasResource(DAMAGE_TEXT_EVENTS_KEY)
          ? world.getResource<DamageTextEvents>(DAMAGE_TEXT_EVENTS_KEY)
          : undefined;
        if (events !== undefined) {
          for (const event of events.pending) layer.show(event);
          events.pending.length = 0;
        }
        layer.update(delta);
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, DAMAGE_TEXT_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
    layer.dispose();
  };
}
