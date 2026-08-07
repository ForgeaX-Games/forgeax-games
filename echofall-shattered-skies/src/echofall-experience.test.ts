import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gameRoot = resolve(import.meta.dir, '..');
const main = readFileSync(resolve(gameRoot, 'main.ts'), 'utf8');
const hudPack = readFileSync(resolve(gameRoot, 'assets/ui.pack.json'), 'utf8');
const hudHtml = readFileSync(resolve(gameRoot, 'ui/hud.html'), 'utf8');
const hudCss = readFileSync(resolve(gameRoot, 'ui/hud.css'), 'utf8');

describe('Echofall first-minute experience contract', () => {
  test('keeps a progress-preserving checkpoint recall separate from full restart', () => {
    expect(main).toContain("{ action: 'recall', bindings: [KEY('c'), KEY('C')] }");
    expect(main).toContain("recallCheckpoint('manual')");
    expect(main).toContain("event(reason === 'fall' ? 'respawn' : 'checkpoint_recall'");
    expect(main).toContain('collected.clear(); activated.clear(); shards = 0; beacons = 0; deaths = 0;');
  });

  test('ships the actionable objective and compact checkpoint HUD in the loaded UI asset', () => {
    expect(hudPack).toContain('data-ui-slot=\\"checkpoint\\"');
    expect(hudPack).toContain('C RECALL');
    expect(hudPack).toContain('@media (max-width: 900px)');
    const payload = (JSON.parse(hudPack) as {
      assets: Array<{ payload: { html: string; css: string } }>;
    }).assets[0]?.payload;
    expect(payload?.html).toBe(hudHtml);
    expect(payload?.css).toBe(hudCss);
  });

  test('uses one milestone shard count and keeps transient messages out of the aiming field', () => {
    expect(hudHtml).toContain('data-ui-slot="shards">0 / 2');
    expect(hudHtml).not.toContain('0 / 8');
    expect(hudHtml).not.toContain('class="reticle"');
    expect(hudHtml).toContain('data-ui-slot="message" aria-live="polite"></div>');
    expect(hudCss).toContain('bottom: 128px');
    expect(hudCss).not.toContain('top: 16%');
  });
});
