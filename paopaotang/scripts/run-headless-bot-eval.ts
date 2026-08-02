import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NPC_PROTOCOL_VERSION, type NpcDecision } from '@forgeax/npc-client';
import { HeadlessMatchAdapter } from '../src/headless-match';

const matches = Number(process.argv[2] ?? 100);
const outDir = join(import.meta.dir, '..', 'docs', 'evidence', 'bot-eval-100');
const stats = {
  aggressive: { decisions: 0, bubbles: 0, nearTurns: 0, items: 0, wins: 0 },
  conservative: { decisions: 0, bubbles: 0, nearTurns: 0, items: 0, wins: 0 },
  draws: 0,
};
const replay: Array<{ match: number; tick: number; npcId: string; action?: string; params?: Record<string, string> }> = [];

for (let matchNo = 0; matchNo < matches; matchNo += 1) {
  const match = new HeadlessMatchAdapter(matchNo + 1);
  let seq = 1;
  while (!match.done) {
    const decisions = match.bots.map((bot) => decide(bot.id, match, seq++));
    match.step(decisions);
  }
  const winner = match.winner;
  if (winner === 'aggressive' || winner === 'conservative') stats[winner].wins += 1;
  else stats.draws += 1;
  for (const side of ['aggressive', 'conservative'] as const) {
    const value = match.stats.get(side)!;
    stats[side].decisions += value.decisions;
    stats[side].bubbles += value.bubbles;
    stats[side].nearTurns += value.nearTurns;
    stats[side].items += value.itemCollections;
  }
  replay.push(...match.replay.map((step) => ({
    match: matchNo + 1,
    tick: step.snapshot.t,
    npcId: step.decision.npcId,
    action: step.decision.intent?.action,
    params: step.decision.intent?.params,
  })));
}

const rate = (value: number, total: number) => value / Math.max(1, total);
const differentiation = {
  bubbleRateDelta: rate(stats.aggressive.bubbles, stats.aggressive.decisions) - rate(stats.conservative.bubbles, stats.conservative.decisions),
  nearRateDelta: rate(stats.aggressive.nearTurns, stats.aggressive.decisions) - rate(stats.conservative.nearTurns, stats.conservative.decisions),
  itemRateDelta: rate(stats.conservative.items, stats.conservative.decisions) - rate(stats.aggressive.items, stats.aggressive.decisions),
};
const report = { matches, stats, differentiation, replayEvents: replay.length, meaningful:
  differentiation.bubbleRateDelta > 0 && differentiation.itemRateDelta > 0
    && stats.aggressive.bubbles > stats.conservative.bubbles
    && stats.conservative.items > stats.aggressive.items };
if (!report.meaningful) throw new Error(`real-rule bot differentiation failed: ${JSON.stringify(report)}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(outDir, 'replay.jsonl'), `${replay.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
console.log(JSON.stringify(report, null, 2));

function decide(npcId: string, match: HeadlessMatchAdapter, seq: number): NpcDecision {
  const snapshot = match.snapshot(npcId);
  const self = snapshot.self.pos;
  const opponent = snapshot.nearby.find((item) => item.kind === 'player')!;
  const distance = Math.abs(opponent.pos.x - self.x) + Math.abs(opponent.pos.y - self.y);
  const ownStats = match.stats.get(npcId)!;
  let action = 'wait';
  let params: Record<string, string> | undefined;
  if (npcId === 'aggressive') {
    if (distance <= 3 && ownStats.bubbles === 0) action = 'place_bubble';
    else { action = 'move'; params = { direction: directionToward(self, opponent.pos) }; }
  } else {
    const item = snapshot.nearby.find((entry) => entry.kind === 'item');
    if (item && item.pos.x === self.x && item.pos.y === self.y) { action = 'collect_item'; params = { target: item.id }; }
    else if (distance <= 3) { action = 'move'; params = { direction: directionAway(self, opponent.pos) }; }
    else if (item) { action = 'move'; params = { direction: directionToward(self, item.pos) }; }
    else { action = 'move'; params = { direction: directionAway(self, opponent.pos) }; }
  }
  return { v: NPC_PROTOCOL_VERSION, npcId, seq, intent: { action, ...(params ? { params } : {}), ttlSec: 1 } };
}

function directionToward(a: { x: number; y: number }, b: { x: number; y: number }): string {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x > a.x ? 'right' : 'left') : (b.y > a.y ? 'down' : 'up');
}
function directionAway(a: { x: number; y: number }, b: { x: number; y: number }): string {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x > a.x ? 'left' : 'right') : (b.y > a.y ? 'up' : 'down');
}
