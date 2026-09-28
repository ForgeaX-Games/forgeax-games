import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  assembleAssetRuntime,
  DEFAULT_ASSET_CATALOG_URL,
} from '@forgeax/engine/app';

const appOptions = createRequire(import.meta.url);
const engineRequire = createRequire(appOptions.resolve('@forgeax/engine/package.json'));

function makeRegistry(initialPackIndexUrl?: string) {
  const configuredUrls: string[] = [];
  const installedCatalogs: unknown[] = [];
  const registry = {
    packIndexUrl: initialPackIndexUrl,
    loaders: { register: () => () => {} },
    configurePackIndex(url: string) {
      configuredUrls.push(url);
      this.packIndexUrl = url;
    },
    setCatalogSource(source: unknown) { installedCatalogs.push(source); },
    clearCatalogSource() {},
  };
  return {
    registry: registry as unknown as Parameters<typeof assembleAssetRuntime>[0],
    configuredUrls,
    installedCatalogs,
  };
}

function catalogSource(url?: string) {
  return {
    ...(url === undefined ? {} : { url }),
    enumerate: async () => ({ ok: true as const, value: [] }),
    subscribe: () => () => {},
  } as NonNullable<Parameters<typeof assembleAssetRuntime>[2]>['catalogSource'];
}

describe('SDK 0.2.1 static asset-catalog patch', () => {
  test('DevKit production non-worker bootstrap passes its CatalogSource to createApp', () => {
    const devkitCliPath = engineRequire.resolve('@forgeax/engine-devkit/cli');
    const devkitCli = readFileSync(devkitCliPath, 'utf8');
    const nonWorkerOptionsStart = devkitCli.indexOf(': {\n            context: ctx.root');
    const nonWorkerOptionsEnd = devkitCli.indexOf('\n          },\n      workerExecution', nonWorkerOptionsStart);

    expect(nonWorkerOptionsStart).toBeGreaterThanOrEqual(0);
    expect(nonWorkerOptionsEnd).toBeGreaterThan(nonWorkerOptionsStart);
    expect(devkitCli.slice(nonWorkerOptionsStart, nonWorkerOptionsEnd)).toContain(
      '...(import.meta.env.DEV ? {} : { assetCatalog }),',
    );
  });

  test('App Registry uses the CatalogSource URL for loadByGuid and preserves a configured URL', () => {
    const explicitCatalog = catalogSource('/games/hellforge/pack-index.json');
    const withCatalog = makeRegistry();
    const explicitResult = assembleAssetRuntime(withCatalog.registry, [], {
      catalogSource: explicitCatalog,
    });

    expect(explicitResult.ok).toBe(true);
    expect(withCatalog.configuredUrls).toEqual(['/games/hellforge/pack-index.json']);
    expect(withCatalog.registry.packIndexUrl).toBe('/games/hellforge/pack-index.json');
    expect(withCatalog.installedCatalogs).toEqual([explicitCatalog]);

    const configuredRegistry = makeRegistry('/already-configured/pack-index.json');
    const configuredResult = assembleAssetRuntime(configuredRegistry.registry, [], {
      catalogSource: explicitCatalog,
    });
    expect(configuredResult.ok).toBe(true);
    expect(configuredRegistry.configuredUrls).toHaveLength(0);
    expect(configuredRegistry.registry.packIndexUrl).toBe('/already-configured/pack-index.json');
  });

  test('static entries without a CatalogSource URL retain the declared root fallback', () => {
    const staticEntriesCatalog = catalogSource();
    const { registry, configuredUrls, installedCatalogs } = makeRegistry();
    const result = assembleAssetRuntime(registry, [], { catalogSource: staticEntriesCatalog });

    expect(result.ok).toBe(true);
    expect(configuredUrls).toEqual([DEFAULT_ASSET_CATALOG_URL]);
    expect(registry.packIndexUrl).toBe(DEFAULT_ASSET_CATALOG_URL);
    expect(installedCatalogs).toEqual([staticEntriesCatalog]);
  });
});
