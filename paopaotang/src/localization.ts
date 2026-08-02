import * as dialogue from './npc-dialogue.gen';
import * as trashTalk from './trashtalk';
import catalogData from '../data/localization.json';
export { get } from './localization-runtime';

type CatalogRecord = { key: string; value: string; parts?: Array<{ text?: string; expression?: string }> };
const records = (catalogData.records as CatalogRecord[]);
const byKey = new Map(records.map((record) => [record.key, record]));

/** Resolve a localized string synchronously from the generated catalog. */
const getRecord = (key: string): string => {
  const record = byKey.get(key);
  if (!record) throw new Error(`Missing localization key: ${key}`);
  return record.value;
};

/** Render a structured template record with evaluated expression values. */
export const render = (key: string, values: readonly unknown[] = []): string => {
  const record = byKey.get(key);
  if (!record) throw new Error(`Missing localization key: ${key}`);
  if (!record.parts) return record.value;
  let index = 0;
  return record.parts.map((part) => part.text ?? String(values[index++] ?? '')).join('');
};

export interface LocalizationCatalog {
  readonly dialogue: typeof dialogue;
  readonly trashTalk: typeof trashTalk;
}

/** Read-only catalog facade. Data ownership lives in the localization data set. */
export const localization: LocalizationCatalog = Object.freeze({ dialogue, trashTalk });

export const getLocalization = (): LocalizationCatalog => localization;
