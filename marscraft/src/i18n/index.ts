/**
 * MarsCraft -> forgeax-engine — tiny i18n (Milestone M12)
 * =============================================================================
 * Faithful port of the Three.js source `web/i18n/I18n.ts`: a zero-dependency
 * `t(key, params?)` + locale switcher over flattened JSON message maps.
 *
 * ── Adaptations vs source ─────────────────────────────────────────────────────
 *   - The source merged the game + editor locale bundles; this port carries only
 *     the GAME HUD chrome strings (resource bar / command card / selection panel)
 *     in `en.json` / `zh.json` (en = source, zh = overlay). Unit / building /
 *     ability NAMES already live as `displayName` in `src/data/*` (the source's
 *     i18n display-name helper was dropped when those tables were ported), so the
 *     HUD reads those directly and uses `t()` only for UI chrome.
 *   - Interpolation uses the source's `{var}` syntax (single braces).
 *   - `localStorage` is guarded so a headless load never throws (the whole HUD is
 *     DOM-guarded too; this module is import-safe with no `document`).
 *
 * EN is the source of truth; missing ZH keys fall back to EN, missing EN keys
 * fall back to the bracketed key (so a gap is visible, never a crash).
 */

import en from './en.json';
import zh from './zh.json';

export type Language = 'en' | 'zh';

const STORAGE_KEY = 'marscraft_language';
const DEFAULT_LANG: Language = 'en';

type Json = Record<string, unknown>;

function flattenJSON(obj: Json, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (typeof val === 'string') {
      result[fullKey] = val;
    } else if (typeof val === 'object' && val !== null) {
      Object.assign(result, flattenJSON(val as Json, fullKey));
    }
  }
  return result;
}

const locales: Record<Language, Record<string, string>> = {
  en: flattenJSON(en as Json),
  zh: flattenJSON(zh as Json),
};

function loadLanguage(): Language {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'zh') return stored;
    }
  } catch {
    /* no localStorage (headless / SSR) */
  }
  return DEFAULT_LANG;
}

let currentLang: Language = loadLanguage();
let flatMessages: Record<string, string> = locales[currentLang];

type LanguageChangeCallback = (lang: Language) => void;
const listeners: Set<LanguageChangeCallback> = new Set();

/**
 * Translate a key with optional `{var}` interpolation.
 * `t('hud.income_per_min', { rate: 42 })` => "+42/min".
 * Falls back to EN, then to `[key]` so a gap is visible but never throws.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let msg = flatMessages[key];
  if (msg === undefined) {
    msg = locales.en[key];
    if (msg === undefined) return `[${key}]`;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return msg;
}

export function getLanguage(): Language {
  return currentLang;
}

export function setLanguage(lang: Language): void {
  if (lang === currentLang) return;
  currentLang = lang;
  flatMessages = locales[lang];
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  for (const cb of listeners) {
    try {
      cb(lang);
    } catch (e) {
      console.error('[marscraft][i18n] listener error:', e);
    }
  }
}

/** Subscribe to language changes. Returns an unsubscribe fn. */
export function onLanguageChange(callback: LanguageChangeCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
