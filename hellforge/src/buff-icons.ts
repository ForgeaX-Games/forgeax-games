// Buff icon generator — direct port of aidiablo's ui/BuffIcons.ts. Procedural
// 256×256 D2-style circular icons via Canvas2D (dark disc + colored glow +
// symbol + metallic ring). Zero engine deps, zero hellforge-specific deps —
// this is a pure rendering utility consumed by BuffDisplay (buff-display.ts).
//
// aidiablo's SKILL_BUFF_MAP keyed D2 numeric skill ids (208/502/604/...) to
// icon+duration; hellforge skills are a flat string-id list (magma/frost/arc/
// blink, see skills.ts) with no aura/warcry/curse kit behind them, so that
// map has no hellforge equivalent and is dropped — BuffDisplay callers add
// buffs directly via addBuff(uid, emoji, name, durationMs, color, effects).

export interface BuffIconDef {
  id: string;
  name: string;
  color: string;       // primary glow
  ringColor: string;   // metallic ring accent
  symbol: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void;
}

function drawSword(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.7;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.lineTo(s * 0.08, -s * 0.1);
  ctx.lineTo(0, s * 0.05);
  ctx.lineTo(-s * 0.08, -s * 0.1);
  ctx.closePath();
  ctx.fillStyle = '#ddeeff';
  ctx.fill();
  ctx.strokeStyle = '#aaccee';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#c8a951';
  ctx.fillRect(-s * 0.28, -s * 0.12, s * 0.56, s * 0.08);
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(-s * 0.04, -s * 0.05, s * 0.08, s * 0.45);
  ctx.beginPath();
  ctx.arc(0, s * 0.42, s * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = '#c8a951';
  ctx.fill();
  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.7;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.75);
  ctx.quadraticCurveTo(s * 0.75, -s * 0.65, s * 0.65, -s * 0.1);
  ctx.quadraticCurveTo(s * 0.55, s * 0.5, 0, s * 0.85);
  ctx.quadraticCurveTo(-s * 0.55, s * 0.5, -s * 0.65, -s * 0.1);
  ctx.quadraticCurveTo(-s * 0.75, -s * 0.65, 0, -s * 0.75);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, -s, 0, s);
  grad.addColorStop(0, '#6688bb');
  grad.addColorStop(0.5, '#4466aa');
  grad.addColorStop(1, '#334488');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#99bbdd';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#aaccee';
  ctx.fillRect(-s * 0.04, -s * 0.4, s * 0.08, s * 0.7);
  ctx.fillRect(-s * 0.3, -s * 0.1, s * 0.6, s * 0.08);
  ctx.restore();
}

function drawFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.7;
  ctx.save();
  ctx.translate(cx, cy + s * 0.15);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.quadraticCurveTo(s * 0.15, -s * 0.6, s * 0.35, -s * 0.3);
  ctx.quadraticCurveTo(s * 0.5, 0, s * 0.35, s * 0.4);
  ctx.quadraticCurveTo(s * 0.15, s * 0.7, 0, s * 0.65);
  ctx.quadraticCurveTo(-s * 0.15, s * 0.7, -s * 0.35, s * 0.4);
  ctx.quadraticCurveTo(-s * 0.5, 0, -s * 0.35, -s * 0.3);
  ctx.quadraticCurveTo(-s * 0.15, -s * 0.6, 0, -s * 0.9);
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
  grad.addColorStop(0, '#ffee88');
  grad.addColorStop(0.4, '#ff8800');
  grad.addColorStop(1, '#cc3300');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.5);
  ctx.quadraticCurveTo(s * 0.12, -s * 0.2, s * 0.15, s * 0.1);
  ctx.quadraticCurveTo(0, s * 0.35, -s * 0.15, s * 0.1);
  ctx.quadraticCurveTo(-s * 0.12, -s * 0.2, 0, -s * 0.5);
  ctx.closePath();
  ctx.fillStyle = '#ffee99';
  ctx.fill();
  ctx.restore();
}

function drawSnowflake(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#bbddff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.lineTo(s * 0.2, -s * 0.75);
    ctx.moveTo(0, -s * 0.55);
    ctx.lineTo(-s * 0.2, -s * 0.75);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#ddeeff';
  ctx.fill();
  ctx.restore();
}

function drawLightning(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.7;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(s * 0.1, -s * 0.85);
  ctx.lineTo(s * 0.3, -s * 0.85);
  ctx.lineTo(s * 0.05, -s * 0.15);
  ctx.lineTo(s * 0.25, -s * 0.15);
  ctx.lineTo(-s * 0.15, s * 0.85);
  ctx.lineTo(0, s * 0.1);
  ctx.lineTo(-s * 0.2, s * 0.1);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, -s, 0, s);
  grad.addColorStop(0, '#ffff88');
  grad.addColorStop(1, '#ffcc00');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#ffee66';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.6;
  ctx.save();
  ctx.translate(cx, cy + s * 0.05);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.6);
  ctx.bezierCurveTo(-s * 0.05, s * 0.5, -s * 0.7, s * 0.1, -s * 0.7, -s * 0.2);
  ctx.bezierCurveTo(-s * 0.7, -s * 0.6, -s * 0.35, -s * 0.7, 0, -s * 0.35);
  ctx.bezierCurveTo(s * 0.35, -s * 0.7, s * 0.7, -s * 0.6, s * 0.7, -s * 0.2);
  ctx.bezierCurveTo(s * 0.7, s * 0.1, s * 0.05, s * 0.5, 0, s * 0.6);
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, -s * 0.1, 0, 0, 0, s * 0.7);
  grad.addColorStop(0, '#ff6666');
  grad.addColorStop(1, '#cc2222');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawWind(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#88ffaa';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  const lines = [
    { y: -s * 0.45, len: s * 0.9, curl: -s * 0.15 },
    { y: -s * 0.05, len: s * 1.1, curl: s * 0.2 },
    { y: s * 0.35, len: s * 0.7, curl: -s * 0.1 },
  ];
  for (const l of lines) {
    ctx.beginPath();
    ctx.moveTo(-l.len * 0.5, l.y);
    ctx.quadraticCurveTo(0, l.y + l.curl, l.len * 0.5, l.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrossedSwords(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  for (const angle of [-0.4, 0.4]) {
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = '#ddeeff';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(s * 0.06, -s * 0.1);
    ctx.lineTo(-s * 0.06, -s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c8a951';
    ctx.fillRect(-s * 0.2, -s * 0.12, s * 0.4, s * 0.06);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-s * 0.03, -s * 0.05, s * 0.06, s * 0.35);
    ctx.restore();
  }
  ctx.restore();
}

function drawCrystal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.8);
  ctx.lineTo(s * 0.35, -s * 0.2);
  ctx.lineTo(s * 0.25, s * 0.7);
  ctx.lineTo(-s * 0.25, s * 0.7);
  ctx.lineTo(-s * 0.35, -s * 0.2);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-s * 0.3, -s, s * 0.3, s);
  grad.addColorStop(0, '#88bbff');
  grad.addColorStop(0.5, '#4488ff');
  grad.addColorStop(1, '#2244aa');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#aaddff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, -s * 0.55);
  ctx.lineTo(s * 0.05, -s * 0.2);
  ctx.lineTo(-s * 0.15, -s * 0.15);
  ctx.closePath();
  ctx.fillStyle = 'rgba(200,230,255,0.3)';
  ctx.fill();
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.6;
  const outer = s * 0.85, inner = s * 0.35;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const ao = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const ai = ao + Math.PI / 5;
    ctx.lineTo(Math.cos(ao) * outer, Math.sin(ao) * outer);
    ctx.lineTo(Math.cos(ai) * inner, Math.sin(ai) * inner);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
  grad.addColorStop(0, '#ffffaa');
  grad.addColorStop(1, '#ddaa22');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#ffee88';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawSkull(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.15, s * 0.55, s * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e8e0d0';
  ctx.fill();
  ctx.strokeStyle = '#bbb0a0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, s * 0.2);
  ctx.quadraticCurveTo(-s * 0.3, s * 0.65, 0, s * 0.6);
  ctx.quadraticCurveTo(s * 0.3, s * 0.65, s * 0.35, s * 0.2);
  ctx.fillStyle = '#ddd8c8';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(-s * 0.2, -s * 0.15, s * 0.12, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.2, -s * 0.15, s * 0.12, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, s * 0.05);
  ctx.lineTo(-s * 0.06, s * 0.2);
  ctx.lineTo(s * 0.06, s * 0.2);
  ctx.closePath();
  ctx.fillStyle = '#444';
  ctx.fill();
  ctx.restore();
}

function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.65, 0, Math.PI * 2);
  ctx.fillStyle = '#9977cc';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.25, -s * 0.1, s * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0a12';
  ctx.fill();
  ctx.restore();
}

function drawCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
  grad.addColorStop(0, '#ffffcc');
  grad.addColorStop(1, '#ddaa44');
  ctx.fillStyle = grad;
  ctx.fillRect(-s * 0.12, -s * 0.75, s * 0.24, s * 1.5);
  ctx.fillRect(-s * 0.5, -s * 0.35, s * 1.0, s * 0.24);
  ctx.strokeStyle = '#ffee88';
  ctx.lineWidth = 1;
  ctx.strokeRect(-s * 0.12, -s * 0.75, s * 0.24, s * 1.5);
  ctx.strokeRect(-s * 0.5, -s * 0.35, s * 1.0, s * 0.24);
  ctx.restore();
}

function drawBook(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.55);
  ctx.quadraticCurveTo(-s * 0.6, -s * 0.5, -s * 0.55, s * 0.55);
  ctx.lineTo(0, s * 0.45);
  ctx.closePath();
  ctx.fillStyle = '#ddd8cc';
  ctx.fill();
  ctx.strokeStyle = '#aa9977';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.55);
  ctx.quadraticCurveTo(s * 0.6, -s * 0.5, s * 0.55, s * 0.55);
  ctx.lineTo(0, s * 0.45);
  ctx.closePath();
  ctx.fillStyle = '#eee8dd';
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.6);
  ctx.lineTo(0, s * 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = -s * 0.25 + i * s * 0.18;
    ctx.beginPath();
    ctx.moveTo(s * 0.1, y);
    ctx.lineTo(s * 0.4, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOrb(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  const grad = ctx.createRadialGradient(-s * 0.15, -s * 0.15, 0, 0, 0, s * 0.65);
  grad.addColorStop(0, '#bb88ff');
  grad.addColorStop(0.6, '#7744cc');
  grad.addColorStop(1, '#331166');
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#aa88ee';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-s * 0.15, -s * 0.2, s * 0.12, s * 0.08, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(180,140,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.65, s * 0.25, 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawClover(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.45;
  ctx.save();
  ctx.translate(cx, cy - s * 0.1);
  ctx.fillStyle = '#44cc66';
  const offsets: Array<[number, number]> = [
    [0, -s * 0.35], [s * 0.35, 0], [0, s * 0.35], [-s * 0.35, 0],
  ];
  for (const [ox, oy] of offsets) {
    ctx.beginPath();
    ctx.arc(ox, oy, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#228844';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.4);
  ctx.quadraticCurveTo(s * 0.1, s * 0.7, 0, s * 0.9);
  ctx.stroke();
  ctx.restore();
}

function drawDrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.7);
  ctx.bezierCurveTo(s * 0.05, -s * 0.5, s * 0.45, -s * 0.05, s * 0.45, s * 0.2);
  ctx.bezierCurveTo(s * 0.45, s * 0.6, s * 0.2, s * 0.75, 0, s * 0.75);
  ctx.bezierCurveTo(-s * 0.2, s * 0.75, -s * 0.45, s * 0.6, -s * 0.45, s * 0.2);
  ctx.bezierCurveTo(-s * 0.45, -s * 0.05, -s * 0.05, -s * 0.5, 0, -s * 0.7);
  ctx.closePath();
  const grad = ctx.createRadialGradient(-s * 0.1, s * 0.1, 0, 0, s * 0.1, s * 0.5);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#220000');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawRunner(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#88ff88';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(s * 0.05, -s * 0.55, s * 0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.05, -s * 0.42);
  ctx.lineTo(-s * 0.05, s * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.05, s * 0.05);
  ctx.lineTo(s * 0.25, s * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.05, s * 0.05);
  ctx.lineTo(-s * 0.3, s * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.0, -s * 0.25);
  ctx.lineTo(s * 0.3, -s * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.0, -s * 0.25);
  ctx.lineTo(-s * 0.25, -s * 0.35);
  ctx.stroke();
  ctx.restore();
}

function drawCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = r * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.6, 0, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(-s * 0.1, -s * 0.15, 0, 0, 0, s * 0.6);
  grad.addColorStop(0, '#ffdd66');
  grad.addColorStop(1, '#cc9900');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#ddaa00';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = `bold ${s * 0.7}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#886600';
  ctx.fillText('$', 0, s * 0.02);
  ctx.restore();
}

function drawShieldFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, flameColor: string) {
  drawShield(ctx, cx, cy, r);
  ctx.save();
  ctx.translate(cx, cy - r * 0.1);
  ctx.globalAlpha = 0.8;
  const s = r * 0.3;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.quadraticCurveTo(s * 0.3, -s * 0.3, s * 0.2, s * 0.4);
  ctx.quadraticCurveTo(0, s * 0.6, -s * 0.2, s * 0.4);
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.3, 0, -s * 0.9);
  ctx.closePath();
  ctx.fillStyle = flameColor;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

export const BUFF_ICON_DEFS: BuffIconDef[] = [
  // === Offensive ===
  { id: 'damage_up', name: '伤害提升', color: '#cc4400', ringColor: '#ff6600', symbol: drawSword },
  { id: 'attack_speed', name: '攻速提升', color: '#ccaa00', ringColor: '#ffcc00', symbol: drawCrossedSwords },
  { id: 'enchant_fire', name: '火焰附魔', color: '#cc3300', ringColor: '#ff4400', symbol: drawFlame },
  { id: 'poison', name: '毒素增伤', color: '#228800', ringColor: '#44cc00',
    symbol: (ctx, cx, cy, r) => { drawSkull(ctx, cx, cy, r); ctx.save(); ctx.translate(cx, cy); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = '#44dd0044'; ctx.fill(); ctx.globalAlpha = 1; ctx.restore(); } },
  { id: 'life_steal', name: '偷取生命', color: '#880022', ringColor: '#cc0033',
    symbol: (ctx, cx, cy, r) => drawDrop(ctx, cx, cy, r, '#cc2244') },

  // === Defensive ===
  { id: 'defense_up', name: '防御提升', color: '#334488', ringColor: '#5566aa', symbol: drawShield },
  { id: 'ice_armor', name: '冰甲', color: '#2266aa', ringColor: '#44aaff', symbol: drawSnowflake },
  { id: 'bone_armor', name: '白骨装甲', color: '#555544', ringColor: '#aabb99', symbol: drawSkull },
  { id: 'holy_shield', name: '神圣护盾', color: '#aa8800', ringColor: '#ffcc44', symbol: drawCross },
  { id: 'invulnerable', name: '无敌', color: '#cc9900', ringColor: '#ffdd44', symbol: drawStar },
  { id: 'mana_shield', name: '能量护盾', color: '#4422aa', ringColor: '#7744ff', symbol: drawOrb },
  { id: 'shadow', name: '暗影隐匿', color: '#332244', ringColor: '#6644aa', symbol: drawMoon },

  // === Utility ===
  { id: 'speed_up', name: '移速提升', color: '#228833', ringColor: '#44cc66', symbol: drawWind },
  { id: 'max_hp', name: '生命上限', color: '#aa2222', ringColor: '#ff4444', symbol: drawHeart },
  { id: 'max_mp', name: '法力上限', color: '#2244aa', ringColor: '#4466ff', symbol: drawCrystal },
  { id: 'all_skills', name: '技能提升', color: '#6633aa', ringColor: '#9955ff', symbol: drawBook },
  { id: 'thunder_storm', name: '雷暴', color: '#887700', ringColor: '#ccaa00', symbol: drawLightning },

  // === Shrine ===
  { id: 'hp_regen', name: '生命恢复', color: '#22aa44', ringColor: '#44ff66', symbol: drawHeart },
  { id: 'mp_regen', name: '法力恢复', color: '#2244cc', ringColor: '#4488ff', symbol: drawCrystal },
  { id: 'xp_bonus', name: '经验加成', color: '#aaaa00', ringColor: '#ffff44', symbol: drawStar },
  { id: 'fortune', name: '幸运加成', color: '#22aa44', ringColor: '#44ff66', symbol: drawClover },
  { id: 'gold_bonus', name: '金币加成', color: '#aa8800', ringColor: '#ffcc00', symbol: drawCoin },
  { id: 'stamina', name: '无限体力', color: '#44aa22', ringColor: '#88ff44', symbol: drawRunner },

  // === Resistance ===
  { id: 'resist_fire', name: '火焰抗性', color: '#cc4400', ringColor: '#ff6600',
    symbol: (ctx, cx, cy, r) => drawShieldFlame(ctx, cx, cy, r, '#ff6600') },
  { id: 'resist_cold', name: '冰霜抗性', color: '#2288cc', ringColor: '#44bbff',
    symbol: (ctx, cx, cy, r) => drawShieldFlame(ctx, cx, cy, r, '#44bbff') },
  { id: 'resist_lightning', name: '闪电抗性', color: '#aaaa00', ringColor: '#ffee44',
    symbol: (ctx, cx, cy, r) => drawShieldFlame(ctx, cx, cy, r, '#ffee44') },
];

const iconCache = new Map<string, HTMLCanvasElement>();

export function renderBuffIcon(def: BuffIconDef, size = 256): HTMLCanvasElement {
  const key = `${def.id}_${size}`;
  if (iconCache.has(key)) return iconCache.get(key)!;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2, rad = size / 2;

  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  bgGrad.addColorStop(0, '#1a1825');
  bgGrad.addColorStop(0.7, '#0e0c18');
  bgGrad.addColorStop(1, '#060510');
  ctx.beginPath();
  ctx.arc(cx, cy, rad - 2, 0, Math.PI * 2);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.65);
  glowGrad.addColorStop(0, def.color + '55');
  glowGrad.addColorStop(0.5, def.color + '22');
  glowGrad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, rad * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  def.symbol(ctx, cx, cy, rad * 0.45);

  const ringW = rad * 0.08;
  const ringR = rad - ringW / 2 - 2;
  const ringGrad = ctx.createLinearGradient(0, 0, size, size);
  ringGrad.addColorStop(0, '#c8a951');
  ringGrad.addColorStop(0.3, def.ringColor);
  ringGrad.addColorStop(0.5, '#f0d78a');
  ringGrad.addColorStop(0.7, def.ringColor);
  ringGrad.addColorStop(1, '#8a7030');
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = ringW;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, ringR - ringW * 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, ringR + ringW * 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  iconCache.set(key, canvas);
  return canvas;
}

export function getBuffIconDef(iconId: string): BuffIconDef | undefined {
  return BUFF_ICON_DEFS.find((d) => d.id === iconId);
}

export function getAllRenderedIcons(size = 256): Map<string, HTMLCanvasElement> {
  const map = new Map<string, HTMLCanvasElement>();
  for (const def of BUFF_ICON_DEFS) {
    map.set(def.id, renderBuffIcon(def, size));
  }
  return map;
}

export const DAMAGE_TYPE_COLORS: Record<string, string> = {
  physical:  '#cc6633',
  fire:      '#ff4400',
  ice:       '#44aaff',
  lightning: '#ffcc00',
};

const emojiIconCache = new Map<string, HTMLCanvasElement>();

/** Render any emoji into a Diablo-style circular frame at the requested size. */
export function renderEmojiIcon(emoji: string, glowColor: string, size = 256): HTMLCanvasElement {
  const key = `${emoji}_${glowColor}_${size}`;
  if (emojiIconCache.has(key)) return emojiIconCache.get(key)!;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2, rad = size / 2;

  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  bgGrad.addColorStop(0, '#1a1825');
  bgGrad.addColorStop(0.7, '#0e0c18');
  bgGrad.addColorStop(1, '#060510');
  ctx.beginPath();
  ctx.arc(cx, cy, rad - 2, 0, Math.PI * 2);
  ctx.fillStyle = bgGrad;
  ctx.fill();

  const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.65);
  glowGrad.addColorStop(0, glowColor + '66');
  glowGrad.addColorStop(0.5, glowColor + '22');
  glowGrad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, rad * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  const fontSize = size * 0.48;
  ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(emoji, cx, cy + size * 0.02);

  const ringW = rad * 0.08;
  const ringR = rad - ringW / 2 - 2;
  const ringGrad = ctx.createLinearGradient(0, 0, size, size);
  ringGrad.addColorStop(0, '#c8a951');
  ringGrad.addColorStop(0.3, glowColor);
  ringGrad.addColorStop(0.5, '#f0d78a');
  ringGrad.addColorStop(0.7, glowColor);
  ringGrad.addColorStop(1, '#8a7030');
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = ringW;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, ringR - ringW * 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, ringR + ringW * 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  emojiIconCache.set(key, canvas);
  return canvas;
}
