/** Minimal HUD for the CharacterController terrain demo. */

export interface DemoHud {
  setZone(text: string): void;
  setStatus(text: string): void;
  dispose(): void;
}

const HUD_ID = 'forgeax-cc-terrain-hud';

export function installDemoHud(host?: HTMLElement): DemoHud {
  document.getElementById(HUD_ID)?.remove();
  const mount = host ?? document.body;
  const rootAbsolute = mount !== document.body;

  const root = document.createElement('div');
  root.id = HUD_ID;
  Object.assign(root.style, {
    position: rootAbsolute ? 'absolute' : 'fixed',
    inset: '0',
    zIndex: '50',
    pointerEvents: 'none',
    font: "600 13px ui-sans-serif, system-ui, sans-serif",
    color: '#fff',
    userSelect: 'none',
    overflow: 'hidden',
  } as CSSStyleDeclaration);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    top: '12px',
    left: '14px',
    maxWidth: 'min(420px, calc(100% - 28px))',
    padding: '10px 12px',
    background: 'rgba(0,0,0,0.55)',
    borderRadius: '10px',
    lineHeight: '1.45',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
  } as CSSStyleDeclaration);

  const title = document.createElement('div');
  title.textContent = 'CharacterController 地形演示';
  Object.assign(title.style, { fontSize: '15px', marginBottom: '6px' } as CSSStyleDeclaration);

  const zone = document.createElement('div');
  zone.id = `${HUD_ID}-zone`;
  Object.assign(zone.style, { color: '#a5f3fc', marginBottom: '4px' } as CSSStyleDeclaration);

  const status = document.createElement('div');
  status.id = `${HUD_ID}-status`;
  Object.assign(status.style, { color: '#fde68a', fontWeight: '500' } as CSSStyleDeclaration);

  const hint = document.createElement('div');
  hint.textContent = 'W/S 沿赛道前后 · A/D 左右平移 · Space 跳跃';
  Object.assign(hint.style, {
    marginTop: '8px',
    fontSize: '12px',
    fontWeight: '400',
    color: 'rgba(255,255,255,0.75)',
  } as CSSStyleDeclaration);

  panel.append(title, zone, status, hint);
  root.append(panel);
  mount.append(root);

  return {
    setZone(text: string) { zone.textContent = text; },
    setStatus(text: string) { status.textContent = text; },
    dispose() { root.remove(); },
  };
}
