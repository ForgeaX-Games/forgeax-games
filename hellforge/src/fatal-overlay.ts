// Terminal boot failure panel — uiRoot-mounted, covers Title / loading / HUD.
import { FONT_UI } from './ui-theme';
// Used when camp scene or hero assets are missing; den launcher has no shell
// so this helper must work with mount === body as well.

const FATAL_ID = 'hellforge-fatal-boot';

export function installFatalOverlay(
  mount: HTMLElement,
  title: string,
  detail: string,
): () => void {
  document.getElementById(FATAL_ID)?.remove();
  const scoped = mount !== document.body;
  const root = document.createElement('div');
  root.id = FATAL_ID;
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:260;` +
    'display:flex;align-items:center;justify-content:center;padding:24px;' +
    'box-sizing:border-box;background:rgba(8,5,5,.96);pointer-events:auto;' +
    `font-family:${FONT_UI};color:#e8d8c0;`;

  const panel = document.createElement('div');
  panel.style.cssText = 'width:min(560px,92%);padding:28px;border:1px solid #7b372b;' +
    'background:#170d0b;box-shadow:0 18px 70px #000;text-align:center;';
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'margin:0 0 14px;color:#ff8b70;';
  const body = document.createElement('pre');
  body.textContent = detail;
  body.style.cssText = 'white-space:pre-wrap;word-break:break-word;color:#c9b6aa;text-align:left;';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = '重新加载';
  reload.style.cssText = 'margin-top:18px;padding:10px 24px;cursor:pointer;pointer-events:auto;';
  reload.addEventListener('click', () => window.location.reload());
  panel.append(heading, body, reload);
  root.appendChild(panel);
  mount.appendChild(root);
  return () => root.remove();
}
