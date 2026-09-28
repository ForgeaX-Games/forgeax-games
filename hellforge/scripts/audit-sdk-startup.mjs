import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the real generated provider/loader, with a deliberately delayed or
// failing game. No Renderer/browser or source files are changed by this audit.
const projectRoot = resolve(process.argv[2] ?? process.cwd());
const facadeUrl = (specifier) => {
  const prefix = '@forgeax/engine/';
  assert(specifier.startsWith(prefix), `Unexpected SDK import: ${specifier}`);
  return pathToFileURL(join(projectRoot, 'node_modules/@forgeax/engine/dist/facades',
    `${specifier.slice(prefix.length)}.mjs`)).href;
};
const { Context } = await import(facadeUrl('@forgeax/engine/plugin'));
const { default: ts } = await import(pathToFileURL(
  join(projectRoot, 'node_modules/typescript/lib/typescript.js'),
).href);
const generated = await readFile(join(projectRoot, '.forgeax/generated/execution-bootstrap.ts'), 'utf8');
const oldImport = "import type { GameHost } from '@forgeax/engine/app';";
const newImport = "import { gameHostPlugin, type GameHost } from '@forgeax/engine/app';";
const oldProvider = "ctx.provide('gameHost', host);";
const newProvider = 'await ctx.plugin(gameHostPlugin(host));';
assert(generated.includes(newImport) && generated.includes(newProvider), 'Generated startup barrier missing: rebuild with the pinned DevKit patch');
assert(!generated.includes(oldProvider), 'The old direct provider is still present');
assert(generated.includes('const defaultSceneGuid = null;'), 'This probe expects Hellforge without a defaultScene');

const baseline = generated.replace(newImport, oldImport).replace(newProvider, oldProvider);
const fixtureCatalog = `const projectPluginCatalog = new Map([
  ['diagnostic-game', { realm: 'engine', version: 'static', load: () => ({ default: {
    name: 'diagnostic-game', inject: ['gameHost'], apply: globalThis.__startupBoundaryDiagnostic.game,
  } }) }],
]);`;

function replaceOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
  assert.equal(matches.length, 1, `Expected one ${label}, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

async function run(variant, source, shouldFail) {
  const events = [];
  let release;
  let started;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  const gameStarted = new Promise((resolveStarted) => { started = resolveStarted; });
  globalThis.__startupBoundaryDiagnostic = {
    async game() {
      events.push('game-start');
      started();
      await gate;
      if (shouldFail) throw new Error('diagnostic-init-failed');
      events.push('game-ready');
    },
  };
  source = replaceOnce(source,
    /const projectPluginCatalog = new Map\(\[[\s\S]*?\]\) satisfies PluginCatalog;/,
    fixtureCatalog, 'catalog');
  source = replaceOnce(source, /const projectEntries = [^\n]+;/,
    "const projectEntries = [{ id: 'game', name: 'diagnostic-game' }];", 'project entries');
  source = replaceOnce(source, /const projectBootstrapEntries = [^\n]+;/,
    'const projectBootstrapEntries = [];', 'bootstrap entries');
  source = source.replaceAll('import.meta.env.DEV', 'false');
  let javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  javascript = javascript.replace(/from (['"])(@forgeax\/[^'"]+)['"]/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(facadeUrl(specifier))}`);
  const bootstrap = await import(`data:text/javascript,${encodeURIComponent(javascript)}#${variant}-${shouldFail}`);
  const ctx = new Context();
  ctx.provide('world', {});
  ctx.provide('assets', {});
  ctx.provide('executionBootstrapHost', { setPointerLockAllowed() {} });
  const plugins = bootstrap.default().plugins.filter((plugin) =>
    ['forgeax:worker-project-plugins', 'forgeax:worker-game-host'].includes(plugin.name));
  assert.equal(plugins.length, 2);
  const pending = (async () => {
    for (const plugin of plugins) await ctx.plugin(plugin);
    events.push('startup-ready');
  })().catch((error) => events.push(`startup-error:${error.message}`));
  let timer;
  try {
    await Promise.race([gameStarted, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Game fixture never started')), 5000);
    })]);
    clearTimeout(timer);
    await new Promise((nextTurn) => setTimeout(nextTurn, 0));
    const beforeGate = [...events];
    release();
    await pending;
    await ctx.loader.await().catch((error) => events.push(`loader-error:${error.message}`));
    return { variant, shouldFail, beforeGate, afterGate: [...events] };
  } finally {
    clearTimeout(timer);
    release();
    await ctx.fiber.dispose();
    delete globalThis.__startupBoundaryDiagnostic;
  }
}

// A provider/Loader/disposal regression must fail CI, not wait forever after
// the fixture has started. This is an isolated, read-only audit process.
const auditDeadline = setTimeout(() => {
  console.error('FAIL: startup audit exceeded 30 seconds (initialization, Loader, or cleanup stalled)');
  process.exit(1);
}, 30_000);
try {
for (const [variant, source, fixed] of [
  ['unpatched-control', baseline, false],
  ['generated', generated, true],
]) {
  for (const shouldFail of [false, true]) {
    const result = await run(variant, source, shouldFail);
    assert.deepEqual(result.beforeGate, fixed ? ['game-start'] : ['game-start', 'startup-ready']);
    if (!shouldFail) {
      assert.deepEqual(result.afterGate, fixed
        ? ['game-start', 'game-ready', 'startup-ready']
        : ['game-start', 'startup-ready', 'game-ready']);
    } else {
      assert.equal(result.afterGate.some((event) => event.startsWith('startup-error:')), fixed);
      assert.equal(result.afterGate.some((event) => event.startsWith('loader-error:')), !fixed);
      assert(result.afterGate.at(-1).includes('diagnostic-init-failed'));
      assert(!result.afterGate.includes('game-ready'));
    }
    console.log(JSON.stringify(result));
  }
}
console.log('PASS: generated startup waits for delayed game readiness and propagates activation failure');
} finally {
  clearTimeout(auditDeadline);
}
