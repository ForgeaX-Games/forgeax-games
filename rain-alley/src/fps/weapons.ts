/** Distilled handling concepts from FPS Gym; no legacy cooked assets. Units: seconds, metres, degrees. */
export type Weapon = {
  id: string;
  asset: string;
  reloadStyle: 'magazine' | 'revolver' | 'shell' | 'clip' | 'belt';
  name: string;
  family: 'pistol' | 'smg' | 'rifle' | 'lmg' | 'dmr' | 'sniper' | 'shotgun';
  mode: 'semi' | 'auto' | 'burst';
  rpm: number;
  magazine: number;
  reload: number;
  damage: number;
  range: number;
  pellets: number;
  hip: number;
  ads: number;
  recoil: number;
  recovery: number;
  adsTime: number;
  zoom: number;
  length: number;
  tint: [number, number, number, number];
  pitch: number;
};
const steel: Weapon['tint'] = [0.11, 0.14, 0.17, 1];
const tan: Weapon['tint'] = [0.38, 0.29, 0.17, 1];
function gun(
  id: string,
  name: string,
  family: Weapon['family'],
  mode: Weapon['mode'],
  rpm: number,
  magazine: number,
  reload: number,
  damage: number,
  recoil: number,
  extra: Partial<Weapon> = {},
): Weapon {
  return {
    id,
    asset: id,
    reloadStyle: 'magazine',
    name,
    family,
    mode,
    rpm,
    magazine,
    reload,
    damage,
    recoil,
    range: 100,
    pellets: 1,
    hip: 1.8,
    ads: 0.08,
    recovery: 10,
    adsTime: 0.18,
    zoom: 62,
    length: 0.65,
    tint: steel,
    pitch: 110,
    ...extra,
  };
}
export const WEAPONS: readonly Weapon[] = [
  gun('m4', 'CAR-15 · 短管卡賓', 'rifle', 'auto', 720, 30, 1.9, 26, 0.65, {
    asset: 'car15',
    hip: 1.25,
    tint: tan,
  }),
  gun('ak', '五六式 · 木托步槍', 'rifle', 'auto', 600, 30, 2.2, 34, 1.1, {
    asset: 'type56',
    hip: 2.2,
    recovery: 8,
    tint: [0.27, 0.12, 0.055, 1],
    pitch: 88,
  }),
  gun('mp5', 'MP5 · 衝鋒槍', 'smg', 'auto', 800, 30, 1.65, 21, 0.48, {
    hip: 1.1,
    length: 0.47,
    range: 65,
    adsTime: 0.13,
    pitch: 155,
  }),
  gun('vector', 'UZI · 摺托衝鋒槍', 'smg', 'auto', 600, 32, 1.8, 18, 0.4, {
    asset: 'uzi',
    hip: 1,
    length: 0.4,
    range: 45,
    adsTime: 0.12,
    tint: tan,
    pitch: 180,
  }),
  gun('g17', 'HI-POWER · 勃朗寧', 'pistol', 'semi', 360, 13, 1.35, 30, 1.4, {
    asset: 'hipower',
    hip: 1.15,
    length: 0.23,
    range: 55,
    adsTime: 0.1,
    zoom: 68,
    pitch: 176,
  }),
  gun('magnum', 'MODEL 10 · 點三八', 'pistol', 'semi', 210, 6, 2.6, 72, 3, {
    asset: 'model10',
    reloadStyle: 'revolver',
    length: 0.25,
    tint: [0.48, 0.5, 0.52, 1],
    pitch: 68,
  }),
  gun('burst', 'M16A2 · 三連發', 'rifle', 'burst', 950, 30, 2.1, 28, 0.6, {
    asset: 'm16',
    length: 0.8,
    hip: 1.6,
    tint: [0.14, 0.22, 0.16, 1],
  }),
  gun('m249', 'MINIMI · 班用機槍', 'lmg', 'auto', 750, 100, 4.2, 25, 0.85, {
    asset: 'minimi',
    reloadStyle: 'belt',
    hip: 2.6,
    adsTime: 0.32,
    length: 0.78,
    pitch: 95,
  }),
  gun('sks', 'SKS · 木托半自動', 'dmr', 'semi', 300, 10, 2.4, 60, 1.8, {
    reloadStyle: 'clip',
    hip: 2.8,
    zoom: 45,
    length: 0.82,
    adsTime: 0.23,
    pitch: 78,
    tint: tan,
  }),
  gun('awm', 'L96 · 栓動狙擊', 'sniper', 'semi', 48, 5, 3.1, 120, 4.1, {
    asset: 'l96',
    hip: 5,
    ads: 0.018,
    zoom: 24,
    length: 0.92,
    adsTime: 0.34,
    pitch: 52,
    tint: [0.19, 0.26, 0.15, 1],
  }),
  gun('pump', 'M870 · 泵動霰彈', 'shotgun', 'semi', 75, 8, 2.8, 16, 3.4, {
    asset: 'm870',
    reloadStyle: 'shell',
    pellets: 9,
    hip: 3.4,
    ads: 2.2,
    range: 32,
    length: 0.8,
    pitch: 62,
  }),
  gun(
    'auto12',
    'SPAS-12 · 半自動霰彈',
    'shotgun',
    'semi',
    210,
    8,
    3.3,
    11,
    2.1,
    {
      asset: 'spas12',
      reloadStyle: 'shell',
      pellets: 8,
      hip: 4.3,
      ads: 2.8,
      range: 27,
      length: 0.62,
      pitch: 74,
      tint: tan,
    },
  ),
];
export type Arsenal = {
  selected: number;
  ammo: number[];
  readyAt: number;
  reloadStart: number;
  reloadEnd: number;
  shellNext: number;
  reloadInitial: number;
  nextShot: number;
  burstLeft: number;
  shotIndex: number;
  lastShot: number;
  bloom: number;
};
export function createArsenal(): Arsenal {
  return {
    selected: 0,
    ammo: WEAPONS.map((w) => w.magazine),
    readyAt: 0,
    reloadStart: 0,
    reloadEnd: 0,
    shellNext: 0,
    reloadInitial: 0,
    nextShot: 0,
    burstLeft: 0,
    shotIndex: 0,
    lastShot: -10,
    bloom: 0,
  };
}
export function selectWeapon(s: Arsenal, index: number, now: number): boolean {
  index = ((index % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
  if (index === s.selected) return false;
  s.selected = index;
  s.readyAt = now + 0.28;
  s.reloadEnd = 0;
  s.burstLeft = 0;
  s.shotIndex = 0;
  s.bloom = 0;
  s.nextShot = s.readyAt;
  return true;
}
export function reload(s: Arsenal, now: number): boolean {
  const w = WEAPONS[s.selected];
  if (s.reloadEnd || s.ammo[s.selected] === w.magazine || now < s.readyAt)
    return false;
  s.reloadStart = now;
  s.reloadInitial = s.ammo[s.selected];
  s.reloadEnd =
    now +
    (w.reloadStyle === 'shell'
      ? 0.65 + (w.magazine - s.reloadInitial) * 0.55 + 0.25
      : w.reload);
  s.shellNext = now + 1.2;
  s.burstLeft = 0;
  return true;
}
/** At most one shot per visible frame: a stall cannot produce a catch-up damage burst. */
export function tickWeapon(
  s: Arsenal,
  now: number,
  dt: number,
  held: boolean,
  pressed: boolean,
): boolean {
  const w = WEAPONS[s.selected];
  s.bloom = Math.max(0, s.bloom - dt * 3);
  if (now - s.lastShot > 0.3) s.shotIndex = Math.max(0, s.shotIndex - dt * 60);
  if (s.reloadEnd && w.reloadStyle === 'shell') {
    while (now >= s.shellNext && s.ammo[s.selected] < w.magazine) {
      s.ammo[s.selected]++;
      s.shellNext += 0.55;
    }
    if (pressed && s.ammo[s.selected] > 0) {
      s.reloadEnd = 0;
      s.readyAt = now + 0.18;
    }
  }
  if (s.reloadEnd && now >= s.reloadEnd) {
    s.ammo[s.selected] = w.magazine;
    s.reloadEnd = 0;
  }
  if (s.reloadEnd || now < s.readyAt) return false;
  if (w.mode === 'burst' && pressed && now >= s.nextShot) s.burstLeft = 3;
  const wants =
    w.mode === 'auto' ? held : w.mode === 'burst' ? s.burstLeft > 0 : pressed;
  if (!wants) {
    if (w.mode === 'auto') s.nextShot = now;
    return false;
  }
  if (now + 1e-6 < s.nextShot) return false;
  if (s.ammo[s.selected] <= 0) {
    reload(s, now);
    return false;
  }
  const period = 60 / w.rpm;
  s.nextShot = Math.max(s.nextShot + period, now + Math.min(period, 0.008));
  if (w.mode === 'burst' && --s.burstLeft === 0) s.nextShot = now + 0.21;
  s.ammo[s.selected]--;
  s.shotIndex++;
  s.lastShot = now;
  s.bloom = Math.min(2.2, s.bloom + (w.family === 'smg' ? 0.13 : 0.22));
  return true;
}
/** Exponential follow: identical time constant at 30/60/144 Hz. Never apply to mouse aim. */
export function follow(
  current: number,
  target: number,
  rate: number,
  dt: number,
): number {
  return target + (current - target) * Math.exp(-rate * dt);
}
export function spreadDegrees(
  w: Weapon,
  ads: number,
  speed: number,
  bloom: number,
): number {
  return (
    (w.hip + bloom + speed * 0.1) * (1 - ads) +
    (w.ads + bloom * 0.06 + speed * 0.025) * ads
  );
}
