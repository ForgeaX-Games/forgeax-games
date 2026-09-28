#!/usr/bin/env node

import { auditWebDist, DEFAULT_BASE } from './lib/web-dist-contract.mjs';

function parseArgs(argv) {
  const options = { dist: 'dist', base: DEFAULT_BASE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist' || arg === '--base') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      throw new Error('usage: node scripts/audit-web-dist.mjs [--dist dist] [--base /games/hellforge/]');
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

let report;
try {
  report = auditWebDist(parseArgs(process.argv.slice(2)));
} catch (error) {
  report = {
    ok: false,
    failures: [{ code: 'audit-error', path: '.', message: error instanceof Error ? error.message : String(error) }],
  };
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
