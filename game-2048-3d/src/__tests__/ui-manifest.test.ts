import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const assetRoot = resolve(process.cwd(), 'templates/game-default/assets/ui');

async function readPack(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(assetRoot, name), 'utf8')) as Record<string, unknown>;
}

describe('game-default UI asset manifest', () => {
  it('keeps one GUID per self-contained UI pack', async () => {
    const hud = await readPack('hud.pack.json');
    const settings = await readPack('settings.pack.json');
    expect(hud.kind).toBe('internal-text-package');
    expect(settings.kind).toBe('internal-text-package');
    const hudAsset = (hud.assets as Array<{ guid: string; kind: string }>)[0];
    const settingsAsset = (settings.assets as Array<{ guid: string; kind: string }>)[0];
    const hudGuid = hudAsset?.guid;
    const settingsGuid = settingsAsset?.guid;
    expect(hudAsset?.kind).toBe('ui');
    expect(settingsAsset?.kind).toBe('ui');
    expect(hudGuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(settingsGuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(hudGuid).not.toBe(settingsGuid);
  });

  it('stores the final HTML and CSS payload without an importer or DDC', async () => {
    const hud = await readPack('hud.pack.json');
    const settings = await readPack('settings.pack.json');
    for (const pack of [hud, settings]) {
      const asset = (pack.assets as Array<{ payload: { html: string; css: string } }>)[0];
      expect(asset?.payload.html).toContain('data-ui');
      expect(asset?.payload.css).toContain(':host');
    }
    const settingsHtml = (settings.assets as Array<{ payload: { html: string } }>)[0]?.payload.html;
    expect(settingsHtml).toContain('data-ui-setting="clear-color"');
    expect(settingsHtml).toContain('value="purple"');
  });
});
