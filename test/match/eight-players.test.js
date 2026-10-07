
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../../server/sim/spec.js';
import { isBattleResult, validateC2S } from '../../shared/protocol.js';
import { MAX_SEATS } from '../../shared/constants.js';
import { makeMatch } from './harness.js';
import { planUnite } from '../../server/match/unite.js';

test('eight-player results and progress survive compaction and validation; nine rejected', () => {
  const perPlayer = Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['p_' + i, { total: 1, killed: 1, perfect: true, damageDealt: i + 1 }]));
  const result = compactResult({ reason: 'cleared', time: 1, perPlayer });
  assert.equal(Object.keys(result.perPlayer).length, 8);
  assert.equal(result.perPlayer.p_7.damageDealt, 8);
  assert.equal(isBattleResult(result), true);
  const by = Object.fromEntries(Object.keys(perPlayer).map(k => [k, 1]));
  assert.equal(validateC2S({ t: 'b.progress', battleId: 'b1', gt: 1, killed: 0, total: 8, done: false, by, left: by, leaks: 0, bossDmg: 8 }), null);
  result.perPlayer.p_8 = result.perPlayer.p_7;
  assert.equal(isBattleResult(result), false);
  assert.equal(validateC2S({ t: 'room.removeBot', seat: 7 }), null);
  assert.notEqual(validateC2S({ t: 'room.removeBot', seat: 8 }), null);
});

for (const n of [1, 4, 5, 7, 8]) {
  test(n + ' humans complete normal client combat and settle all seats', () => {
    const h = makeMatch({ humans: n, fake: true, clientCombat: true }).start();
    try {
      h.toPrep(2);
      assert.equal(h.m.players.size, n);
      assert.equal(h.m.errorCount, 0);
      for (let i = 0; i < n; i++) assert.ok(h.sent.some(([id, msg]) => id === 'p_' + i && msg.t === 'b.start' && msg.authoritative));
      h.invariants();
    } finally { h.m.dispose(); }
  });
}
test('unite includes all seven leakers and preserves their owner ids', () => {
  const h = makeMatch({ humans: MAX_SEATS, fake: true }).start();
  try {
    h.toPrep(1);
    const results = new Map(h.m.order.map((p, i) => [p.playerId, {
      perfect: i === 0, leaked: i === 0 ? [] : [{ enemyKey: Object.keys(h.m.data.enemies)[0], lpr: 1, counted: true }],
      unitsEnd: [], layerGains: {}
    }]));
    const plan = planUnite(h.m, results);
    assert.ok(plan);
    assert.equal(plan.leakers.length, 7);
    assert.deepEqual(new Set(plan.leaked.map(l => l.sourcePlayerId)), new Set(h.m.order.slice(1).map(p => p.playerId)));
  } finally { h.m.dispose(); }
});

import { runFull } from './fullmatchRun.js';
for (const n of [5, 7, 8]) {
  test(n + ' humans complete a seeded real simulation with invariant checks', () => {
    runFull({ mode: 'coop', difficulty: 'NORMAL', humans: n, bots: 0, seed: 8800 + n });
  });
}
