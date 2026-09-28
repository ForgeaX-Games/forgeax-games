import { afterEach, describe, expect, test } from 'bun:test';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { auditWebDist, DEFAULT_BASE, MAX_SINGLE_FILE_BYTES } from './web-dist-contract.mjs';

const BASE = DEFAULT_BASE;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function put(root: string, relative: string, value: string | Uint8Array): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, value);
}

function makeFixture(options: { indexRef?: string; packageUrl?: string; bodyPath?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'hellforge-web-dist-'));
  roots.push(root);
  const main = 'console.log("fixture");\n';
  const preload = 'export {};\n';
  const body = Buffer.from('materialized body\n');
  put(root, 'assets/main.js', main);
  put(root, 'assets/preload.js', preload);
  put(root, 'assets/body.bin', body);
  put(root, 'assets/pkg.pack.json', JSON.stringify({
    schemaVersion: '2.0.0',
    kind: 'internal-text-package',
    assets: [{ guid: 'guid-body', kind: 'texture', payload: {}, artifacts: { body: { path: options.bodyPath ?? 'body.bin' } }, refs: ['guid-body'] }],
  }));
  put(root, 'shaders/manifest.json', JSON.stringify({
    entries: [{ hash: 'shader-hash', wgsl: 'fn main() {}', bindings: {}, uvSetCount: 0, glsl: '' }],
    materialShaders: [{ identifier: 'fixture::shader', sourcePath: 'packages/shader/fixture.wgsl', composedWgsl: 'fn main() {}', variants: [] }],
  }));
  const indexRef = options.indexRef ?? `${BASE}assets/main.js`;
  put(root, 'index.html', `<!doctype html><html><head><link rel="modulepreload" href="${BASE}assets/preload.js"><link rel="icon" href="data:,"></head><body><script type="module" src="${indexRef}"></script></body></html>`);
  put(root, 'pack-index.json', JSON.stringify([{ guid: 'guid-body', packageUrl: options.packageUrl ?? `${BASE}assets/pkg.pack.json` }]));
  const artifactPaths = ['index.html', 'assets/main.js', 'assets/preload.js', 'assets/body.bin', 'assets/pkg.pack.json', 'pack-index.json', 'shaders/manifest.json'];
  const artifacts = artifactPaths.map((path) => {
    const bytes = Bun.file(join(root, path));
    return { path, bytes: bytes.size, sha256: sha256(readFileSyncCompat(join(root, path))) };
  });
  // Keep the pack-index digest explicit in the fixture metadata.
  const pack = artifacts.find((artifact) => artifact.path === 'pack-index.json')!;
  pack.bytes = Bun.file(join(root, 'pack-index.json')).size;
  pack.sha256 = sha256(readFileSyncCompat(join(root, 'pack-index.json')));
  const metadata = {
    schemaVersion: '1.0.0',
    project: { id: 'hellforge', name: 'Fixture' },
    base: BASE,
    runtime: { packIndexUrl: 'pack-index.json', shaderManifestUrl: 'shaders/manifest.json' },
    artifacts,
  };
  put(root, 'forgeax-dist.json', JSON.stringify(metadata));
  return root;
}

function readFileSyncCompat(path: string): Buffer {
  return Buffer.from(readFileSync(path));
}

function failureCodes(report: ReturnType<typeof auditWebDist>): string[] {
  return report.failures.map((failure) => failure.code);
}

describe('web dist publish contract', () => {
  test('accepts a fully materialized subpath build and reports manifest hashes', () => {
    const root = makeFixture();
    const report = auditWebDist({ dist: root, base: BASE });
    expect(report.ok).toBe(true);
    expect(report.index.scriptEntries).toBe(1);
    expect(report.pack?.packages).toBe(1);
    expect(report.pack?.localArtifactRefs).toBe(1);
    expect(report.shaders?.entries).toBe(1);
    expect(report.manifests.forgeaxDist.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.manifests.packIndex?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.ignoredExternalRefs.some((item) => item.ref === 'data:,')).toBe(true);
  });

  test('rejects root-relative assets that escape the game base', () => {
    const root = makeFixture({ indexRef: '/assets/main.js', packageUrl: '/assets/pkg.pack.json' });
    const report = auditWebDist({ dist: root, base: BASE });
    expect(report.ok).toBe(false);
    expect(failureCodes(report)).toContain('outside-base');
  });

  test('rejects a missing HTML entry and missing package resource', () => {
    const root = makeFixture({ bodyPath: 'missing.bin' });
    rmSync(join(root, 'assets/main.js'));
    const report = auditWebDist({ dist: root, base: BASE });
    expect(report.ok).toBe(false);
    expect(failureCodes(report)).toContain('missing-resource');
    expect(report.failures.some((failure) => failure.path.includes('index.html'))).toBe(true);
    expect(report.failures.some((failure) => failure.path.includes('body.path'))).toBe(true);
  });

  test('rejects path traversal in manifest resources', () => {
    const root = makeFixture({ bodyPath: '../secret.bin' });
    const report = auditWebDist({ dist: root, base: BASE });
    expect(report.ok).toBe(false);
    expect(failureCodes(report)).toContain('path-traversal');
  });

  test('rejects a file at the GitHub 100 MiB boundary', () => {
    const root = makeFixture();
    const path = join(root, 'assets/oversized.bin');
    const fd = openSync(path, 'w');
    ftruncateSync(fd, MAX_SINGLE_FILE_BYTES);
    closeSync(fd);
    const report = auditWebDist({ dist: root, base: BASE });
    expect(report.ok).toBe(false);
    expect(failureCodes(report)).toContain('oversized-file');
    expect(report.maxFile?.bytes).toBe(MAX_SINGLE_FILE_BYTES);
  });

  test('rejects an unmaterialized Git LFS pointer', () => {
    const root = makeFixture();
    put(root, 'assets/body.bin', 'version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsize 18\n');
    const report = auditWebDist({ dist: root, base: BASE });
    expect(report.ok).toBe(false);
    expect(failureCodes(report)).toContain('lfs-pointer');
  });
});
