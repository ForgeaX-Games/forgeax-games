import { describe, expect, test } from 'bun:test';
import { sdkEnvironment } from '../run-sdk.mjs';

describe('standalone SDK host contract', () => {
  test('normalizes the SDK worker environment without mutating inherited values', () => {
    const inherited = {
      PATH: '/example/bin',
      NODE_OPTIONS: '--trace-warnings',
      FORGEAX_EXECUTION_WORKERS: '{"engine":true}',
    };
    const actual = sdkEnvironment(inherited);
    expect(JSON.parse(actual.FORGEAX_EXECUTION_WORKERS)).toEqual({ engine: false, render: false, kernels: 'auto' });
    expect(actual.NODE_OPTIONS).toBe('--trace-warnings --max-old-space-size=16384');
    expect(actual.PATH).toBe(inherited.PATH);
    expect(inherited.FORGEAX_EXECUTION_WORKERS).toBe('{"engine":true}');
    expect(inherited.NODE_OPTIONS).toBe('--trace-warnings');
  });

  test('both dev and production use the host wrapper; production fixes the public subpath', async () => {
    const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
    expect(pkg.scripts.dev).toBe('node scripts/run-sdk.mjs dev start');
    expect(pkg.scripts.build).toBe('node scripts/run-sdk.mjs project build --base /games/hellforge/ --json');
  });
});
