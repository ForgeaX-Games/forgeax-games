import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { vec3 } from '@forgeax/engine-math';
import type { PhysicsWorld } from '@forgeax/engine-physics';
import {
  Camera,
  DirectionalLight,
  Materials,
  MeshFilter,
  MeshRenderer,
  Skylight,
  Visibility,
  VisibilityStateValue,
  perspective,
} from '@forgeax/engine-render';
import { quat } from '@forgeax/engine-runtime';
import { ChildOf, Transform } from '@forgeax/engine-scene';
import type { Handle, MaterialAsset } from '@forgeax/engine-types';
import {
  getMobilityHudCountdowns,
  SEGMENT_KILL_TARGETS,
  type MobilityState,
  type PlayerVitality,
  type ShotgunState,
  type SlicePhase,
  type SliceState,
} from './rules';

type MaterialHandle = Handle<'MaterialAsset', 'shared'>;
type PresentationHost = {
  readonly uiRoot?: HTMLElement;
  readonly registerCleanup?: (cleanup: () => void) => void;
};

export type PresentationFrame = {
  readonly realElapsed: number;
  readonly realDelta: number;
  readonly gameElapsed: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly shotgun: ShotgunState;
  readonly mobility: MobilityState;
  readonly slice: SliceState;
  readonly playerVitality: PlayerVitality;
  readonly graceEndsAt: number;
  readonly exposedEnemies: number;
  readonly debugEnabled: boolean;
};

export type RainAlleyPresentation = {
  createEnemyMarker(parent: EntityHandle, height: number): EntityHandle;
  setPointerLocked(locked: boolean): void;
  playShot(input: {
    readonly realElapsed: number;
    readonly origin: readonly [number, number, number];
    readonly aim: readonly [number, number, number];
    readonly yaw: number;
    readonly tracerLength: number;
  }): void;
  showEnemyMuzzle(realElapsed: number, position: readonly [number, number, number]): void;
  showEnemyHit(entity: EntityHandle, material: MaterialHandle, realElapsed: number): void;
  showEnemyKilled(position: readonly [number, number, number], realElapsed: number): void;
  showPelletHits(
    position: readonly [number, number, number],
    pelletCount: number,
    realElapsed: number,
  ): void;
  setEnemyMarker(
    marker: EntityHandle,
    state: 'off' | 'covered' | 'exposed',
  ): void;
  showDamage(realElapsed: number, angleDeg: number): void;
  showDeath(realElapsed: number, restartCount: number): void;
  update(frame: PresentationFrame): void;
};

export function createWhiteboxMaterial(
  world: World,
  color: [number, number, number, number],
  roughness = 0.82,
): MaterialHandle {
  return world.allocSharedRef(
    'MaterialAsset',
    Materials.standard({ baseColor: color, roughness, metallic: 0 }) as MaterialAsset,
  );
}

/**
 * Current Whitebox implementation of the future Weapon Socket seam.
 * Ticket 18 replaces these ChildOf parts with a skinned scene and named joint.
 */
function installWhiteboxPlayerVisual(world: World, player: EntityHandle): void {
  const coat = createWhiteboxMaterial(world, [0.08, 0.11, 0.16, 1]);
  const shirt = createWhiteboxMaterial(world, [0.82, 0.84, 0.86, 1]);
  const skin = createWhiteboxMaterial(world, [0.7, 0.48, 0.34, 1]);
  const gun = createWhiteboxMaterial(world, [0.12, 0.1, 0.08, 1], 0.45);
  const part = (
    mesh: typeof HANDLE_CUBE,
    material: MaterialHandle,
    pos: [number, number, number],
    scale: [number, number, number],
  ): void => {
    world.spawn(
      { component: Transform, data: { pos, scale } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
      { component: ChildOf, data: { parent: player } },
    ).unwrap();
  };

  part(HANDLE_CUBE, coat, [0, 0.08, 0], [0.65, 0.85, 0.38]);
  part(HANDLE_CUBE, shirt, [0, 0.16, -0.21], [0.28, 0.58, 0.08]);
  part(HANDLE_SPHERE as typeof HANDLE_CUBE, skin, [0, 0.78, 0], [0.36, 0.36, 0.36]);
  part(HANDLE_CUBE, coat, [-0.2, -0.62, 0], [0.22, 0.55, 0.24]);
  part(HANDLE_CUBE, coat, [0.2, -0.62, 0], [0.22, 0.55, 0.24]);
  part(HANDLE_CUBE, gun, [0.42, 0.15, -0.48], [0.16, 0.18, 0.72]);
}

class ShotSound {
  private context: AudioContext | null = null;
  private channels: GainNode[] = [];
  private cursor = 0;

  play(): void {
    if (this.context === null) {
      this.context = new window.AudioContext();
      this.channels = Array.from({ length: 3 }, (_, index) => {
        const oscillator = this.context!.createOscillator();
        const gain = this.context!.createGain();
        oscillator.type = index === 0 ? 'sawtooth' : 'square';
        oscillator.frequency.value = 55 + index * 23;
        gain.gain.value = 0;
        oscillator.connect(gain).connect(this.context!.destination);
        oscillator.start();
        return gain;
      });
    }
    void this.context.resume();
    const gain = this.channels[this.cursor++ % this.channels.length]!;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    gain.gain.setValueAtTime(0, now + 0.14);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.channels = [];
  }
}

type EffectSlot = {
  readonly entity: EntityHandle;
  until: number;
};

type HitFlash = {
  readonly entity: EntityHandle;
  readonly material: MaterialHandle;
  until: number;
};

function createEffectPool(
  world: World,
  count: number,
  material: MaterialHandle,
): EffectSlot[] {
  return Array.from({ length: count }, () => ({
    entity: world.spawn(
      { component: Transform, data: { pos: [0, -20, 0], scale: [0, 0, 0] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [material] } },
    ).unwrap(),
    until: 0,
  }));
}

const PHASE_OBJECTIVES: Record<SlicePhase, string> = {
  'intro-flashback': '哥哥死在这条巷子里。你没回头。',
  alley: '清掉巷子里的马仔',
  kitchen: '杀穿后厨的刀手 — 别让他们贴到身上',
  hall: '清掉大厅的礼服枪手',
  'coat-standoff': '大衣。一发解决他。',
  'victory-flashback': '结束了。',
};

type Hud = {
  setLocked(locked: boolean): void;
  onShot(realElapsed: number): void;
  onDamage(realElapsed: number, angleDeg: number): void;
  onDeath(realElapsed: number, restartCount: number): void;
  update(frame: PresentationFrame): void;
  dispose(): void;
};

function installHud(mount: HTMLElement): Hud {
  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;inset:0;pointer-events:none;color:#f2f4f8;font-family:system-ui,sans-serif;text-shadow:0 2px 8px #000;z-index:2';
  hud.innerHTML = `
    <div style="position:absolute;left:24px;top:20px">
      <div style="font-size:22px;font-weight:750;letter-spacing:.18em">雨夜不回头</div>
      <div style="font-size:12px;opacity:.72;margin-top:6px">WASD 移动 · LMB 开火 · R 换弹 · Shift 短跑 · Space 迈低坎 · F 慢动作</div>
      <div style="font-size:11px;opacity:.62;margin-top:4px">短跑 7.2 m/s ＜ 未来刀手 8.6 m/s</div>
      <div data-mobility style="margin-top:12px;font-size:13px;line-height:1.65;letter-spacing:.04em"></div>
      <div data-objective style="font-size:15px;font-weight:650;margin-top:12px;color:#ffe6a8"></div>
      <div data-state style="font-size:12px;opacity:.66;margin-top:4px"></div>
      <div data-health style="font-size:13px;color:#ffb7aa;margin-top:5px"></div>
      <div data-debug style="font-size:11px;color:#ffb68e;margin-top:5px"></div>
    </div>
    <div data-ammo style="position:absolute;right:28px;bottom:26px;font-size:28px;font-weight:800;letter-spacing:.08em"></div>
    <div data-cross style="position:absolute;left:50%;top:50%;width:8px;height:8px;border:1px solid #fff;border-radius:50%;transform:translate(-50%,-50%);opacity:.75"></div>
    <div data-slow-vignette style="position:absolute;inset:0;border:0 solid rgba(105,190,255,.52);box-shadow:inset 0 0 70px transparent;transition:border-width .12s,box-shadow .12s"></div>
    <div data-hurt style="position:absolute;inset:0;box-shadow:inset 0 0 140px rgba(215,30,30,.85);opacity:0"></div>
    <div data-hurt-dir style="position:absolute;left:50%;top:50%;width:230px;height:230px;margin:-115px 0 0 -115px;border-radius:50%;border-top:7px solid rgba(255,86,64,.95);opacity:0"></div>
    <div data-door style="position:absolute;left:50%;top:58%;transform:translateX(-50%);font-size:17px;font-weight:700;color:#9be8a4;opacity:0">门开了 — 一直向前走过去</div>
    <div data-death style="position:absolute;inset:0;background:#000;opacity:0;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;letter-spacing:.2em"></div>
    <div data-lock style="position:absolute;left:50%;bottom:28px;transform:translateX(-50%);font-size:13px;letter-spacing:.08em">点击画面锁定鼠标</div>`;
  mount.appendChild(hud);

  const lock = hud.querySelector<HTMLElement>('[data-lock]')!;
  const ammo = hud.querySelector<HTMLElement>('[data-ammo]')!;
  const mobilityText = hud.querySelector<HTMLElement>('[data-mobility]')!;
  const slowVignette = hud.querySelector<HTMLElement>('[data-slow-vignette]')!;
  const stateLine = hud.querySelector<HTMLElement>('[data-state]')!;
  const healthLine = hud.querySelector<HTMLElement>('[data-health]')!;
  const debugLine = hud.querySelector<HTMLElement>('[data-debug]')!;
  const objectiveLine = hud.querySelector<HTMLElement>('[data-objective]')!;
  const cross = hud.querySelector<HTMLElement>('[data-cross]')!;
  const hurt = hud.querySelector<HTMLElement>('[data-hurt]')!;
  const hurtDir = hud.querySelector<HTMLElement>('[data-hurt-dir]')!;
  const doorPrompt = hud.querySelector<HTMLElement>('[data-door]')!;
  const death = hud.querySelector<HTMLElement>('[data-death]')!;
  const SHOT_FLASH = 0.14;
  const HURT_FLASH = 0.55;
  const DEATH_FADE = 1.1;
  let shotUntil = 0;
  let hurtUntil = 0;
  let hurtAngle = 0;
  let deathUntil = 0;
  const remaining = (until: number, span: number, now: number): number =>
    until <= now ? 0 : Math.min(1, (until - now) / span);
  const status = (active: number, cooldown: number): string =>
    active > 0 ? `生效 ${active.toFixed(1)}s` : cooldown > 0 ? `冷却 ${cooldown.toFixed(1)}s` : '就绪';

  return {
    setLocked: (locked) => {
      lock.textContent = locked ? 'ESC 释放鼠标' : '点击画面锁定鼠标';
    },
    onShot: (realElapsed) => {
      shotUntil = realElapsed + SHOT_FLASH;
    },
    onDamage: (realElapsed, angleDeg) => {
      hurtUntil = realElapsed + HURT_FLASH;
      hurtAngle = angleDeg;
    },
    onDeath: (realElapsed, restartCount) => {
      deathUntil = realElapsed + DEATH_FADE;
      death.textContent = `你死了 · 第 ${restartCount} 次`;
    },
    update: (frame) => {
      lock.style.opacity = String(0.65 + Math.sin(frame.realElapsed * 3) * 0.2);
      const countdowns = getMobilityHudCountdowns(frame.mobility);
      ammo.textContent = frame.shotgun.reloading
        ? `${frame.shotgun.shells} / 8 · 换弹`
        : `${frame.shotgun.shells} / 8`;
      mobilityText.innerHTML = [
        `短跑　${status(countdowns.sprintRemaining, countdowns.sprintCooldownRemaining)}`,
        `慢动作　${status(countdowns.slowMotionRemaining, countdowns.slowMotionCooldownRemaining)}`,
        '迈坎　靠近橙色 35 cm 路沿后按 Space',
      ].join('<br>');
      const slow = frame.mobility.slowMotionRemaining > 0;
      slowVignette.style.borderWidth = slow ? '5px' : '0';
      slowVignette.style.boxShadow = slow
        ? 'inset 0 0 70px rgba(75,155,255,.24)'
        : 'inset 0 0 70px transparent';
      const target = SEGMENT_KILL_TARGETS[frame.slice.phase as keyof typeof SEGMENT_KILL_TARGETS];
      objectiveLine.textContent = target === undefined
        ? PHASE_OBJECTIVES[frame.slice.phase]
        : `${PHASE_OBJECTIVES[frame.slice.phase]} — 已清 ${frame.slice.kills}/${target}`;
      stateLine.textContent = `${frame.slice.phase}${frame.slice.restartCount > 0 ? ` · 重试 ${frame.slice.restartCount}` : ''}`;
      const graceRemaining = Math.max(0, frame.graceEndsAt - frame.gameElapsed);
      healthLine.textContent = graceRemaining > 0
        ? `生命 ${frame.playerVitality.health} / 100 · 无敌 ${graceRemaining.toFixed(1)}s`
        : `生命 ${frame.playerVitality.health} / 100`;
      debugLine.textContent = frame.debugEnabled
        ? `DEV 演示：K 注入击杀 · X 注入死亡 · 同时探头 ${frame.exposedEnemies}`
        : '';
      const shot = remaining(shotUntil, SHOT_FLASH, frame.realElapsed);
      cross.style.transform = `translate(-50%,-50%) scale(${1 + shot * 2.2})`;
      cross.style.opacity = String(0.75 + shot * 0.25);
      const bleed = remaining(hurtUntil, HURT_FLASH, frame.realElapsed);
      hurt.style.opacity = String(bleed);
      hurtDir.style.opacity = String(bleed);
      hurtDir.style.transform = `rotate(${hurtAngle}deg)`;
      doorPrompt.style.opacity = frame.slice.doorUnlocked
        ? String(0.72 + Math.sin(frame.realElapsed * 4) * 0.28)
        : '0';
      death.style.opacity = String(remaining(deathUntil, DEATH_FADE, frame.realElapsed));
    },
    dispose: () => hud.remove(),
  };
}

export function createRainAlleyPresentation(
  world: World,
  canvas: HTMLCanvasElement,
  player: EntityHandle,
  ctx?: PresentationHost,
): RainAlleyPresentation {
  const onCleanup = ctx?.registerCleanup ?? (() => {});
  const dpr = window.devicePixelRatio || 1;
  const sizeCanvas = (): number => {
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    return canvas.width / Math.max(1, canvas.height);
  };
  let aspect = sizeCanvas();
  const onResize = (): void => {
    aspect = sizeCanvas();
  };
  window.addEventListener('resize', onResize);
  onCleanup(() => window.removeEventListener('resize', onResize));

  installWhiteboxPlayerVisual(world, player);
  world.addComponent(player, {
    component: Visibility,
    data: { state: VisibilityStateValue.visible },
  }).unwrap();
  const hud = installHud(ctx?.uiRoot ?? canvas.parentElement ?? document.body);
  const shotSound = new ShotSound();
  onCleanup(() => hud.dispose());
  onCleanup(() => shotSound.dispose());

  // Keep the district readable at night with one directional and ambient fill.
  world.spawn({
    component: Skylight,
    data: { color: [0.18, 0.23, 0.34], intensity: 0.72 },
  });
  world.spawn({
    component: DirectionalLight,
    data: {
      direction: [0.28, -1, 0.12],
      color: [0.55, 0.48, 0.42],
      intensity: 0.9,
      castShadow: true,
    },
  });
  const camera = world.spawn(
    { component: Transform, data: { pos: [0.9, 3, 12.2] } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: Math.PI / 3.25, aspect, near: 0.08, far: 100 }),
        clearColor: [0.035, 0.045, 0.07, 1],
      },
    },
  ).unwrap();
  const cameraEye: [number, number, number] = [0.9, 3, 12.2];
  const cameraRotation = quat.create();
  const flashPool = createEffectPool(
    world,
    2,
    createWhiteboxMaterial(world, [1, 0.68, 0.12, 1], 0.25),
  );
  const shellPool = createEffectPool(
    world,
    8,
    createWhiteboxMaterial(world, [0.7, 0.46, 0.12, 1], 0.4),
  );
  const sparkPool = createEffectPool(
    world,
    8,
    createWhiteboxMaterial(world, [1, 0.82, 0.25, 1], 0.3),
  );
  const tracerPool = createEffectPool(
    world,
    3,
    createWhiteboxMaterial(world, [1, 0.93, 0.62, 1], 0.15),
  );
  const corpsePool = createEffectPool(
    world,
    4,
    createWhiteboxMaterial(world, [0.12, 0.05, 0.06, 1], 0.9),
  );
  const effectSlots = [
    ...flashPool,
    ...shellPool,
    ...sparkPool,
    ...tracerPool,
    ...corpsePool,
  ];
  const hitMaterial = createWhiteboxMaterial(world, [1, 1, 1, 1], 0.2);
  const hitFlashes: HitFlash[] = [];
  const markerState = new Map<EntityHandle, 'off' | 'covered' | 'exposed'>();
  let flashCursor = 0;
  let shellCursor = 0;
  let sparkCursor = 0;
  let tracerCursor = 0;
  let corpseCursor = 0;
  let recoil = 0;
  hud.setLocked(false);

  return {
    createEnemyMarker: (parent, height) => world.spawn(
      { component: Transform, data: { pos: [0, height, 0], scale: [0, 0, 0] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      {
        component: MeshRenderer,
        data: {
          materials: [createWhiteboxMaterial(world, [1, 0.86, 0.3, 1], 0.2)],
        },
      },
      { component: ChildOf, data: { parent } },
    ).unwrap(),
    setPointerLocked: (locked) => hud.setLocked(locked),
    playShot: ({ realElapsed, origin, aim, yaw, tracerLength }) => {
      shotSound.play();
      hud.onShot(realElapsed);
      recoil = 1;
      const flash = flashPool[flashCursor++ % flashPool.length]!;
      flash.until = realElapsed + 0.22;
      world.set(flash.entity, Transform, {
        pos: [origin[0] + aim[0], origin[1] + 1.05 + aim[1], origin[2] + aim[2]],
        scale: [0.9, 0.9, 0.9],
      });
      const shell = shellPool[shellCursor++ % shellPool.length]!;
      shell.until = realElapsed + 0.45;
      world.set(shell.entity, Transform, {
        pos: [
          origin[0] + Math.cos(yaw) * 0.65,
          origin[1] + 0.85,
          origin[2] - Math.sin(yaw) * 0.65,
        ],
        scale: [0.08, 0.18, 0.08],
      });
      const tracer = tracerPool[tracerCursor++ % tracerPool.length]!;
      tracer.until = realElapsed + 0.2;
      const tracerRotation = quat.create();
      quat.fromLookAt(
        tracerRotation,
        [origin[0], origin[1] + 1.05, origin[2]],
        [
          origin[0] + aim[0] * tracerLength,
          origin[1] + 1.05 + aim[1] * tracerLength,
          origin[2] + aim[2] * tracerLength,
        ],
        [0, 1, 0],
      );
      world.set(tracer.entity, Transform, {
        pos: [
          origin[0] + aim[0] * tracerLength * 0.5,
          origin[1] + 1.05 + aim[1] * tracerLength * 0.5,
          origin[2] + aim[2] * tracerLength * 0.5,
        ],
        quat: [
          tracerRotation[0]!,
          tracerRotation[1]!,
          tracerRotation[2]!,
          tracerRotation[3]!,
        ],
        scale: [0.14, 0.14, tracerLength],
      });
    },
    showEnemyMuzzle: (realElapsed, position) => {
      const muzzle = flashPool[flashCursor++ % flashPool.length]!;
      muzzle.until = realElapsed + 0.06;
      world.set(muzzle.entity, Transform, {
        pos: [...position],
        scale: [0.18, 0.18, 0.18],
      });
    },
    showEnemyHit: (entity, material, realElapsed) => {
      world.set(entity, MeshRenderer, { materials: [hitMaterial] });
      const existing = hitFlashes.find((flash) => flash.entity === entity);
      if (existing) existing.until = realElapsed + 0.09;
      else hitFlashes.push({ entity, material, until: realElapsed + 0.09 });
    },
    showEnemyKilled: (position, realElapsed) => {
      const corpse = corpsePool[corpseCursor++ % corpsePool.length]!;
      corpse.until = realElapsed + 3.5;
      world.set(corpse.entity, Transform, {
        pos: [position[0], 0.14, position[2]],
        scale: [0.78, 0.28, 1.7],
      });
    },
    showPelletHits: (position, pelletCount, realElapsed) => {
      for (let pellet = 0; pellet < pelletCount; pellet += 1) {
        const spark = sparkPool[sparkCursor++ % sparkPool.length]!;
        const offset = (pellet - 3.5) * 0.035;
        spark.until = realElapsed + 0.12;
        world.set(spark.entity, Transform, {
          pos: [
            position[0] + offset,
            position[1] + Math.abs(offset),
            position[2] - 0.7,
          ],
          scale: [0.05, 0.05, 0.05],
        });
      }
    },
    setEnemyMarker: (marker, state) => {
      if (markerState.get(marker) === state) return;
      markerState.set(marker, state);
      world.set(marker, Transform, {
        scale: state === 'off'
          ? [0, 0, 0]
          : state === 'covered'
            ? [0.16, 0.16, 0.16]
            : [0.42, 0.42, 0.42],
      });
    },
    showDamage: (realElapsed, angleDeg) => hud.onDamage(realElapsed, angleDeg),
    showDeath: (realElapsed, restartCount) => hud.onDeath(realElapsed, restartCount),
    update: (frame) => {
      const transform = world.get(player, Transform);
      if (!transform.ok) return;
      const px = transform.value.pos[0] ?? 0;
      const py = transform.value.pos[1] ?? 0.88;
      const pz = transform.value.pos[2] ?? 0;
      const forwardX = -Math.sin(frame.yaw);
      const forwardZ = -Math.cos(frame.yaw);
      const rightX = Math.cos(frame.yaw);
      const rightZ = -Math.sin(frame.yaw);
      recoil = Math.max(0, recoil - frame.realDelta * 7);
      const kick = recoil * recoil;
      const desiredEye: [number, number, number] = [
        px - forwardX * (4.2 + kick * 0.45) + rightX * 0.9,
        py + 2.15 + kick * 0.12,
        pz - forwardZ * (4.2 + kick * 0.45) + rightZ * 0.9,
      ];
      const follow = 1 - Math.exp(-14 * frame.realDelta);
      cameraEye[0] += (desiredEye[0] - cameraEye[0]) * follow;
      cameraEye[1] += (desiredEye[1] - cameraEye[1]) * follow;
      cameraEye[2] += (desiredEye[2] - cameraEye[2]) * follow;
      // Pull the shoulder camera in immediately when a shop wall blocks it.
      // Start above the player capsule so the ray does not hit the player.
      const eyeAnchor = vec3.create(px, py + 1.05, pz);
      const eyeDelta = vec3.create(
        cameraEye[0] - eyeAnchor[0]!,
        cameraEye[1] - eyeAnchor[1]!,
        cameraEye[2] - eyeAnchor[2]!,
      );
      const eyeDistance = Math.hypot(eyeDelta[0]!, eyeDelta[1]!, eyeDelta[2]!);
      if (eyeDistance > 0.001) {
        const direction = vec3.create(
          eyeDelta[0]! / eyeDistance,
          eyeDelta[1]! / eyeDistance,
          eyeDelta[2]! / eyeDistance,
        );
        const hit = world.getResource<PhysicsWorld>('PhysicsWorld')
          .raycast(eyeAnchor, direction, eyeDistance + 0.2);
        if (hit) {
          const safeDistance = Math.max(0, hit.timeOfImpact - 0.2);
          if (safeDistance < eyeDistance) {
            cameraEye[0] = eyeAnchor[0]! + direction[0]! * safeDistance;
            cameraEye[1] = eyeAnchor[1]! + direction[1]! * safeDistance;
            cameraEye[2] = eyeAnchor[2]! + direction[2]! * safeDistance;
          }
        }
      }
      const cameraCloseToPlayer = Math.hypot(
        cameraEye[0] - px,
        cameraEye[1] - eyeAnchor[1]!,
        cameraEye[2] - pz,
      ) < 2.8;
      world.set(player, Visibility, {
        state: cameraCloseToPlayer
          ? VisibilityStateValue.hidden
          : VisibilityStateValue.visible,
      });
      const target: [number, number, number] = [
        px + forwardX * 5,
        py + 1.05 + Math.tan(frame.pitch) * 5 + kick * 0.9,
        pz + forwardZ * 5,
      ];
      quat.fromLookAt(cameraRotation, cameraEye, target, [0, 1, 0]);
      world.set(camera, Transform, {
        pos: cameraEye,
        quat: [
          cameraRotation[0]!,
          cameraRotation[1]!,
          cameraRotation[2]!,
          cameraRotation[3]!,
        ],
      });
      world.set(camera, Camera, {
        ...perspective({ fov: Math.PI / 3.25, aspect, near: 0.08, far: 100 }),
        clearColor: [0.035, 0.045, 0.07, 1],
      });
      for (const slot of effectSlots) {
        if (slot.until !== 0 && frame.realElapsed >= slot.until) {
          slot.until = 0;
          world.set(slot.entity, Transform, {
            pos: [0, -20, 0],
            scale: [0, 0, 0],
          });
        }
      }
      for (let index = hitFlashes.length - 1; index >= 0; index -= 1) {
        const flash = hitFlashes[index]!;
        if (frame.realElapsed < flash.until) continue;
        world.set(flash.entity, MeshRenderer, { materials: [flash.material] });
        hitFlashes.splice(index, 1);
      }
      hud.update(frame);
    },
  };
}
