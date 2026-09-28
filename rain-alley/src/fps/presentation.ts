import type { World, EntityHandle } from '@forgeax/engine-ecs';
import {
  Camera,
  TONEMAP_AGX,
  ANTIALIAS_FXAA,
  BLOOM_ENABLED,
  DirectionalLight,
  Skylight,
  MeshFilter,
  MeshRenderer,
  Materials,
  perspective,
  Visibility,
  VisibilityStateValue,
} from '@forgeax/engine-render';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { TextureAsset } from '@forgeax/engine-types';
import { Transform, ChildOf, Name } from '@forgeax/engine-scene';
import { quat } from '@forgeax/engine-runtime';
import { createShotEffects, muzzleMesh } from './shot-effects';
import { createRainNight } from './weather';
import { GunAudio } from './audio';
import { loadModel, pose, type Model } from './models';
import type { StreetAssets } from '../street';
import { WEAPONS, follow, type Arsenal } from './weapons';

export async function createFpsPresentation(
  world: World,
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  assets: StreetAssets,
) {
  const camera = world
    .spawn(
      { component: Transform, data: { pos: [0, 1.62, -3] } },
      {
        component: Camera,
        data: {
          ...perspective({
            fov: (80 * Math.PI) / 180,
            aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
            near: 0.025,
            far: 125,
          }),
          clearColor: [0.007, 0.012, 0.021, 1],
          tonemap: TONEMAP_AGX,
          exposure: 1.15,
          antialias: ANTIALIAS_FXAA,
          bloom: BLOOM_ENABLED,
          bloomThreshold: 1.1,
          bloomIntensity: 0.12,
          bloomBlurRadius: 3,
        },
      },
    )
    .unwrap();
  const skyGuid = AssetGuid.parse('b8420c05-f652-4623-bc27-c3d7d1aee946');
  if (!skyGuid.ok) throw new Error('Invalid city panorama GUID');
  const sky = await assets.loadByGuid<TextureAsset>(skyGuid.value);
  if (!sky.ok) throw new Error(`City panorama: ${sky.error?.code}`);
  // Textured sky dome avoids the pinned engine's dark IBL initialization path.
  const skyMaterial = world.internSharedRef(
    'MaterialAsset',
    Materials.unlit([1, 1, 1, 1], {
      baseColorTexture: { texture: skyGuid.value },
      castShadow: false,
      queue: 1000,
      renderState: { cullMode: 'none', depthWriteEnabled: false },
    }),
  );
  const skyDome = world
    .spawn(
      { component: Name, data: { value: 'RainNight_CitySky' } },
      { component: Transform, data: { scale: [100, 100, 100] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [skyMaterial] } },
    )
    .unwrap();
  world.spawn({
    component: Skylight,
    data: { color: [0.26, 0.32, 0.43], intensity: 0.28 },
  });
  world.spawn({
    component: DirectionalLight,
    data: {
      direction: [0.35, -1, -0.28],
      color: [0.4, 0.54, 0.72],
      intensity: 0.45,
      castShadow: true,
      cascadeCount: 1,
      mapSize: 1024,
      shadowDistance: 36,
    },
  });
  const weather = createRainNight(world);
  type V = [number, number, number];
  const effects = createShotEffects(world, camera);
  const flashMesh = world.allocSharedRef('MeshAsset', muzzleMesh());
  const flashMaterial = world.internSharedRef(
    'MaterialAsset',
    Materials.unlit([5, 1.8, 0.25, 1], {
      castShadow: false,
      renderState: { cullMode: 'none' },
    }),
  );
  const models: (Model & { muzzle: EntityHandle })[] = [];
  for (const w of WEAPONS) {
    const model = await loadModel(world, assets, w.asset, camera);
    const marker = model.parts.get('MUZZLE');
    const muzzle = world
      .spawn(
        {
          component: Transform,
          data: { pos: marker?.pos ?? [0, 0.07, -w.length], scale: [0, 0, 0] },
        },
        { component: ChildOf, data: { parent: model.root } },
        { component: MeshFilter, data: { assetHandle: flashMesh } },
        { component: MeshRenderer, data: { materials: [flashMaterial] } },
      )
      .unwrap();
    models.push({ ...model, muzzle });
  }
  const hud = document.createElement('div');
  hud.className = 'rain-fps';
  hud.innerHTML = `<style>
.rain-fps{position:absolute;inset:0;pointer-events:none;color:#e8e3d6;font:12px 'PingFang TC','Microsoft JhengHei',sans-serif;z-index:20;text-shadow:0 1px 5px #0009}.rain-fps *{box-sizing:border-box}.rf-top{position:absolute;left:34px;top:27px;letter-spacing:2px;border-left:2px solid #b54132;padding-left:13px}.rf-top b{display:block;font:24px 'Songti TC','Noto Serif TC',serif;letter-spacing:5px}.rf-top small{color:#aaa59a;letter-spacing:3px;font-size:10px}.rf-score{font-size:10px;color:#aaa59a;letter-spacing:2px;margin-top:12px}.rf-case{position:absolute;right:34px;top:29px;text-align:right;letter-spacing:2px;color:#aaa59a;font-size:10px;line-height:1.9}.rf-case b{color:#c84b39;letter-spacing:4px;font-size:11px}.rf-ammo{position:absolute;right:34px;bottom:36px;text-align:right;min-width:190px}.rf-ammo strong{font:58px Georgia,serif;letter-spacing:-2px}.rf-ammo span{color:#a29e93;font:14px monospace}.rf-name{letter-spacing:2px;font-size:11px;border-bottom:1px solid #d2c7b338;padding-bottom:9px;margin-bottom:3px}.rf-controls{position:absolute;bottom:30px;left:34px;color:#9b9b91;font-size:10px;letter-spacing:1px;line-height:2}.rf-controls b{font:15px 'Songti TC',serif;letter-spacing:4px;color:#d8d2c4;display:block;margin-bottom:5px}.rf-audio{color:#b5aa98}.rf-center{position:absolute;left:50%;top:50%;width:0;height:0}.rf-cross{position:absolute;left:-1px;top:-1px;width:2px;height:2px;background:#eae7db}.rf-line{position:absolute;width:5px;height:1px;background:#e0dbce;transform-origin:center}.rf-hit{position:absolute;left:-12px;top:-14px;font-size:24px;color:#eee;opacity:0}.rf-toast{position:absolute;top:57%;width:100%;text-align:center;color:#c6a58e;font-size:11px;letter-spacing:5px}.rf-start{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding-left:12%;background:linear-gradient(90deg,#14191bed,rgba(13,20,23,.55) 55%,transparent);pointer-events:auto}.rf-start:before{content:'九龍 · 1990 / CASE FILE 017';font-size:11px;letter-spacing:4px;color:#afaaa0;margin-bottom:24px}.rf-start h1{font:clamp(36px,5vw,65px) 'Songti TC',serif;letter-spacing:10px;margin:0;border-top:1px solid #b5aa9766;padding-top:23px}.rf-start p{color:#b9b2a5;line-height:2.4;letter-spacing:2px;font-size:12px;margin:26px 0 30px}.rf-start button,.rf-armory button{background:transparent;border:1px solid #9c928047;color:#e7dfcf;cursor:pointer;font:inherit}.rf-start button{background:#93382d;border:1px solid #ae5947;letter-spacing:5px;padding:15px 35px}.rf-start button:hover{background:#aa4936}.rf-armory{position:absolute;inset:7% 8%;background:#181d1df5;border:1px solid #a89c7d55;padding:25px 30px;pointer-events:auto;display:none;overflow:auto;box-shadow:0 24px 70px #0009}.rf-armory h2{font:24px 'Songti TC',serif;letter-spacing:5px;margin:0 0 22px}.rf-armory h2 small{font:10px monospace;letter-spacing:2px;color:#aaa18c}.rf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.rf-armory button{text-align:left;padding:12px;min-height:122px;position:relative;background:linear-gradient(135deg,#34382e44,transparent)}.rf-armory button:hover,.rf-armory button[data-active=true]{border-color:#b26449;background:#5b3a292f}.rf-armory button small{display:block;color:#9d9c8c;font:10px monospace;margin-top:8px}.rf-armory img{display:block;width:100%;height:64px;object-fit:contain;margin-bottom:10px;filter:drop-shadow(1px 4px 2px #0008)}.rf-reload{height:2px;background:#bd4936;margin-top:8px;transform-origin:left}.rf-scope{position:absolute;inset:0;display:none;background:radial-gradient(circle closest-side at center,transparent 0 84%,#070808 85%);pointer-events:none}.rf-scope:after{content:'';position:absolute;left:50%;top:8%;height:84%;border-left:1px solid #171711}.rf-scope:before{content:'';position:absolute;left:26%;top:50%;width:48%;border-top:1px solid #171711}@media(max-width:700px){.rf-top{left:18px;top:18px}.rf-case{right:18px;top:18px}.rf-top b{font-size:18px}.rf-controls{left:18px;bottom:16px;font-size:9px}.rf-ammo{right:18px;bottom:90px}.rf-ammo strong{font-size:42px}.rf-armory{inset:10px;padding:18px}.rf-grid{grid-template-columns:repeat(2,1fr)}.rf-start{padding-left:8%}.rf-start h1{letter-spacing:6px}.rf-start p{max-width:85%}.rf-armory button{min-height:110px}}
</style><div class="rf-scope"></div><div class="rf-top"><small>CHAPTER 01 · 九龍雨夜</small><b>雨夜不回頭</b><p class="rf-score"></p></div><div class="rf-case"><b>案件 017</b><br>23:17 · 雨勢持續<br>街區演練 / LIVE</div><div class="rf-center"><i class="rf-cross"></i>${[0, 1, 2, 3].map(() => '<i class="rf-line"></i>').join('')}<span class="rf-hit">×</span></div><div class="rf-toast"></div><div class="rf-ammo"><div class="rf-name"></div><strong></strong> <span></span><div class="rf-reload"></div></div><div class="rf-controls"><b>九龍 / 後巷</b>WASD 移動 · Shift 奔跑 · Space 跳躍<br>右鍵 瞄準 · R 裝填 · Q/E 切槍 · B 裝備<br><span class="rf-audio">M · 聲音 開</span>　Esc 暫停</div><div class="rf-start"><h1>雨夜不回頭</h1><p>霓虹熄滅之前，穿過這條街。<br>十二件舊式槍械 · 四間店舖 · 一場九龍雨夜<br>街區演練：移動、射擊與裝填</p><button>進入街區　→</button></div><div class="rf-armory"><h2>裝備檔案 <small> / B 返回街區</small></h2><div class="rf-grid"></div></div>`;
  uiRoot.append(hud);
  const el = <T extends HTMLElement = HTMLElement>(s: string) =>
    hud.querySelector<T>(s)!;
  let chosen: number | null = null;
  for (const [i, w] of WEAPONS.entries()) {
    const button = document.createElement('button');
    button.innerHTML = `<img src="${new URL(`../../assets/arsenal/${w.asset}-card.png`, import.meta.url).href}" alt="">${String(i + 1).padStart(2, '0')}　${w.name}<small>${w.mode.toUpperCase()} · ${w.rpm} RPM · ${w.magazine} 發</small>`;
    button.onclick = () => {
      chosen = i;
      armory = false;
      activate();
    };
    el('.rf-grid').append(button);
  }
  let armory = false;
  const sound = new GunAudio();
  const activate = () => {
    sound.unlock();
    void canvas.requestPointerLock()?.catch(() => {
      /* Host reports lock rejection; next click retries. */
    });
  };
  el<HTMLButtonElement>('.rf-start button').onclick = activate;
  let ads = 0,
    kick = 0,
    swayX = 0,
    swayY = 0,
    bobPhase = 0,
    movementBlend = 0;
  let active = -1,
    flashUntil = 0,
    hitUntil = 0,
    killUntil = 0,
    hitHead = false,
    fov = 80;
  let reloadStamp = -1,
    cueIndex = 0,
    lastReloadAmmo = 0;
  let lastHud = '';
  return {
    camera,
    movement(now: number, speed: number, grounded: boolean, indoor: boolean) {
      sound.movement(now, speed, grounded, indoor);
    },
    enemyAttack(distance: number, pan: number, melee: boolean) {
      sound.enemy(distance, pan, melee);
    },
    hurt() {
      sound.hurt();
    },
    toggleSound() {
      const enabled = sound.toggle();
      el('.rf-audio').textContent = enabled ? 'M · 聲音 開' : 'M · 聲音 關';
    },
    takeSelection() {
      const value = chosen;
      chosen = null;
      return value;
    },
    toggleArmory() {
      armory = !armory;
      if (armory) document.exitPointerLock();
      else activate();
    },
    shot(index: number, now: number) {
      kick = Math.min(0.09, kick + 0.015 + WEAPONS[index].recoil * 0.006);
      flashUntil = now + 0.042;
      sound.shot(index);
      effects.shot(WEAPONS[index], now);
    },
    hit(now: number, killed: boolean, head: boolean) {
      hitUntil = now + 0.13;
      hitHead = head;
      if (killed) killUntil = now + 0.8;
      sound.hit(killed);
    },
    update(
      s: Arsenal,
      now: number,
      dt: number,
      eye: V,
      yaw: number,
      pitch: number,
      aim: number,
      speed: number,
      sprint: boolean,
      mx: number,
      my: number,
      locked: boolean,
      kills: number,
      hits: number,
      shots: number,
      obstruction: number,
    ) {
      world.set(skyDome, Transform, { pos: eye });
      weather.update(now, eye);
      effects.update(now, dt, eye, yaw, pitch, WEAPONS[s.selected].asset);
      const w = WEAPONS[s.selected];
      ads = aim;
      kick = follow(kick, 0, 19, dt);
      swayX = follow(
        swayX,
        Math.max(
          -0.02,
          Math.min(0.02, (-mx / Math.max(dt, 1 / 240)) * 0.000008),
        ),
        16,
        dt,
      );
      swayY = follow(
        swayY,
        Math.max(
          -0.015,
          Math.min(0.015, (my / Math.max(dt, 1 / 240)) * 0.0000065),
        ),
        16,
        dt,
      );
      movementBlend = follow(movementBlend, speed / 7.8, 12, dt);
      bobPhase += speed * dt * 2.4;
      fov = follow(fov, 80 + (w.zoom - 80) * ads + (sprint ? 5 : 0), 15, dt);
      const q = quat.create();
      quat.fromLookAt(
        q,
        eye,
        [
          eye[0] - Math.sin(yaw) * Math.cos(pitch),
          eye[1] + Math.sin(pitch),
          eye[2] - Math.cos(yaw) * Math.cos(pitch),
        ],
        [0, 1, 0],
      );
      world.set(camera, Transform, { pos: eye, quat: q });
      world.set(camera, Camera, {
        fov: (fov * Math.PI) / 180,
        aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
      });
      if (active !== s.selected) {
        if (active >= 0)
          world.set(models[active].root, Visibility, {
            state: VisibilityStateValue.hidden,
          });
        active = s.selected;
        world.set(models[active].root, Visibility, {
          state: VisibilityStateValue.visible,
        });
      }
      const model = models[active];
      const reloadT = s.reloadEnd
        ? Math.min(1, (now - s.reloadStart) / (s.reloadEnd - s.reloadStart))
        : 0;
      const ramp = (t: number, a: number, b: number) =>
        Math.max(0, Math.min(1, (t - a) / (b - a)));
      const hold = ramp(reloadT, 0, 0.15) * (1 - ramp(reloadT, 0.82, 1));
      const out = ramp(reloadT, 0.16, 0.3) * (1 - ramp(reloadT, 0.57, 0.72));
      const shell =
        s.reloadEnd && w.reloadStyle === 'shell'
          ? Math.sin(
              (Math.max(0, now - s.reloadStart - 0.65) / 0.55) * Math.PI * 2,
            )
          : 0;
      const switchDip = Math.max(0, (s.readyAt - now) / 0.28);
      const bob = movementBlend * (1 - ads * 0.9),
        scope = ads > 0.96 && (w.family === 'sniper' || w.family === 'dmr');
      const roll =
        hold * -0.5 + swayX - (sprint ? 0.17 : 0) + obstruction * 0.3;
      world.set(model.root, Transform, {
        pos: scope
          ? [0, -50, 0]
          : [
              0.18 * (1 - ads) +
                swayX * (1 - ads) +
                Math.sin(bobPhase) * 0.005 * bob +
                hold * 0.025,
              -0.195 +
                0.10375 * ads +
                swayY * (1 - ads) +
                Math.cos(bobPhase * 2) * 0.004 * bob -
                hold * 0.025 -
                switchDip * 0.24 -
                (sprint ? 0.03 : 0) -
                obstruction * 0.1,
              -0.34 - ads * 0.05 + kick + obstruction * 0.18,
            ],
        quat: [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)],
        scale: [0.73, 0.73, 0.73],
      });
      const age = now - s.lastShot,
        cycle =
          age > 0.1 && age < 0.65
            ? Math.sin(((age - 0.1) / 0.55) * Math.PI)
            : 0;
      pose(world, model, 'BOLT', [
        0,
        0,
        Math.max(0, 1 - age / 0.1) * 0.045 +
          (w.family === 'sniper' ? cycle * 0.1 : 0) +
          (w.reloadStyle === 'clip' ? hold * 0.06 : 0),
      ]);
      pose(world, model, 'PUMP', [0, 0, cycle * 0.105]);
      pose(
        world,
        model,
        'TRIGGER',
        [0, 0, 0],
        [Math.max(0, 1 - age / 0.09) * 0.18, 0, 0],
      );
      pose(
        world,
        model,
        'HAMMER',
        [0, 0, 0],
        [Math.max(0, 1 - age / 0.16) * -0.5, 0, 0],
      );
      const detachable =
        w.reloadStyle === 'magazine' || w.reloadStyle === 'belt';
      pose(
        world,
        model,
        'MAGAZINE',
        detachable ? [-out * 0.035, -out * 0.21, out * 0.05] : [0, 0, 0],
        [0, 0, detachable ? -out * 0.22 : 0],
      );
      pose(
        world,
        model,
        'CYLINDER',
        [-hold * 0.085, 0, 0],
        [0, 0, hold * 0.8 + ((w.magazine - s.ammo[s.selected]) * Math.PI) / 3],
      );
      pose(world, model, 'FEED_COVER', [0, 0, 0], [hold * -1.25, 0, 0]);
      pose(world, model, 'BELT', [-out * 0.05, out * 0.07, 0]);
      pose(world, model, 'CLIP', [0, (1 - out) * 0.1, 0]);
      const clipPart = model.parts.get('CLIP');
      if (clipPart)
        world.set(clipPart.entity, Transform, {
          scale:
            s.reloadEnd && reloadT > 0.2 && reloadT < 0.82
              ? [1, 1, 1]
              : [0, 0, 0],
        });
      const shellPart = model.parts.get('SHELL');
      if (shellPart)
        world.set(shellPart.entity, Transform, {
          scale: s.reloadEnd ? [1, 1, 1] : [0, 0, 0],
        });
      pose(world, model, 'SHELL', [
        -0.045 * hold,
        -0.035 * hold + shell * 0.045,
        0.04 * hold,
      ]);
      const left = model.parts.get('HAND_L'),
        mag = model.parts.get('MAGAZINE');
      let leftOffset: V = [
        -hold * 0.03,
        -hold * 0.05,
        hold * 0.04 + (w.asset === 'm870' ? cycle * 0.105 : 0),
      ];
      if (left && mag && detachable)
        leftOffset = [
          (mag.pos[0] - left.pos[0] - 0.03 - out * 0.035) * hold,
          (mag.pos[1] - left.pos[1] - 0.015 - out * 0.21) * hold,
          (mag.pos[2] - left.pos[2] + 0.02 + out * 0.05) * hold,
        ];
      if (w.reloadStyle === 'shell')
        leftOffset = [hold * 0.015, hold * (-0.03 + shell * 0.04), hold * 0.17];
      if (w.reloadStyle === 'revolver')
        leftOffset = [-hold * 0.065, hold * 0.065, hold * 0.075];
      if (w.reloadStyle === 'clip')
        leftOffset = [hold * 0.02, hold * 0.19, hold * 0.1];
      pose(world, model, 'HAND_L', leftOffset, [0, 0, hold * -0.3]);
      pose(world, model, 'HAND_R', [
        0,
        0,
        w.family === 'sniper' ? cycle * 0.06 : 0,
      ]);
      if (s.reloadEnd) {
        if (reloadStamp !== s.reloadStart) {
          reloadStamp = s.reloadStart;
          cueIndex = 0;
          if (w.reloadStyle === 'revolver')
            effects.revolver(now, w.magazine - s.ammo[s.selected]);
        }
        const cues =
          w.reloadStyle === 'shell'
            ? [
                [0.08, 'open'],
                [0.95, 'close'],
              ]
            : w.reloadStyle === 'belt'
              ? [
                  [0.15, 'open'],
                  [0.32, 'mag-out'],
                  [0.65, 'mag-in'],
                  [0.85, 'close'],
                ]
              : [
                  [0.2, 'mag-out'],
                  [0.65, 'mag-in'],
                  [0.85, 'rack'],
                ];
        while (cueIndex < cues.length && reloadT >= Number(cues[cueIndex][0])) {
          sound.cue(
            cues[cueIndex][1] as
              'open' | 'close' | 'mag-out' | 'mag-in' | 'rack',
          );
          cueIndex++;
        }
        if (w.reloadStyle === 'shell' && s.ammo[s.selected] !== lastReloadAmmo)
          sound.cue('shell');
      }
      lastReloadAmmo = s.ammo[s.selected];
      const flash = now < flashUntil && !scope ? 1 : 0;
      world.set(model.muzzle, Transform, {
        scale: [flash, flash, flash],
      });
      el('.rf-scope').style.display = scope ? 'block' : 'none';
      el('.rf-start').style.display = locked || armory ? 'none' : 'grid';
      el('.rf-armory').style.display = armory ? 'block' : 'none';
      const spread = 6 + (w.hip + s.bloom) * 3 * (1 - ads);
      hud.querySelectorAll<HTMLElement>('.rf-line').forEach((line, i) => {
        const a = (i * Math.PI) / 2;
        line.style.transform = `translate(${Math.cos(a) * spread - 4}px,${Math.sin(a) * spread - 1}px) rotate(${i * 90}deg)`;
        line.style.opacity = String(1 - ads);
      });
      el('.rf-hit').style.opacity = now < hitUntil ? '1' : '0';
      el('.rf-hit').style.color = hitHead ? '#ffd280' : '#fff';
      el('.rf-toast').textContent = now < killUntil ? '目標倒下' : '';
      el('.rf-reload').style.transform = `scaleX(${s.reloadEnd ? reloadT : 0})`;
      const hudState = `${s.selected}/${s.ammo[s.selected]}/${!!s.reloadEnd}/${kills}/${hits}/${shots}`;
      if (lastHud !== hudState) {
        el('.rf-name').textContent = w.name;
        hud
          .querySelectorAll<HTMLButtonElement>('.rf-grid button')
          .forEach((b, i) => {
            b.dataset.active = String(i === s.selected);
          });
        el('.rf-ammo strong').textContent = String(s.ammo[s.selected]).padStart(
          2,
          '0',
        );
        el('.rf-ammo span').textContent = s.reloadEnd
          ? '裝填中'
          : `/ ${w.magazine}　∞`;
        el('.rf-score').textContent =
          `擊倒 ${kills}　命中 ${shots ? Math.round((hits / shots) * 100) : 0}%`;
        lastHud = hudState;
      }
    },
    dispose() {
      hud.remove();
      sound.dispose();
    },
  };
}
