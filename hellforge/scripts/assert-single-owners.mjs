#!/usr/bin/env bun
/**
 * Evaluate __hf.assertSingleOwners() inside a Play context.
 *
 * Usage (from a gateway / CDP helper that can inject into the Play iframe):
 *   bun hellforge/scripts/assert-single-owners.mjs
 *
 * Without a live bridge, this script expects HF_OWNERS_JSON env to contain the
 * JSON result of window.__hf.assertSingleOwners() and exits non-zero on failure.
 */

const raw = process.env.HF_OWNERS_JSON;
if (!raw) {
  console.error(
    '[assert-single-owners] Set HF_OWNERS_JSON to the JSON of window.__hf.assertSingleOwners()',
  );
  console.error(
    'Example: HF_OWNERS_JSON="$(gateway eval \'JSON.stringify(window.__hf.assertSingleOwners())\')" bun hellforge/scripts/assert-single-owners.mjs',
  );
  process.exit(2);
}

let result;
try {
  result = JSON.parse(raw);
} catch (err) {
  console.error('[assert-single-owners] invalid JSON:', err);
  process.exit(2);
}

if (!result || typeof result !== 'object') {
  console.error('[assert-single-owners] expected object result');
  process.exit(2);
}

if (result.ok === true) {
  console.log('[assert-single-owners] OK', JSON.stringify(result.snapshot ?? {}, null, 2));
  process.exit(0);
}

console.error('[assert-single-owners] FAIL');
for (const f of result.failures ?? ['(no failures array)']) console.error(' -', f);
console.error(JSON.stringify(result.snapshot ?? {}, null, 2));
process.exit(1);
