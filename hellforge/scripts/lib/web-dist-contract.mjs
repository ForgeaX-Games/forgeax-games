import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const DEFAULT_BASE = '/games/hellforge/';
export const MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024;

const URL_OR_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n(?:oid sha256:[0-9a-f]{64}\r?\n)?/;
const ORIGIN = 'https://forgeax.invalid';

function posixPath(value) {
  return value.split(sep).join('/');
}

function uniqueKey(value) {
  return JSON.stringify(value);
}

function isInside(root, candidate) {
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(rootWithSep);
}

function makeBaseUrl(base) {
  return new URL(base, ORIGIN);
}

function parseJson(path, failures, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures.push({
      code: 'invalid-json',
      path: label,
      message: `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isLfsPointer(path, bytes) {
  if (bytes > 1024) return false;
  try {
    const text = readFileSync(path, 'utf8');
    return LFS_POINTER.test(text);
  } catch {
    return false;
  }
}

function addFailure(state, code, path, message, details = {}) {
  const failure = { code, path, message, ...details };
  const key = uniqueKey(failure);
  if (!state.failureKeys.has(key)) {
    state.failureKeys.add(key);
    state.failures.push(failure);
  }
}

function addExternal(state, source, ref, reason = 'external URL') {
  const item = { source, ref, reason };
  const key = uniqueKey(item);
  if (!state.externalKeys.has(key)) {
    state.externalKeys.add(key);
    state.externalRefs.push(item);
  }
}

function collectInventory(distRoot, state) {
  const files = new Map();
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      addFailure(
        state,
        'unreadable-directory',
        posixPath(relative(distRoot, directory)) || '.',
        `cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const rel = posixPath(relative(distRoot, absolute));
      if (entry.isSymbolicLink()) {
        addFailure(state, 'symlink', rel, 'published output must contain materialized regular files, not symlinks');
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        addFailure(state, 'unsupported-file', rel, 'published output contains a non-regular file');
        continue;
      }
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch (error) {
        addFailure(
          state,
          'unreadable-file',
          rel,
          `cannot stat file: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      const record = { rel, absolute, bytes: stat.size };
      files.set(rel, record);
      if (isLfsPointer(absolute, stat.size)) {
        addFailure(state, 'lfs-pointer', rel, 'file is an unmaterialized Git LFS pointer');
      }
      if (stat.size >= MAX_SINGLE_FILE_BYTES) {
        addFailure(
          state,
          'oversized-file',
          rel,
          `file is ${stat.size} bytes; every published file must be smaller than 100 MiB`,
          { bytes: stat.size, limitBytes: MAX_SINGLE_FILE_BYTES },
        );
      }
    }
  };

  if (!existsSync(distRoot)) {
    addFailure(state, 'missing-dist', '.', `dist directory does not exist: ${distRoot}`);
    return files;
  }
  let rootStat;
  try {
    rootStat = lstatSync(distRoot);
  } catch (error) {
    addFailure(state, 'missing-dist', '.', `cannot stat dist directory: ${error instanceof Error ? error.message : String(error)}`);
    return files;
  }
  if (!rootStat.isDirectory()) {
    addFailure(state, 'invalid-dist', '.', `dist path is not a directory: ${distRoot}`);
    return files;
  }
  walk(distRoot);
  return files;
}

function normalizeExpectedBase(raw, state) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || !raw.endsWith('/')) {
    addFailure(state, 'invalid-base', 'base', `base must be an absolute URL path ending in '/': ${String(raw)}`);
    return null;
  }
  if (raw.includes('?') || raw.includes('#') || raw.split('/').includes('..')) {
    addFailure(state, 'invalid-base', 'base', `base must not contain query, fragment, or traversal segments: ${raw}`);
    return null;
  }
  try {
    const url = makeBaseUrl(raw);
    if (url.pathname !== raw || url.origin !== ORIGIN) {
      addFailure(state, 'invalid-base', 'base', `base is not a normalized local URL path: ${raw}`);
      return null;
    }
  } catch (error) {
    addFailure(state, 'invalid-base', 'base', `base is invalid: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return raw;
}

function checkTraversal(ref) {
  const pathPart = String(ref).split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart.replaceAll('\\', '/'));
  } catch {
    return 'invalid-percent-encoding';
  }
  if (decoded.split('/').some((segment) => segment === '..')) return 'path-traversal';
  if (decoded.includes('\0')) return 'nul-byte';
  return null;
}

function resolveReference(state, ref, sourceUrl, source) {
  if (typeof ref !== 'string' || !ref.trim()) {
    addFailure(state, 'invalid-reference', source, 'resource reference must be a non-empty string');
    return { kind: 'invalid' };
  }
  const text = ref.trim();
  if (URL_OR_SCHEME.test(text) || text.startsWith('//')) {
    addExternal(state, source, text);
    return { kind: 'external', ref: text };
  }
  const traversal = checkTraversal(text);
  if (traversal) {
    addFailure(state, traversal, source, `resource reference is unsafe: ${text}`);
    return { kind: 'invalid' };
  }

  let url;
  let pathname;
  try {
    url = new URL(text, sourceUrl);
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    addFailure(
      state,
      'invalid-reference',
      source,
      `resource reference cannot be resolved: ${text} (${error instanceof Error ? error.message : String(error)})`,
    );
    return { kind: 'invalid' };
  }
  if (url.origin !== ORIGIN || url.protocol !== 'https:') {
    addExternal(state, source, text);
    return { kind: 'external', ref: text };
  }
  if (!pathname.startsWith(state.base)) {
    addFailure(
      state,
      'outside-base',
      source,
      `resource resolves outside ${state.base}: ${text} → ${pathname}`,
      { resolved: pathname },
    );
    return { kind: 'invalid' };
  }
  const rel = pathname.slice(state.base.length) || 'index.html';
  const absolute = resolve(state.distRoot, ...rel.split('/'));
  if (!isInside(state.distRoot, absolute)) {
    addFailure(state, 'outside-dist', source, `resource escapes dist: ${text}`);
    return { kind: 'invalid' };
  }
  return { kind: 'local', ref: text, url, pathname, rel, absolute };
}

function checkFileReference(state, ref, sourceUrl, source) {
  const result = resolveReference(state, ref, sourceUrl, source);
  if (result.kind !== 'local') return result;
  if (!state.files.has(result.rel)) {
    addFailure(state, 'missing-resource', source, `referenced file does not exist: ${result.rel}`, { resolved: result.pathname });
    return { ...result, exists: false };
  }
  return { ...result, exists: true };
}

function manifestSummary(path, files, hashCache, fallbackPath) {
  const record = files.get(path);
  if (!record) return { path: fallbackPath, bytes: null, sha256: null };
  if (!hashCache.has(record.absolute)) hashCache.set(record.absolute, sha256File(record.absolute));
  return { path, bytes: record.bytes, sha256: hashCache.get(record.absolute) };
}

function readLocalJson(state, relativePath, label) {
  const record = state.files.get(relativePath);
  if (!record) {
    addFailure(state, 'missing-resource', label, `referenced file does not exist: ${relativePath}`);
    return null;
  }
  return parseJson(record.absolute, state.failures, label);
}

function collectIndexReferences(html) {
  const patterns = [
    ['script', 'src'],
    ['link', 'href'],
    ['img', 'src'],
    ['audio', 'src'],
    ['video', 'src'],
    ['video', 'poster'],
    ['source', 'src'],
    ['track', 'src'],
    ['iframe', 'src'],
    ['object', 'data'],
    ['embed', 'src'],
    ['base', 'href'],
  ];
  const refs = [];
  for (const [tag, attr] of patterns) {
    const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*(["'])(.*?)\\1[^>]*>`, 'gi');
    for (const match of html.matchAll(pattern)) {
      refs.push({ tag, attr, ref: match[2] });
    }
  }
  return refs;
}

function validateIndex(state, indexRecord) {
  let html;
  try {
    html = readFileSync(indexRecord.absolute, 'utf8');
  } catch (error) {
    addFailure(state, 'unreadable-file', 'index.html', `cannot read index.html: ${error instanceof Error ? error.message : String(error)}`);
    return { refs: [], scriptEntries: 0 };
  }
  const refs = collectIndexReferences(html);
  const sourceUrl = makeBaseUrl(state.base);
  let scriptEntries = 0;
  for (const item of refs) {
    if (item.tag === 'script' && item.attr === 'src') scriptEntries += 1;
    checkFileReference(state, item.ref, sourceUrl, `index.html ${item.tag}.${item.attr}`);
  }
  if (scriptEntries === 0) {
    addFailure(state, 'missing-index-entry', 'index.html', 'index.html has no script src entry');
  }
  return { refs, scriptEntries };
}

function validateForgeaxArtifacts(state, metadata, baseUrl, hashCache) {
  const artifacts = metadata?.artifacts;
  const result = { declared: Array.isArray(artifacts) ? artifacts.length : 0, checked: 0, hashMismatches: 0, byteMismatches: 0 };
  if (!Array.isArray(artifacts)) {
    addFailure(state, 'invalid-artifact-manifest', 'forgeax-dist.json.artifacts', 'artifacts must be an array');
    return result;
  }
  for (const [index, artifact] of artifacts.entries()) {
    const source = `forgeax-dist.json.artifacts[${index}]`;
    if (!artifact || typeof artifact !== 'object' || typeof artifact.path !== 'string') {
      addFailure(state, 'invalid-artifact-manifest', source, 'artifact must declare a string path');
      continue;
    }
    const local = checkFileReference(state, artifact.path, baseUrl, source);
    if (local.kind !== 'local' || !local.exists) continue;
    result.checked += 1;
    const record = state.files.get(local.rel);
    if (typeof artifact.bytes !== 'number' || !Number.isInteger(artifact.bytes) || artifact.bytes < 0) {
      addFailure(state, 'invalid-artifact-manifest', source, 'artifact.bytes must be a non-negative integer');
    } else if (record.bytes !== artifact.bytes) {
      result.byteMismatches += 1;
      addFailure(state, 'artifact-byte-mismatch', local.rel, `manifest declares ${artifact.bytes} bytes but file is ${record.bytes} bytes`, { declared: artifact.bytes, actual: record.bytes });
    }
    if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(artifact.sha256)) {
      addFailure(state, 'invalid-artifact-manifest', source, 'artifact.sha256 must be a 64-character hexadecimal digest');
    } else {
      if (!hashCache.has(record.absolute)) hashCache.set(record.absolute, sha256File(record.absolute));
      const actual = hashCache.get(record.absolute);
      if (actual.toLowerCase() !== artifact.sha256.toLowerCase()) {
        result.hashMismatches += 1;
        addFailure(state, 'artifact-hash-mismatch', local.rel, `manifest hash does not match file`, { declared: artifact.sha256, actual });
      }
    }
  }
  return result;
}

function collectArtifactPaths(value, trail, out) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectArtifactPaths(item, `${trail}[${index}]`, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string') out.push({ path: value.path, trail: `${trail}.path` });
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'path') collectArtifactPaths(child, `${trail}.${key}`, out);
  }
}

function validatePackage(state, packageRel, packageJson, packageUrl) {
  if (!packageJson || typeof packageJson !== 'object' || !Array.isArray(packageJson.assets)) {
    addFailure(state, 'invalid-package-schema', packageRel, 'package JSON must contain an assets array');
    return { artifactRefs: 0, localRefs: 0 };
  }
  const refs = [];
  for (const [index, asset] of packageJson.assets.entries()) {
    if (!asset || typeof asset !== 'object') continue;
    if (asset.artifacts !== undefined) collectArtifactPaths(asset.artifacts, `assets[${index}].artifacts`, refs);
  }
  let localRefs = 0;
  for (const item of refs) {
    const local = checkFileReference(state, item.path, packageUrl, `${packageRel}:${item.trail}`);
    if (local.kind === 'local' && local.exists) localRefs += 1;
  }
  return { artifactRefs: refs.length, localRefs };
}

function validatePackIndex(state, packJson, packRel) {
  const result = { entries: Array.isArray(packJson) ? packJson.length : 0, packageUrls: 0, uniquePackageUrls: 0, packages: 0, artifactRefs: 0, localArtifactRefs: 0 };
  if (!Array.isArray(packJson)) {
    addFailure(state, 'invalid-pack-index', packRel, 'pack-index.json must be an array');
    return result;
  }
  const sourceUrl = makeBaseUrl(state.base);
  const packages = new Map();
  const seenPackageUrls = new Set();
  for (const [index, entry] of packJson.entries()) {
    const source = `${packRel}[${index}].packageUrl`;
    if (!entry || typeof entry !== 'object' || typeof entry.packageUrl !== 'string') {
      addFailure(state, 'missing-package-url', source, 'pack-index entry must declare packageUrl');
      continue;
    }
    result.packageUrls += 1;
    if (seenPackageUrls.has(entry.packageUrl)) continue;
    seenPackageUrls.add(entry.packageUrl);
    result.uniquePackageUrls += 1;
    const local = checkFileReference(state, entry.packageUrl, sourceUrl, source);
    if (local.kind === 'local' && local.exists) packages.set(local.rel, local);
  }
  result.packages = packages.size;
  for (const [packageRel, packageRef] of packages) {
    const packageJson = readLocalJson(state, packageRel, packageRel);
    const checked = validatePackage(state, packageRel, packageJson, packageRef.url);
    result.artifactRefs += checked.artifactRefs;
    result.localArtifactRefs += checked.localRefs;
  }
  return result;
}

function validateShaderManifest(state, shaderJson, shaderRel) {
  const result = {
    entries: Array.isArray(shaderJson?.entries) ? shaderJson.entries.length : 0,
    materialShaders: Array.isArray(shaderJson?.materialShaders) ? shaderJson.materialShaders.length : 0,
    localRefs: 0,
    ignoredProvenancePaths: 0,
  };
  if (!shaderJson || typeof shaderJson !== 'object' || !Array.isArray(shaderJson.entries) || !Array.isArray(shaderJson.materialShaders)) {
    addFailure(state, 'invalid-shader-manifest', shaderRel, 'shader manifest must contain entries and materialShaders arrays');
    return result;
  }
  // `sourcePath` is compiler provenance and shader source is embedded in wgsl/glsl
  // fields. It is intentionally not treated as a publish URL or as a local file.
  result.ignoredProvenancePaths = shaderJson.materialShaders.filter((row) => typeof row?.sourcePath === 'string').length;
  return result;
}

function compareBase(state, metadata) {
  if (typeof metadata?.base !== 'string') {
    addFailure(state, 'missing-base', 'forgeax-dist.json.base', 'forgeax-dist.json must declare base');
    return;
  }
  if (metadata.base !== state.base) {
    addFailure(state, 'base-mismatch', 'forgeax-dist.json.base', `metadata base ${metadata.base} does not equal requested ${state.base}`, { declared: metadata.base, expected: state.base });
  }
}

function runtimeReference(state, metadata, field) {
  const value = metadata?.runtime?.[field];
  const source = `forgeax-dist.json.runtime.${field}`;
  if (typeof value !== 'string' || !value) {
    addFailure(state, 'missing-runtime-ref', source, `${field} must be a non-empty string`);
    return null;
  }
  return checkFileReference(state, value, makeBaseUrl(state.base), source);
}

function reportManifest(state, relativePath, hashCache, extra = {}) {
  return { ...manifestSummary(relativePath, state.files, hashCache, relativePath), ...extra };
}

export function auditWebDist({ dist = 'dist', base = DEFAULT_BASE } = {}) {
  const distRoot = resolve(dist);
  const state = {
    distRoot,
    base: null,
    files: new Map(),
    failures: [],
    failureKeys: new Set(),
    externalRefs: [],
    externalKeys: new Set(),
  };
  state.base = normalizeExpectedBase(base, state);
  state.files = collectInventory(distRoot, state);

  const records = [...state.files.values()];
  const totalBytes = records.reduce((sum, record) => sum + record.bytes, 0);
  const maxRecord = records.slice().sort((a, b) => b.bytes - a.bytes || a.rel.localeCompare(b.rel))[0] ?? null;
  const hashCache = new Map();
  const report = {
    ok: false,
    dist: distRoot,
    base: state.base ?? base,
    fileCount: records.length,
    totalBytes,
    maxFile: maxRecord ? { path: maxRecord.rel, bytes: maxRecord.bytes } : null,
    limitBytes: MAX_SINGLE_FILE_BYTES,
    manifests: {
      forgeaxDist: reportManifest(state, 'forgeax-dist.json', hashCache),
      packIndex: null,
      shaderManifest: null,
    },
    index: { path: 'index.html', scriptEntries: 0, refs: [] },
    pack: null,
    shaders: null,
    artifacts: null,
    ignoredExternalRefs: state.externalRefs,
    failures: state.failures,
  };

  const indexRecord = state.files.get('index.html');
  if (!indexRecord) {
    addFailure(state, 'missing-entry', 'index.html', 'dist must contain index.html');
  } else if (state.base) {
    report.index = validateIndex(state, indexRecord);
    report.index.path = 'index.html';
  }

  const metadata = state.files.has('forgeax-dist.json')
    ? parseJson(state.files.get('forgeax-dist.json').absolute, state.failures, 'forgeax-dist.json')
    : null;
  if (!metadata) {
    if (!state.files.has('forgeax-dist.json')) addFailure(state, 'missing-manifest', 'forgeax-dist.json', 'dist must contain forgeax-dist.json');
  } else if (state.base) {
    compareBase(state, metadata);
    report.artifacts = validateForgeaxArtifacts(state, metadata, makeBaseUrl(state.base), hashCache);
    const packRef = runtimeReference(state, metadata, 'packIndexUrl');
    const shaderRef = runtimeReference(state, metadata, 'shaderManifestUrl');
    if (packRef?.kind === 'local' && packRef.exists) {
      const packJson = readLocalJson(state, packRef.rel, packRef.rel);
      report.manifests.packIndex = reportManifest(state, packRef.rel, hashCache, { declaredBy: 'runtime.packIndexUrl' });
      report.pack = validatePackIndex(state, packJson, packRef.rel);
    }
    if (shaderRef?.kind === 'local' && shaderRef.exists) {
      const shaderJson = readLocalJson(state, shaderRef.rel, shaderRef.rel);
      report.manifests.shaderManifest = reportManifest(state, shaderRef.rel, hashCache, { declaredBy: 'runtime.shaderManifestUrl' });
      report.shaders = validateShaderManifest(state, shaderJson, shaderRef.rel);
    }
  }

  // Keep the report's external-reference view live after validation added entries.
  report.ignoredExternalRefs = state.externalRefs;
  report.failures = state.failures;
  report.ok = state.failures.length === 0;
  return report;
}
