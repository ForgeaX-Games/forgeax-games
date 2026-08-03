export type KartKind =
  | 'classic'
  | 'banana'
  | 'slipper'
  | 'box'
  | 'hotdog'
  | 'melon'
  | 'duck'
  | 'donut'
  | 'rocket'
  | 'tub';
export type PetKind = 'dog' | 'duck' | 'panda';
export type OutfitKind =
  | 'none'
  | 'straw'
  | 'shades'
  | 'party'
  | 'pot'
  | 'halo'
  | 'booger'
  | 'poop'
  | 'prop'
  | 'crown'
  | 'bow';

export interface GarageSelection {
  kart: KartKind;
  pet: PetKind;
  outfit: OutfitKind;
}

export interface KartGarage {
  dispose(): void;
}

const STORAGE_KEY = 'forgeax.go-karts.garage.v2';
const GARAGE_ID = 'forgeax-kart-garage';
const STYLE_ID = 'forgeax-kart-garage-style';

const KARTS: readonly { id: KartKind; label: string }[] = [
  { id: 'classic', label: '原味圆车' },
  { id: 'banana', label: '香蕉车' },
  { id: 'slipper', label: '拖鞋车' },
  { id: 'box', label: '纸箱车' },
  { id: 'hotdog', label: '热狗车' },
  { id: 'melon', label: '西瓜车' },
  { id: 'duck', label: '橡皮鸭车' },
  { id: 'donut', label: '甜甜圈车' },
  { id: 'rocket', label: '火箭车' },
  { id: 'tub', label: '浴缸车' },
];
const PETS: readonly { id: PetKind; avatar: string; label: string }[] = [
  {
    id: 'dog',
    avatar: new URL('../assets/original-garage/ui/avatar-dog.png', import.meta.url).href,
    label: '斑点狗',
  },
  {
    id: 'duck',
    avatar: new URL('../assets/original-garage/ui/avatar-duck.png', import.meta.url).href,
    label: '小黄鸭',
  },
  {
    id: 'panda',
    avatar: new URL('../assets/original-garage/ui/avatar-panda.png', import.meta.url).href,
    label: '熊猫',
  },
];
const OUTFITS: readonly { id: OutfitKind; label: string }[] = [
  { id: 'none', label: '无装扮' },
  { id: 'straw', label: '草帽' },
  { id: 'shades', label: '墨镜' },
  { id: 'party', label: '派对帽' },
  { id: 'pot', label: '锅' },
  { id: 'halo', label: '天使环' },
  { id: 'booger', label: '鼻屎绿眼镜' },
  { id: 'poop', label: '大便头箍' },
  { id: 'prop', label: '螺旋桨帽' },
  { id: 'crown', label: '皇冠' },
  { id: 'bow', label: '蝴蝶结' },
];

const STYLE = `
#${GARAGE_ID}{position:absolute;inset:0;z-index:12000;overflow:hidden;color:#fff;font-family:'Yuanti SC','STYuanti-SC-Bold','Arial Rounded MT Bold','PingFang SC','Microsoft YaHei',sans-serif;pointer-events:none;background:transparent;user-select:none;letter-spacing:.025em}
#${GARAGE_ID} *{box-sizing:border-box}
#${GARAGE_ID} .kg-door,#${GARAGE_ID} .kg-cab,#${GARAGE_ID} .kg-stage{display:none!important}
#${GARAGE_ID} .kg-top,#${GARAGE_ID} .kg-round,#${GARAGE_ID} .kg-pets,#${GARAGE_ID} .kg-label,#${GARAGE_ID} .kg-tabs,#${GARAGE_ID} .kg-items,#${GARAGE_ID} .kg-go,#${GARAGE_ID} .kg-helpbox,#${GARAGE_ID} .kg-orbit{pointer-events:auto}
#${GARAGE_ID} .kg-orbit{position:absolute;left:20%;right:20%;top:10%;bottom:30%;z-index:2;cursor:grab;touch-action:none}
#${GARAGE_ID} .kg-orbit:active,#${GARAGE_ID} .kg-orbit.dragging{cursor:grabbing}
#${GARAGE_ID} .kg-hint{position:absolute;left:50%;bottom:40%;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:#0007;color:#fff8e9;font:800 12px/1 'Yuanti SC','PingFang SC',sans-serif;letter-spacing:.04em;opacity:.85;pointer-events:none;z-index:6;transition:opacity .35s}
#${GARAGE_ID} .kg-hint.hide{opacity:0}
#${GARAGE_ID} .kg-toast{position:absolute;left:50%;top:18%;transform:translate(-50%,-8px);padding:10px 18px;border-radius:999px;background:#fff8e9;color:#75462d;border:3px solid #ffad32;font:900 15px/1 'Yuanti SC','PingFang SC',sans-serif;box-shadow:0 6px 18px #0006;opacity:0;pointer-events:none;z-index:10}
#${GARAGE_ID} .kg-toast.show{animation:kg-toast .9s ease forwards}
#${GARAGE_ID} .kg-label.flash{animation:kg-flash .45s ease}
#${GARAGE_ID} .kg-card.pop{animation:kg-pop .35s ease}
@keyframes kg-toast{0%{opacity:0;transform:translate(-50%,10px) scale(.92)}18%{opacity:1;transform:translate(-50%,0) scale(1.04)}70%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-6px) scale(.98)}}
@keyframes kg-flash{0%{transform:scale(1)}40%{transform:scale(1.08);background:#ffe36c}100%{transform:scale(1)}}
@keyframes kg-pop{0%{transform:translateY(-8px) scale(1)}45%{transform:translateY(-14px) scale(1.06)}100%{transform:translateY(-8px) scale(1)}}
#${GARAGE_ID} .kg-door{position:absolute;left:32%;right:32%;top:4%;bottom:20%;border:7px solid #111;background:repeating-linear-gradient(#4f535b 0 7%,#292c31 7% 8%);box-shadow:inset 0 0 65px #111,0 0 30px #000}
#${GARAGE_ID} .kg-door:after{content:'91';position:absolute;right:14%;top:16%;font:900 clamp(44px,8vw,92px)/1 sans-serif;color:#aeb2bb55}
#${GARAGE_ID} .kg-cab{position:absolute;bottom:20%;width:18%;height:35%;border-radius:8px 8px 2px 2px;box-shadow:0 18px 30px #0008,inset 0 0 0 4px #ffffff12}
#${GARAGE_ID} .kg-cab:before{content:'';position:absolute;inset:14% 8%;background:repeating-linear-gradient(#ffffff18 0 3px,transparent 3px 20%);border-top:3px solid #ffffff25}
#${GARAGE_ID} .kg-cab.left{left:6%;background:linear-gradient(90deg,#751c1c,#c83d36)}
#${GARAGE_ID} .kg-cab.right{right:6%;background:linear-gradient(90deg,#16487b,#2973bd)}
#${GARAGE_ID} .kg-top{position:absolute;left:50%;top:2%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;z-index:5}
#${GARAGE_ID} .kg-title,#${GARAGE_ID} .kg-chip{border:3px solid #fff;border-radius:999px;background:#fff7e9;color:#ec8133;font-weight:900;box-shadow:0 0 0 2px #eab749,0 5px 15px #0005;text-shadow:0 1px 0 #fff}
#${GARAGE_ID} .kg-title{padding:8px 24px 8px 18px;font-size:clamp(15px,2.4vw,24px);display:flex;align-items:center;gap:8px}
#${GARAGE_ID} .kg-title-mark{width:20px;height:20px;color:#d39a24;display:inline-flex}
#${GARAGE_ID} .kg-chip{padding:7px 14px;background:#62c9f8;color:#fff;box-shadow:0 0 0 2px #fff,0 0 0 4px #319bca}
#${GARAGE_ID} .kg-round{position:absolute;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:#43b8ef;border:3px solid #fff;box-shadow:0 0 0 3px #2389bd,0 5px 12px #0006;cursor:pointer;z-index:8;color:#fff}
#${GARAGE_ID} .kg-round svg{width:25px;height:25px;stroke:currentColor;fill:none;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}
#${GARAGE_ID} .kg-back{left:18px;top:18px}.kg-help{right:18px;top:18px}
#${GARAGE_ID} .kg-pets{position:absolute;left:16px;top:28%;display:grid;gap:10px;z-index:8}
#${GARAGE_ID} .kg-pet{width:58px;height:58px;padding:0;overflow:hidden;border-radius:50%;border:4px solid #fff;background:#fff6dc;box-shadow:0 0 0 3px #e2a62d,0 5px 10px #0007;cursor:pointer;filter:saturate(.72)}
#${GARAGE_ID} .kg-pet img{display:block;width:100%;height:100%;object-fit:cover}
#${GARAGE_ID} .kg-pet.active{transform:scale(1.12);background:#ffe36c;filter:none}
#${GARAGE_ID} .kg-stage{position:absolute;left:50%;top:13%;width:min(52vw,670px);height:min(58vh,480px);transform:translateX(-50%);display:grid;place-items:center;perspective:900px}
#${GARAGE_ID} .kg-platform{position:absolute;width:70%;height:28%;bottom:7%;border-radius:50%;background:linear-gradient(#343b4c,#161924);border:5px solid #ffe178;box-shadow:0 0 0 4px #292c37,0 24px 34px #000b,inset 0 6px 16px #ffffff18}
#${GARAGE_ID} .kg-preview{position:relative;width:66%;height:66%;animation:kg-turn 8s linear infinite;transform-style:preserve-3d}
#${GARAGE_ID} .kg-kart{position:absolute;left:12%;right:12%;bottom:11%;height:38%;border-radius:50% 50% 30% 30%;background:linear-gradient(165deg,#fff 0 32%,var(--kart) 34% 69%,#317eb9 72%);border:5px solid #202733;box-shadow:inset 0 10px 0 #ffffff88,0 18px 20px #0008}
#${GARAGE_ID} .kg-kart:before,#${GARAGE_ID} .kg-kart:after{content:'';position:absolute;width:24%;height:48%;bottom:-18%;border-radius:50%;background:#1e2027;border:4px solid #0d0f13}
#${GARAGE_ID} .kg-kart:before{left:-5%}.kg-kart:after{right:-5%}
#${GARAGE_ID} .kg-seat{position:absolute;left:35%;right:35%;bottom:37%;height:24%;border-radius:45%;background:#c94747;border:4px solid #4f1717}
#${GARAGE_ID} .kg-driver{position:absolute;left:50%;bottom:38%;transform:translateX(-50%);font-size:clamp(72px,11vw,126px);filter:drop-shadow(0 10px 6px #0008);z-index:3}
#${GARAGE_ID} .kg-wear{position:absolute;left:50%;bottom:61%;transform:translateX(-50%);font-size:clamp(44px,6vw,70px);z-index:5;filter:drop-shadow(0 4px 4px #0008)}
#${GARAGE_ID} .kg-label{position:absolute;right:3%;bottom:23%;padding:8px 14px;border-radius:999px;background:#fff8e9;color:#75462d;border:3px solid #ffad32;font-weight:900;z-index:7;box-shadow:0 3px 10px #0004;text-shadow:0 1px #fff}
#${GARAGE_ID} .kg-tabs{position:absolute;left:18px;bottom:16px;display:flex;gap:8px;z-index:9}
#${GARAGE_ID} .kg-tab{padding:9px 17px;border-radius:14px;border:3px solid #fff;background:#b77a43;color:#fff;font:900 14px/1 'Yuanti SC','STYuanti-SC-Bold','Arial Rounded MT Bold','PingFang SC',sans-serif;box-shadow:0 0 0 2px #ffae31,0 5px 12px #0005;cursor:pointer;display:flex;align-items:center;gap:7px;text-shadow:0 2px #8e542a}
#${GARAGE_ID} .kg-tab svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#${GARAGE_ID} .kg-tab.active{background:#ff9f2f;transform:translateY(-3px)}
#${GARAGE_ID} .kg-items{position:absolute;left:15%;right:15%;bottom:16px;height:22%;display:flex;align-items:end;justify-content:center;gap:clamp(8px,2vw,24px);z-index:7;overflow:visible;padding:0;scrollbar-width:none}
#${GARAGE_ID} .kg-items::-webkit-scrollbar{display:none}
#${GARAGE_ID} .kg-card{position:relative;flex:0 0 clamp(72px,10vw,130px);width:clamp(72px,10vw,130px);height:clamp(70px,11vh,105px);display:grid;place-items:center;border:3px solid #ffffff55;border-radius:12px;background:#ffffff0c;color:transparent;font-size:0;cursor:pointer;transition:.18s}
#${GARAGE_ID} .kg-card.active{width:clamp(100px,15vw,170px);height:clamp(90px,15vh,135px);background:#f5c94330;border-color:#fff4a0;box-shadow:0 0 22px #ffd95a88;transform:translateY(-8px)}
#${GARAGE_ID} .kg-card.active:before{content:'';position:absolute;top:-20px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:15px solid #ffb020;filter:drop-shadow(0 2px 1px #6f421f88)}
#${GARAGE_ID} .kg-go{position:absolute;right:3%;top:35%;width:clamp(88px,11vw,120px);height:clamp(88px,11vw,120px);border-radius:26px;border:5px solid #fff;background:linear-gradient(#fffdf6,#fff0d5);color:#f47d12;box-shadow:0 0 0 4px #ffad2f,0 10px 22px #0007;font:900 clamp(22px,4vw,38px)/1 'Marker Felt','Yuanti SC','Arial Rounded MT Bold',sans-serif;cursor:pointer;z-index:9;text-shadow:0 2px #fff}
#${GARAGE_ID} .kg-go small{display:block;margin-top:7px;font-size:12px;color:#8a715c}
#${GARAGE_ID} .kg-helpbox{display:none;position:absolute;z-index:20;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,84vw);padding:28px;border-radius:24px;background:#fff8e9;color:#62452f;border:5px solid #fff;box-shadow:0 0 0 4px #ffad32,0 24px 70px #000c;text-align:center}
#${GARAGE_ID} .kg-helpbox.show{display:block}
#${GARAGE_ID} .kg-helpbox p{margin:12px 0 18px;line-height:1.55;font-weight:700}
@keyframes kg-turn{0%,45%{transform:rotateY(-8deg)}50%,95%{transform:rotateY(8deg)}100%{transform:rotateY(-8deg)}}
`;

const RACE_COUNT_ID = 'forgeax-kart-race-countdown';
const RACE_COUNT_STYLE = `
#${RACE_COUNT_ID}{position:absolute;inset:0;z-index:14000;display:grid;place-items:center;pointer-events:none;font:900 clamp(96px,22vw,240px)/1 'Yuanti SC','Arial Rounded MT Bold',sans-serif;color:#ff3b3b;-webkit-text-stroke:6px #fff;text-shadow:0 8px 0 #c41e1e,0 16px 28px #0007;letter-spacing:.04em}
#${RACE_COUNT_ID}.go{color:#ff2d55;font-size:clamp(72px,16vw,180px)}
`;

export function runStartLineCountdown(host: HTMLElement, onDone: () => void): number {
  if (!document.getElementById(`${RACE_COUNT_ID}-style`)) {
    const style = document.createElement('style');
    style.id = `${RACE_COUNT_ID}-style`;
    style.textContent = RACE_COUNT_STYLE;
    document.head.appendChild(style);
  }
  document.getElementById(RACE_COUNT_ID)?.remove();
  const el = document.createElement('div');
  el.id = RACE_COUNT_ID;
  host.appendChild(el);
  const steps = ['3', '2', '1', '开始!'];
  let i = 0;
  el.textContent = steps[0]!;
  const timer = window.setInterval(() => {
    i += 1;
    if (i >= steps.length) {
      window.clearInterval(timer);
      el.remove();
      onDone();
      return;
    }
    const text = steps[i]!;
    el.textContent = text;
    el.classList.toggle('go', text === '开始!');
  }, 700);
  return timer;
}

function loadSelection(): GarageSelection {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<GarageSelection>;
    return {
      kart: KARTS.some((x) => x.id === value.kart) ? value.kart! : 'classic',
      pet: PETS.some((x) => x.id === value.pet) ? value.pet! : 'dog',
      outfit: OUTFITS.some((x) => x.id === value.outfit) ? value.outfit! : 'none',
    };
  } catch {
    return { kart: 'classic', pet: 'dog', outfit: 'none' };
  }
}

export function installKartGarage(options: {
  host?: HTMLElement;
  onChange?(selection: GarageSelection): void;
  onTabChange?(tab: 'kart' | 'outfit'): void;
  /** Spin / present the showroom model after a meaningful equip change. */
  onEquipImpulse?(selection: GarageSelection): void;
  /** Horizontal drag in the center orbit pad (pixels). */
  onOrbitDrag?(dx: number): void;
  onOrbitEnd?(): void;
  /**
   * Fired when GO is pressed. Host owns wipe → track → intro → countdown → start.
   * Garage UI is removed before this callback.
   */
  onLeaveGarage(selection: GarageSelection): void;
}): KartGarage {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  document.getElementById(GARAGE_ID)?.remove();
  const mount = options.host ?? document.body;
  const root = document.createElement('div');
  root.id = GARAGE_ID;
  if (mount === document.body) root.style.position = 'fixed';
  root.innerHTML = `
    <div class="kg-orbit" aria-label="拖拽旋转查看"></div>
    <div class="kg-top"><div class="kg-title"><span class="kg-title-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 4h8v4c0 3-1.8 5-4 5s-4-2-4-5V4Z"/><path d="M8 6H5v1c0 2 1.4 3.5 3.4 3.8M16 6h3v1c0 2-1.4 3.5-3.4 3.8M12 13v4M8 20h8M10 17h4"/></svg></span>萌宠大奖赛</div><div class="kg-chip">车库</div></div>
    <button class="kg-round kg-back" title="恢复默认" aria-label="恢复默认"><svg viewBox="0 0 24 24"><path d="M5 8v5h5"/><path d="M6.5 12a7 7 0 1 0 2-5"/></svg></button><button class="kg-round kg-help" aria-label="帮助">?</button>
    <div class="kg-pets"></div>
    <div class="kg-toast" aria-live="polite"></div>
    <div class="kg-label"></div>
    <div class="kg-hint">拖拽中间区域旋转查看</div>
    <div class="kg-tabs"><button class="kg-tab active" data-tab="kart"><svg viewBox="0 0 24 24"><path d="M5 14h14l-2-5H7l-2 5Z"/><circle cx="8" cy="16.5" r="2"/><circle cx="16" cy="16.5" r="2"/><path d="M9 9l1-3h4l1 3"/></svg>赛车</button><button class="kg-tab" data-tab="outfit"><svg viewBox="0 0 24 24"><path d="M12 5c0-1.7 2.5-1.7 2.5 0 0 1.5-2.5 1.5-2.5 3"/><path d="m12 8-7 5h14l-7-5Z"/><path d="M6.5 13v6h11v-6"/></svg>装扮</button></div>
    <div class="kg-items"></div>
    <button class="kg-go">GO<small>开始比赛</small></button>
    <div class="kg-helpbox"><h2>车库操作</h2><p>左侧选择车手，底部切换赛车与装扮。中间区域可拖拽旋转查看。确认后点击 GO，经过倒计时进入比赛。</p><button class="kg-tab active">知道了</button></div>`;
  mount.appendChild(root);

  let selection = loadSelection();
  let tab: 'kart' | 'outfit' = 'kart';
  let hintHidden = false;
  const pets = root.querySelector<HTMLElement>('.kg-pets')!;
  const items = root.querySelector<HTMLElement>('.kg-items')!;
  const label = root.querySelector<HTMLElement>('.kg-label')!;
  const toast = root.querySelector<HTMLElement>('.kg-toast')!;
  const hint = root.querySelector<HTMLElement>('.kg-hint')!;
  const orbit = root.querySelector<HTMLElement>('.kg-orbit')!;
  let toastTimer = 0;

  const flashEquip = (kind: 'kart' | 'outfit' | 'pet', name: string): void => {
    label.classList.remove('flash');
    void label.offsetWidth;
    label.classList.add('flash');
    toast.textContent = kind === 'pet' ? `车手：${name}` : `已装备：${name}`;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 950);
    const activeCard = items.querySelector<HTMLElement>('.kg-card.active');
    if (activeCard && kind !== 'pet') {
      activeCard.classList.remove('pop');
      void activeCard.offsetWidth;
      activeCard.classList.add('pop');
    }
  };

  const render = () => {
    const kartDef = KARTS.find((x) => x.id === selection.kart)!;
    const outfit = OUTFITS.find((x) => x.id === selection.outfit)!;
    pets.innerHTML = PETS.map((p) => `<button class="kg-pet ${p.id === selection.pet ? 'active' : ''}" data-pet="${p.id}" title="${p.label}" aria-label="${p.label}"><img src="${p.avatar}" alt=""></button>`).join('');
    label.textContent = `当前装备：${tab === 'kart' ? kartDef.label : outfit.label}`;
    const defs = tab === 'kart' ? KARTS : OUTFITS;
    const selectedId = tab === 'kart' ? selection.kart : selection.outfit;
    const selectedIndex = defs.findIndex((item) => item.id === selectedId);
    const visibleDefs = [-2, -1, 0, 1, 2].map(
      (delta) => defs[(selectedIndex + delta + defs.length) % defs.length]!,
    );
    items.innerHTML = visibleDefs.map((item) => `<button class="kg-card ${item.id === selectedId ? 'active' : ''}" data-choice="${item.id}" title="${item.label}" aria-label="${item.label}"></button>`).join('');
    root.querySelectorAll<HTMLElement>('.kg-tab[data-tab]').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    options.onChange?.({ ...selection });
    options.onTabChange?.(tab);
  };

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.kg-orbit')) return;
    const prev = { ...selection };
    const pet = target.closest<HTMLElement>('[data-pet]')?.dataset.pet as PetKind | undefined;
    const nextTab = target.closest<HTMLElement>('[data-tab]')?.dataset.tab as 'kart' | 'outfit' | undefined;
    const choice = target.closest<HTMLElement>('[data-choice]')?.dataset.choice;
    if (pet) selection.pet = pet;
    if (nextTab) tab = nextTab;
    if (choice && tab === 'kart') selection.kart = choice as KartKind;
    if (choice && tab === 'outfit') selection.outfit = choice as OutfitKind;
    if (target.closest('.kg-back')) selection = { kart: 'classic', pet: 'dog', outfit: 'none' };
    if (target.closest('.kg-help')) root.querySelector('.kg-helpbox')?.classList.add('show');
    if (target.closest('.kg-helpbox .kg-tab')) root.querySelector('.kg-helpbox')?.classList.remove('show');
    if (target.closest('.kg-go')) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
      const chosen = { ...selection };
      root.remove();
      options.onLeaveGarage(chosen);
      return;
    }
    const kartChanged = prev.kart !== selection.kart;
    const petChanged = prev.pet !== selection.pet;
    const outfitChanged = prev.outfit !== selection.outfit;
    render();
    if (kartChanged || petChanged || outfitChanged) {
      if (petChanged) {
        flashEquip('pet', PETS.find((p) => p.id === selection.pet)!.label);
      } else if (outfitChanged) {
        flashEquip('outfit', OUTFITS.find((o) => o.id === selection.outfit)!.label);
      } else {
        flashEquip('kart', KARTS.find((k) => k.id === selection.kart)!.label);
      }
      options.onEquipImpulse?.({ ...selection });
    }
  });

  let dragging = false;
  let lastX = 0;
  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    lastX = event.clientX;
    orbit.classList.add('dragging');
    orbit.setPointerCapture(event.pointerId);
    if (!hintHidden) {
      hintHidden = true;
      hint.classList.add('hide');
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    if (dx !== 0) options.onOrbitDrag?.(dx);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    orbit.classList.remove('dragging');
    try {
      orbit.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    options.onOrbitEnd?.();
  };
  orbit.addEventListener('pointerdown', onPointerDown);
  orbit.addEventListener('pointermove', onPointerMove);
  orbit.addEventListener('pointerup', onPointerUp);
  orbit.addEventListener('pointercancel', onPointerUp);

  render();

  return {
    dispose() {
      window.clearTimeout(toastTimer);
      orbit.removeEventListener('pointerdown', onPointerDown);
      orbit.removeEventListener('pointermove', onPointerMove);
      orbit.removeEventListener('pointerup', onPointerUp);
      orbit.removeEventListener('pointercancel', onPointerUp);
      root.remove();
      document.getElementById(RACE_COUNT_ID)?.remove();
    },
  };
}
