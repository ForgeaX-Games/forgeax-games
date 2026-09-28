import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, resolve } from 'node:path';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const devkitEntrypoints = [
  resolve(repoRoot, 'node_modules/.pnpm/node_modules/@forgeax/engine-devkit/dist/cli.mjs'),
  resolve(repoRoot, 'node_modules/.pnpm/node_modules/@forgeax/engine-devkit/dist/index.mjs'),
];
const voidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

function extractFunction(source: string, signature: string, nextDeclaration: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`missing ${signature}`);
  const end = source.indexOf(nextDeclaration, start);
  if (end < 0) throw new Error(`missing end marker for ${signature}`);
  return source.slice(start, end);
}

function loadHtmlSource(source: string): (title: string, startupScreen?: boolean) => string {
  const escapeSource = extractFunction(source, 'function escapeHtml(', '\nfunction htmlSource(');
  const escapeHtml = new Function(`return (${escapeSource});`)() as (value: unknown) => string;
  const htmlSource = extractFunction(source, 'function htmlSource(', '\nasync function materializeViteDevPort');
  return new Function('escapeHtml', `return (${htmlSource});`)(escapeHtml) as (
    title: string,
    startupScreen?: boolean,
  ) => string;
}

function cssRule(html: string, id: string): string {
  const rule = html.match(new RegExp(`#${id} \\{ ([^}]*) \\}`));
  if (rule === null) throw new Error(`missing #${id} CSS rule`);
  return rule[1]!;
}

type Surface = {
  fatalParent: string | null;
  loadingParent: string | null;
  fatalPosition: string | null;
  fatalDisplay: string | null;
  fatalInset: string | null;
  fatalZIndex: string | null;
};

async function inspectSurface(html: string): Promise<Surface> {
  const parents = new Map<string, string | null>();
  const stack: string[] = [];
  const rewriter = new HTMLRewriter().on('*', {
    element(element) {
      const id = element.getAttribute('id');
      if (id === 'forgeax-fatal' || id === 'forgeax-loading') {
        parents.set(id, stack.at(-1) ?? null);
      }
      if (voidElements.has(element.tagName)) return;
      stack.push(id ?? element.tagName);
      element.onEndTag(() => {
        stack.pop();
      });
    },
  });
  await rewriter.transform(new Response(html)).text();
  const fatal = cssRule(html, 'forgeax-fatal');
  return {
    fatalParent: parents.get('forgeax-fatal') ?? null,
    loadingParent: parents.get('forgeax-loading') ?? null,
    fatalPosition: fatal.match(/(?:^| )position: ([^;]+)/)?.[1] ?? null,
    fatalDisplay: fatal.match(/(?:^| )display: ([^;]+)/)?.[1] ?? null,
    fatalInset: fatal.match(/(?:^| )inset: ([^;]+)/)?.[1] ?? null,
    fatalZIndex: fatal.match(/(?:^| )z-index: ([^;]+)/)?.[1] ?? null,
  };
}

/** Recreate the pre-fix placement from the same generated HTML for a negative control. */
function legacyFatalPlacement(html: string): string {
  const fatalStart = html.indexOf('\n    <div id="forgeax-fatal" role="alert">');
  const fatalEndMarker = '\n    </div>\n    <noscript>';
  const fatalEnd = html.indexOf(fatalEndMarker, fatalStart);
  if (fatalStart < 0 || fatalEnd < 0) throw new Error('generated fatal block is not relocatable');
  const fatalCloseLength = '\n    </div>'.length;
  const fatalBlock = html.slice(fatalStart, fatalEnd + fatalCloseLength);
  const beforeFatal = html.slice(0, fatalStart);
  const shellClose = '\n    </div>';
  if (!beforeFatal.endsWith(shellClose)) throw new Error('generated app-shell close marker changed');
  const afterFatal = html.slice(fatalEnd + fatalCloseLength);
  return `${beforeFatal.slice(0, -shellClose.length)}${fatalBlock}${shellClose}${afterFatal}`;
}

describe('SDK DevKit fatal overlay contract', () => {
  for (const entrypoint of devkitEntrypoints) {
    for (const startupScreen of [true, false]) {
      test(`${basename(entrypoint)} ${startupScreen ? 'startup' : 'non-startup'} template puts fatal on the body viewport above the isolated shell`, async () => {
        const source = await readFile(entrypoint, 'utf8');
        const html = loadHtmlSource(source)('Hellforge <&"', startupScreen);
        const surface = await inspectSurface(html);
        expect(surface).toEqual({
          fatalParent: 'body',
          loadingParent: 'app-shell',
          fatalPosition: 'fixed',
          fatalDisplay: 'none',
          fatalInset: '0',
          fatalZIndex: '2147483647',
        });
        expect(html).toContain('<title>Hellforge &lt;&amp;&quot;</title>');

        // The old app-shell child shape must remain a red negative control even
        // when it retains the corrected viewport CSS.
        const legacySurface = await inspectSurface(legacyFatalPlacement(html));
        expect(legacySurface).toMatchObject({
          fatalParent: 'app-shell',
          loadingParent: 'app-shell',
          fatalPosition: 'fixed',
        });
      });
    }
  }
});
