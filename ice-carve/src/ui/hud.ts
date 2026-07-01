const HUD_ID = 'ice-carve-hud';

export interface IceHud {
  setHint(text: string): void;
  setStatus(text: string): void;
  setCuts(n: number): void;
  /** Register handler for grid-line overlay toggle (button starts off). */
  bindGridToggle(handler: (visible: boolean) => void): void;
  dispose(): void;
}

export function installIceHud(): IceHud {
  document.getElementById(HUD_ID)?.remove();

  const root = document.createElement('div');
  root.id = HUD_ID;
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    pointerEvents: 'none',
    font: '600 14px ui-sans-serif, system-ui, sans-serif',
    color: '#e8f4ff',
    userSelect: 'none',
  } as CSSStyleDeclaration);

  const title = document.createElement('div');
  Object.assign(title.style, {
    position: 'absolute',
    top: '12px',
    left: '14px',
    padding: '6px 12px',
    background: 'rgba(8,24,48,0.72)',
    borderRadius: '8px',
    border: '1px solid rgba(140,200,255,0.35)',
  } as CSSStyleDeclaration);
  title.textContent = '冰雕工坊 · Stage A';

  const cuts = document.createElement('div');
  Object.assign(cuts.style, {
    position: 'absolute',
    top: '12px',
    right: '14px',
    padding: '6px 12px',
    background: 'rgba(8,24,48,0.72)',
    borderRadius: '8px',
  } as CSSStyleDeclaration);
  cuts.textContent = '刀数: 0';

  const status = document.createElement('div');
  Object.assign(status.style, {
    position: 'absolute',
    top: '52px',
    left: '14px',
    padding: '4px 10px',
    background: 'rgba(0,0,0,0.45)',
    borderRadius: '6px',
    fontSize: '12px',
  } as CSSStyleDeclaration);
  status.textContent = '';

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'absolute',
    bottom: '14px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 14px',
    background: 'rgba(0,0,0,0.5)',
    borderRadius: '8px',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);
  hint.textContent = '左键拖冰 · 右键转冰坯 · WASD移相机 · 方向键调时间流速 · 滚轮推拉 · 空格切割';

  const gridToggle = document.createElement('button');
  Object.assign(gridToggle.style, {
    position: 'absolute',
    top: '52px',
    right: '14px',
    padding: '6px 12px',
    background: 'rgba(8,24,48,0.85)',
    borderRadius: '8px',
    border: '1px solid rgba(140,200,255,0.45)',
    color: '#e8f4ff',
    font: '600 12px ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
    pointerEvents: 'auto',
  } as CSSStyleDeclaration);
  gridToggle.type = 'button';
  gridToggle.textContent = '网格: 关';
  gridToggle.title = '切换体素网格线（关=形状描边，开=细网格）';

  let gridToggleHandler: ((visible: boolean) => void) | null = null;
  let gridVisible = false;
  gridToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    gridVisible = !gridVisible;
    gridToggle.textContent = gridVisible ? '网格: 开' : '网格: 关';
    gridToggle.style.borderColor = gridVisible
      ? 'rgba(255,160,120,0.75)'
      : 'rgba(140,200,255,0.45)';
    gridToggleHandler?.(gridVisible);
  });

  root.append(title, cuts, status, hint, gridToggle);
  document.body.append(root);

  return {
    setHint(text: string) { hint.textContent = text; },
    setStatus(text: string) { status.textContent = text; },
    setCuts(n: number) { cuts.textContent = `刀数: ${n}`; },
    bindGridToggle(handler: (visible: boolean) => void) { gridToggleHandler = handler; },
    dispose() { root.remove(); },
  };
}
