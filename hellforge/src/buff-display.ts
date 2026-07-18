// Buff bar — direct port of aidiablo's ui/BuffDisplay.ts. Diablo-style
// circular countdown icons above the skill bar, with a hover tooltip
// listing active effects.
//
// Two things dropped vs the source:
// - The `t()` i18n lookups: hellforge has no i18n system (every string is
//   hardcoded Chinese), so EFFECT_LABELS below inlines the same Chinese
//   text aidiablo's zh.ts carried, and the tooltip title lookup (which
//   tried a translation key and fell back to buff.name) collapses to just
//   using buff.name directly — there is no translation layer to try first.
// - `addBuffFromSkill` + the dev-only icon gallery/PNG-download helpers:
//   addBuffFromSkill only existed to look up aidiablo's numeric-skill-id
//   SKILL_BUFF_MAP, which has no hellforge equivalent (see buff-icons.ts)
//   and was dropped there — callers here add buffs via addBuff(...)
//   directly with explicit params instead.
//
// hellforge currently has no buff-granting gameplay (only instant potions
// + a monster-side slow debuff, see monsters.ts) — this class is ready
// infrastructure for whenever equipment/skill auras land, same "orphan
// until a caller exists" status the SPEC accepts for CubeUI.

import { renderEmojiIcon } from './buff-icons';
import { FONT_UI } from './ui-theme';

const EFFECT_LABELS: Record<string, string> = {
  damagePct: '伤害加成',
  attackSpeedPct: '攻速加成',
  defensePct: '防御加成',
  speedPct: '移速加成',
  invulnerable: '无敌',
  maxHpPct: '最大生命',
  maxMpPct: '最大法力',
  allSkillLevel: '技能提升',
  manaShieldPct: '能量护盾',
};

function formatEffectValue(key: string, val: number | boolean): string {
  if (typeof val === 'boolean') return val ? '✓' : '✗';
  if (key === 'allSkillLevel') return `+${val}`;
  return `+${Math.round(val * 100)}%`;
}

export interface BuffEffectsMap {
  damagePct?: number;
  attackSpeedPct?: number;
  defensePct?: number;
  speedPct?: number;
  invulnerable?: boolean;
  maxHpPct?: number;
  maxMpPct?: number;
  allSkillLevel?: number;
  manaShieldPct?: number;
}

export interface ViewerBuff {
  uid: string;
  name: string;
  totalMs: number;
  remainMs: number;
  iconCanvas: HTMLCanvasElement;
  effects?: BuffEffectsMap;
  el?: HTMLElement;
  fadePhase: number;
}

const ICON_SIZE = 72;
const ICON_GAP = 8;
const FADE_OUT_MS = 400;
const BAR_BOTTOM = '54px';

export class BuffDisplay {
  private container: HTMLElement;
  private buffs: ViewerBuff[] = [];
  private iconCache = new Map<string, HTMLCanvasElement>();

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'buff-display';
    Object.assign(this.container.style, {
      position: 'absolute',
      bottom: BAR_BOTTOM,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: `${ICON_GAP}px`,
      alignItems: 'flex-end',
      zIndex: '10',
      pointerEvents: 'none',
    });
    parent.appendChild(this.container);
  }

  /** Add or refresh a buff. */
  addBuff(
    uid: string,
    emoji: string,
    name: string,
    durationMs: number,
    color: string,
    effects?: BuffEffectsMap,
  ): void {
    const existing = this.buffs.find((b) => b.uid === uid);
    if (existing) {
      existing.remainMs = durationMs;
      existing.totalMs = durationMs;
      existing.fadePhase = 0;
      existing.effects = effects;
      this.updateTooltip(existing);
      this.renderBuff(existing);
      return;
    }

    const cacheKey = `${emoji}_${color}`;
    let iconCanvas = this.iconCache.get(cacheKey);
    if (!iconCanvas) {
      iconCanvas = renderEmojiIcon(emoji, color, 256);
      this.iconCache.set(cacheKey, iconCanvas);
    }

    const buff: ViewerBuff = {
      uid, name,
      totalMs: durationMs,
      remainMs: durationMs,
      iconCanvas,
      effects,
      fadePhase: 0,
    };

    this.buffs.push(buff);
    this.createBuffElement(buff);
  }

  update(dtMs: number): void {
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      const b = this.buffs[i]!;
      b.remainMs -= dtMs;
      if (b.remainMs <= 0) {
        b.fadePhase += dtMs;
        if (b.fadePhase >= FADE_OUT_MS) {
          if (b.el) b.el.remove();
          this.buffs.splice(i, 1);
          continue;
        }
      }
      this.renderBuff(b);
    }
  }

  clear(): void {
    for (const b of this.buffs) { if (b.el) b.el.remove(); }
    this.buffs = [];
  }

  get activeCount(): number { return this.buffs.length; }

  private createBuffElement(buff: ViewerBuff): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'buff-slot';
    Object.assign(wrapper.style, {
      position: 'relative',
      width: `${ICON_SIZE}px`,
      height: `${ICON_SIZE + 18}px`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      transition: 'transform 0.2s ease, opacity 0.3s ease',
      pointerEvents: 'auto',
      cursor: 'default',
    });

    const iconWrap = document.createElement('div');
    Object.assign(iconWrap.style, {
      position: 'relative',
      width: `${ICON_SIZE}px`,
      height: `${ICON_SIZE}px`,
    });

    const iconEl = document.createElement('canvas');
    iconEl.width = ICON_SIZE * 2;
    iconEl.height = ICON_SIZE * 2;
    iconEl.className = 'buff-icon-base';
    Object.assign(iconEl.style, {
      position: 'absolute', top: '0', left: '0',
      width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px`,
      borderRadius: '50%',
    });
    iconWrap.appendChild(iconEl);

    const overlayEl = document.createElement('canvas');
    overlayEl.width = ICON_SIZE * 2;
    overlayEl.height = ICON_SIZE * 2;
    overlayEl.className = 'buff-countdown';
    Object.assign(overlayEl.style, {
      position: 'absolute', top: '0', left: '0',
      width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px`,
      borderRadius: '50%',
    });
    iconWrap.appendChild(overlayEl);

    wrapper.appendChild(iconWrap);

    const timerEl = document.createElement('div');
    timerEl.className = 'buff-timer';
    Object.assign(timerEl.style, {
      fontSize: '11px',
      color: '#c8a951',
      textAlign: 'center',
      fontFamily: `${FONT_UI}`,
      fontWeight: 'bold',
      textShadow: '0 1px 3px rgba(0,0,0,0.9)',
      marginTop: '2px',
      whiteSpace: 'nowrap',
    });
    wrapper.appendChild(timerEl);

    const tooltip = document.createElement('div');
    tooltip.className = 'buff-tooltip-detail';
    Object.assign(tooltip.style, {
      position: 'absolute',
      bottom: `${ICON_SIZE + 24}px`,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(8,6,18,0.95)',
      border: '1px solid #4a3a60',
      borderRadius: '6px',
      padding: '10px 14px',
      minWidth: '180px',
      maxWidth: '240px',
      opacity: '0',
      transition: 'opacity 0.15s',
      pointerEvents: 'none',
      zIndex: '100',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    });
    wrapper.appendChild(tooltip);

    const ttName = document.createElement('div');
    Object.assign(ttName.style, {
      color: '#c8a951', fontSize: '13px', fontWeight: 'bold',
      marginBottom: '6px', borderBottom: '1px solid #2a2538',
      paddingBottom: '4px',
    });
    tooltip.appendChild(ttName);

    const ttEffects = document.createElement('div');
    ttEffects.className = 'tt-effects';
    Object.assign(ttEffects.style, { marginBottom: '6px' });
    tooltip.appendChild(ttEffects);

    const ttTime = document.createElement('div');
    ttTime.className = 'tt-time';
    Object.assign(ttTime.style, {
      fontSize: '11px', color: '#888',
      borderTop: '1px solid #1e1a2a', paddingTop: '4px',
    });
    tooltip.appendChild(ttTime);

    wrapper.addEventListener('mouseenter', () => {
      this.updateTooltip(buff);
      tooltip.style.opacity = '1';
    });
    wrapper.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
    });

    buff.el = wrapper;
    this.container.appendChild(wrapper);

    this.updateTooltip(buff);
    this.renderBuff(buff);
  }

  private updateTooltip(buff: ViewerBuff): void {
    if (!buff.el) return;
    const tooltip = buff.el.querySelector('.buff-tooltip-detail');
    if (!tooltip) return;

    const ttName = tooltip.children[0] as HTMLElement;
    const ttEffects = tooltip.children[1] as HTMLElement;

    ttName.textContent = buff.name;

    let html = '';
    if (buff.effects) {
      for (const [key, val] of Object.entries(buff.effects)) {
        if (val === undefined || val === 0) continue;
        const label = EFFECT_LABELS[key] || key;
        const value = formatEffectValue(key, val);
        const color = key === 'invulnerable' ? '#ffcc44' : '#88cc88';
        html += `<div style="display:flex;justify-content:space-between;font-size:11px;padding:1px 0">
          <span style="color:#aaa">${label}</span>
          <span style="color:${color};font-weight:bold">${value}</span>
        </div>`;
      }
    }
    if (!html) {
      html = '<div style="font-size:11px;color:#666;text-align:center">增益效果</div>';
    }
    ttEffects.innerHTML = html;
  }

  private renderBuff(buff: ViewerBuff): void {
    if (!buff.el) return;
    const wrapper = buff.el;
    const iconCanvas = wrapper.querySelector('.buff-icon-base') as HTMLCanvasElement | null;
    const overlayCanvas = wrapper.querySelector('.buff-countdown') as HTMLCanvasElement | null;
    const timerEl = wrapper.querySelector('.buff-timer') as HTMLElement | null;
    const ttTime = wrapper.querySelector('.tt-time') as HTMLElement | null;
    if (!iconCanvas || !overlayCanvas || !timerEl) return;

    const s = iconCanvas.width / ICON_SIZE;
    const cx = iconCanvas.width / 2;
    const cy = iconCanvas.height / 2;
    const rad = cx - 2;

    const drawnCanvas = iconCanvas as HTMLCanvasElement & { _drawn?: boolean };
    if (!drawnCanvas._drawn) {
      const ictx = iconCanvas.getContext('2d')!;
      ictx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
      ictx.drawImage(buff.iconCanvas, 0, 0, iconCanvas.width, iconCanvas.height);
      drawnCanvas._drawn = true;
    }

    const octx = overlayCanvas.getContext('2d')!;
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const pct = Math.max(0, buff.remainMs / buff.totalMs);
    const fadeAlpha = buff.remainMs <= 0 ? 1 - buff.fadePhase / FADE_OUT_MS : 1;

    if (pct < 1) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (1 - pct) * Math.PI * 2;

      octx.save();
      octx.globalAlpha = 0.55;
      octx.beginPath();
      octx.moveTo(cx, cy);
      octx.arc(cx, cy, rad, startAngle, endAngle);
      octx.closePath();
      octx.fillStyle = '#000000';
      octx.fill();
      octx.restore();

      if (pct > 0.02) {
        octx.save();
        octx.strokeStyle = '#c8a951';
        octx.lineWidth = 2.5 * s;
        octx.beginPath();
        octx.moveTo(cx, cy);
        octx.lineTo(cx + Math.cos(endAngle) * rad, cy + Math.sin(endAngle) * rad);
        octx.stroke();
        octx.restore();
      }
    }

    if (buff.remainMs > 0 && buff.remainMs < 5000) {
      const pulse = 0.3 + Math.sin(Date.now() * 0.008) * 0.2;
      octx.save();
      octx.beginPath();
      octx.arc(cx, cy, rad, 0, Math.PI * 2);
      octx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
      octx.lineWidth = 3 * s;
      octx.stroke();
      octx.restore();
    }

    wrapper.style.opacity = String(fadeAlpha);
    wrapper.style.transform = fadeAlpha < 1 ? `scale(${0.6 + fadeAlpha * 0.4})` : '';

    if (buff.remainMs > 0) {
      const sec = Math.ceil(buff.remainMs / 1000);
      timerEl.textContent = sec >= 60
        ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
        : `${sec}s`;
      timerEl.style.color = sec <= 5 ? '#ff4444' : '#c8a951';
    } else {
      timerEl.textContent = '';
    }

    if (ttTime && buff.remainMs > 0) {
      const sec = Math.ceil(buff.remainMs / 1000);
      const total = Math.ceil(buff.totalMs / 1000);
      ttTime.innerHTML = `⏱ 剩余 <span style="color:#c8a951">${sec}s</span> / ${total}s`;
    }
  }
}
