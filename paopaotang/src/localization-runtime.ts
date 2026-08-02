import catalogData from '../data/localization.json';

type CatalogRecord = { key: string; value: string };
const byKey = new Map((catalogData.records as CatalogRecord[]).map((record) => [record.key, record]));
const normalizeKey = (key: string): string => key.replace(/^paopaotang\.src\//, 'paopaotang.');
export const get = (key: string): string => {
  const value = byKey.get(key)?.value ?? byKey.get(normalizeKey(key))?.value;
  if (value === undefined) throw new Error(`Missing localization key: ${key}`);
  return value;
};
