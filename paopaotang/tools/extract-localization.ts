/**
 * Deterministic localization extractor.
 *
 * This tool intentionally uses the TypeScript scanner instead of regular
 * expressions so escaped quotes, template literals, and comments are handled
 * consistently. It emits source-ordered records keyed by path and scanner
 * position; consumers can subsequently rewrite nodes to catalog lookups.
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const rewrite = process.argv.includes('--rewrite');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'main.ts', 'src/chat-input.ts', 'src/hud.ts', 'src/npc-brain.ts',
  'src/npc-dialogue.gen.ts', 'src/npcs/grape/index.ts',
  'src/npcs/guide/index.ts', 'src/npcs/index.ts', 'src/npcs/pudding/index.ts',
  'src/npcs/soda/index.ts', 'src/npcs/strawberry/index.ts', 'src/rig.ts',
  'src/town.ts', 'src/trashtalk.ts', 'tests/guide-role.test.ts',
  'tools/add-gate.mjs', 'tools/build-town.mjs', 'tools/expand-town.mjs',
];

const hasCjk = (value: string) => /[\u3400-\u9fff]/u.test(value);
const hash = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 10);

type RecordItem = {
  key: string;
  file: string;
  position: number;
  value: string;
  parts?: Array<{ text?: string; expression?: string }>;
};

const records: RecordItem[] = [];
for (const file of files) {
  const path = resolve(root, file);
  const source = await readFile(path, 'utf8');
  const kind = file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      const value = node.text;
      if (hasCjk(value)) {
        records.push({ key: `paopaotang.${file}:${node.getStart(sf)}:${hash(value)}`, file, position: node.getStart(sf), value });
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node) && hasCjk(node.text)) {
      records.push({ key: `paopaotang.${file}:${node.getStart(sf)}:${hash(node.text)}`, file, position: node.getStart(sf), value: node.text });
    } else if (ts.isTemplateExpression(node)) {
      const parts: Array<{ text?: string; expression?: string }> = [{ text: node.head.text }];
      for (const span of node.templateSpans) parts.push({ expression: span.expression.getText(sf) }, { text: span.literal.text });
      const value = parts.map((p) => p.text ?? `\${${p.expression}}`).join('');
      if (hasCjk(value)) records.push({ key: `paopaotang.${file}:${node.getStart(sf)}:${hash(value)}`, file, position: node.getStart(sf), value, parts });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

records.sort((a, b) => a.file.localeCompare(b.file) || a.position - b.position);
await writeFile(resolve(root, 'data/localization.json'), `${JSON.stringify({ schemaVersion: 2, records }, null, 2)}\n`);
console.log(`extracted ${records.length} records from ${files.length} files`);

if (rewrite) {
  for (const file of files) {
    const path = resolve(root, file);
    let source = await readFile(path, 'utf8');
    const kind = file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    // Trivia is scanned lexically so comment text can never be mistaken for a string.
    const commentEdits: Array<{ start: number; end: number; text: string }> = [];
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, file.endsWith('.mjs') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, source);
    let token = scanner.scan();
    while (token !== ts.SyntaxKind.EndOfFileToken) {
      if ((token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) && hasCjk(scanner.getTokenText())) {
        const raw = scanner.getTokenText();
        const newlineCount = (raw.match(/\r\n|\r|\n/g) ?? []).length;
        const prefix = token === ts.SyntaxKind.SingleLineCommentTrivia ? '// ' : '/* ';
        const suffix = token === ts.SyntaxKind.SingleLineCommentTrivia ? '' : ' */';
        commentEdits.push({ start: scanner.getTokenPos(), end: scanner.getTextPos(), text: `${prefix} localized comment${'\n'.repeat(newlineCount)}${suffix}` });
      }
      token = scanner.scan();
    }
    for (const edit of commentEdits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    const rewrittenSf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const value = node.text;
        const rec = records.find((item) => item.file === file && item.value === value);
        if (rec && hasCjk(value)) edits.push({ start: node.getStart(rewrittenSf), end: node.getEnd(), text: `get(${JSON.stringify(rec.key)})` });
      }
      ts.forEachChild(node, visit);
    };
    visit(rewrittenSf);
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    if (edits.length) {
      if (file.endsWith('.mjs')) {
        source = `import { readFileSync } from 'node:fs';\nconst get = (key) => JSON.parse(readFileSync(new URL('../data/localization.json', import.meta.url), 'utf8')).records.find((r) => r.key === key)?.value ?? key;\n` + source;
      } else if (file !== 'src/localization.ts') {
        const importPath = file === 'main.ts' ? './src/localization' : file.startsWith('src/npcs/') ? '../../localization' : './localization';
        source = `import { get } from ${JSON.stringify(importPath)};\n` + source;
      }
    }
    await writeFile(path, source);
  }
}
