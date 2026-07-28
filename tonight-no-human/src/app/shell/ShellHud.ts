import { GAME_CONFIG, PHASE_LABELS, ROLE_LABELS } from '../../shared/config';
import type { MatchPhase } from '../../shared/types';
import type { RoomState } from '../../session/RoomState';
import type { MatchFSM } from '../../session/MatchFSM';
import type { ChapterDef } from '../../shared/types';

export interface ShellHud {
  setPhase(phase: MatchPhase, detail?: string): void;
  setRoom(room: RoomState, chapters: ChapterDef[]): void;
  setBody(html: string): void;
  setActions(buttons: Array<{ id: string; label: string; primary?: boolean; disabled?: boolean }>): void;
  onAction(handler: (id: string) => void): void;
  dispose(): void;
}

const ROOT_ID = 'tnh-shell-hud';

/** DOM shell for lobby → match phases. Gameplay/render stays ECS; this is the flow UI. */
export function installShellHud(host: HTMLElement): ShellHud {
  document.getElementById(ROOT_ID)?.remove();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '60',
    pointerEvents: 'none',
    font: '500 14px "Segoe UI", "PingFang SC", sans-serif',
    color: '#fff8e7',
    userSelect: 'none',
  } as CSSStyleDeclaration);

  const top = document.createElement('div');
  Object.assign(top.style, {
    position: 'absolute',
    top: '12px',
    left: '14px',
    right: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);

  const title = document.createElement('div');
  Object.assign(title.style, {
    padding: '8px 14px',
    background: 'rgba(40, 12, 18, 0.72)',
    border: '1px solid rgba(255, 180, 90, 0.35)',
    borderRadius: '10px',
    letterSpacing: '0.04em',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  } as CSSStyleDeclaration);
  title.textContent = GAME_CONFIG.title;

  const phaseEl = document.createElement('div');
  Object.assign(phaseEl.style, {
    padding: '8px 14px',
    background: 'rgba(20, 28, 48, 0.72)',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.18)',
  } as CSSStyleDeclaration);

  top.append(title, phaseEl);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(520px, 92%)',
    maxHeight: '72%',
    overflow: 'auto',
    padding: '18px 20px',
    background: 'rgba(18, 10, 16, 0.82)',
    border: '1px solid rgba(255, 170, 100, 0.28)',
    borderRadius: '16px',
    backdropFilter: 'blur(8px)',
    pointerEvents: 'auto',
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
  } as CSSStyleDeclaration);

  const body = document.createElement('div');
  Object.assign(body.style, {
    lineHeight: '1.55',
    fontSize: '14px',
    marginBottom: '14px',
    whiteSpace: 'pre-wrap',
  } as CSSStyleDeclaration);

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    justifyContent: 'flex-end',
  } as CSSStyleDeclaration);

  panel.append(body, actions);
  root.append(top, panel);
  host.appendChild(root);

  let actionHandler: ((id: string) => void) | null = null;

  const setPhase = (phase: MatchPhase, detail?: string) => {
    phaseEl.textContent = detail
      ? `${PHASE_LABELS[phase]} · ${detail}`
      : PHASE_LABELS[phase];
  };

  const setRoom = (room: RoomState, chapters: ChapterDef[]) => {
    const ch = chapters.find((c) => c.id === room.chapterId);
    const lines = [
      `<div style="font-size:18px;font-weight:700;margin-bottom:8px">房间 ${room.roomCode}</div>`,
      `<div style="opacity:.85;margin-bottom:10px">大关：${ch?.title ?? room.chapterId}</div>`,
      '<div style="display:grid;gap:6px;margin-bottom:8px">',
      ...room.players.map((p) => {
        const role = p.role ? ROLE_LABELS[p.role] : '';
        const flags = [
          p.isHost ? '房主' : '',
          p.ready ? '已准备' : '未准备',
          p.isGhost ? '幽灵' : `糖衣×${p.sugarCoat}`,
          role,
        ].filter(Boolean).join(' · ');
        return `<div style="padding:6px 10px;background:rgba(255,255,255,0.06);border-radius:8px">${p.displayName} <span style="opacity:.7">${flags}</span></div>`;
      }),
      '</div>',
    ];
    body.innerHTML = lines.join('');
  };

  const setBody = (html: string) => {
    body.innerHTML = html;
  };

  const setActions = (buttons: Array<{ id: string; label: string; primary?: boolean; disabled?: boolean }>) => {
    actions.replaceChildren();
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.disabled = !!b.disabled;
      Object.assign(btn.style, {
        padding: '8px 14px',
        borderRadius: '10px',
        border: b.primary ? '1px solid rgba(255,190,100,0.55)' : '1px solid rgba(255,255,255,0.2)',
        background: b.primary ? 'rgba(180, 70, 40, 0.9)' : 'rgba(30, 36, 56, 0.9)',
        color: '#fff',
        cursor: b.disabled ? 'default' : 'pointer',
        font: 'inherit',
        opacity: b.disabled ? '0.45' : '1',
        pointerEvents: 'auto',
      } as CSSStyleDeclaration);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        btn.blur();
        if (!b.disabled) actionHandler?.(b.id);
      });
      actions.appendChild(btn);
    }
  };

  return {
    setPhase,
    setRoom,
    setBody,
    setActions,
    onAction: (handler) => { actionHandler = handler; },
    dispose: () => root.remove(),
  };
}

export function phaseHint(fsm: MatchFSM): string {
  return PHASE_LABELS[fsm.phase];
}
