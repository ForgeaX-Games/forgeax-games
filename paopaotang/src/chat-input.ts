//  localized comment
// npc_wire generator can own that file; this UI helper is game code.

export interface ChatInputHandle {
  open(placeholder: string, onSubmit: (text: string) => void, onCancel: () => void): void;
  close(): void;
  isOpen(): boolean;
}

export function installChatInput(host?: HTMLElement): ChatInputHandle {
  const mount = host ?? document.body;
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:absolute;left:50%;bottom:86px;transform:translateX(-50%);z-index:20;' +
    'display:none;pointer-events:auto;';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 60;
  input.style.cssText =
    'width:340px;padding:10px 16px;border-radius:18px;border:2px solid #ff9ec4;' +
    'background:rgba(30,16,40,0.8);color:#fff;font-size:14px;outline:none;' +
    'font-family:ui-rounded,"Segoe UI",system-ui,sans-serif;backdrop-filter:blur(4px);';
  wrap.appendChild(input);
  mount.appendChild(wrap);

  let submit: ((text: string) => void) | null = null;
  let cancel: (() => void) | null = null;
  let open = false;
  const close = (): void => {
    open = false;
    wrap.style.display = 'none';
    input.value = '';
    input.blur();
    submit = null;
    cancel = null;
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      const text = input.value.trim();
      const callback = submit;
      if (text && callback) { close(); callback(text); }
    } else if (event.key === 'Escape') {
      const callback = cancel;
      close();
      callback?.();
    }
  });
  input.addEventListener('keyup', (event) => event.stopPropagation());
  input.addEventListener('keypress', (event) => event.stopPropagation());

  return {
    open(placeholder, onSubmit, onCancel) {
      submit = onSubmit;
      cancel = onCancel;
      input.placeholder = placeholder;
      open = true;
      wrap.style.display = 'block';
      setTimeout(() => input.focus(), 0);
    },
    close,
    isOpen: () => open,
  };
}
