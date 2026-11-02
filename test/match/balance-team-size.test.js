// test/match/balance-team-size.test.js — the fork's balance above four seats (2026-11-03, 0.3.3-8p.2): the shared chess
// and item stock and the 机变 draft scale with the seats above four, so eight players keep the per-player stock of a
// four-seat game and every seat gets a draft card. Four seats (and solo) keep the official numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { generateDraft, draftCardCount } from '../../server/match/choices.js';
import { GameData } from '../../server/match/gamedata.js';
import { createRng } from '../../server/sim/rng.js';
import { normalizeSp } from '../../public/js/ui/gameLogic/draft.js';

function baseCopies(gd, id) {
  const tier = gd.tierOf(id);
  const ov = gd.economy.poolCopiesOverrides;
  return ov && Number.isInteger(ov[id]) ? ov[id] : gd.economy.poolCopies[tier];
}

function aTier1(m) {
  const id = m.gd.visibleChess.find((x) => m.gd.tierOf(x) === 1 && !m.bannedChess.includes(x));
  assert.ok(id, 'a tier-1 chess in the pool');
  return id;
}

test('four seats keep the official shared stock (co-op ×2) and the six-card draft', () => {
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 3 });
  const m = h.m;
  try {
    const id = aTier1(m);
    assert.equal(m.gd.teamScale(), 1);
    assert.equal(m.gd.poolCopies(id), baseCopies(m.gd, id) * 2);
    assert.equal(m.pool.cap(id), baseCopies(m.gd, id) * 2);
    const itemId = m.gd.shopItemsByTier[1][0];
    assert.equal(m.gd.itemPoolCopies(itemId), m.gd.economy.itemPoolCopies[1]);
    m.enterSpDraft();
    assert.equal(m.phase, 'SP_DRAFT');
    assert.equal(m.sp.cards.length, 6);
  } finally { m.dispose(); }
});

test('eight seats scale the chess stock ×4 and the item stock ×2 (per-player parity with four seats)', () => {
  const h = makeMatch({ mode: 'coop', humans: 8, seed: 3 });
  const m = h.m;
  try {
    const id = aTier1(m);
    assert.equal(m.gd.teamScale(), 2);
    assert.equal(m.gd.poolCopies(id), baseCopies(m.gd, id) * 4);
    assert.equal(m.pool.cap(id), baseCopies(m.gd, id) * 4);
    const itemId = m.gd.shopItemsByTier[1][0];
    assert.equal(m.gd.itemPoolCopies(itemId), Math.round(m.gd.economy.itemPoolCopies[1] * 2));
  } finally { m.dispose(); }
});

test('the draft card count follows the seats above four', () => {
  const h = makeMatch({ mode: 'coop', humans: 8, seed: 3 });
  const gd = h.m.gd;
  try {
    assert.equal(draftCardCount(gd, 6, 4), 6, 'four seats: six');
    assert.equal(draftCardCount(gd, 6, 0), 6, 'no count given: six');
    assert.equal(draftCardCount(gd, 6, 5), 8);
    assert.equal(draftCardCount(gd, 6, 6), 9);
    assert.equal(draftCardCount(gd, 6, 7), 11);
    assert.equal(draftCardCount(gd, 6, 8), 12);
  } finally { h.m.dispose(); }
});

test('eight seats: the 机变 draft offers twelve cards and every seat picks one', () => {
  const h = makeMatch({ mode: 'coop', humans: 8, seed: 3 });
  const m = h.m;
  try {
    m.enterSpDraft();
    assert.equal(m.phase, 'SP_DRAFT');
    assert.equal(m.sp.cards.length, 12);
    assert.equal(m.sp.order.length, 8);
    const picked = new Set();
    for (let guard = 0; guard < 100; guard++) {
      // after the last pick the finish is scheduled (a deferred step), not run: the turn is already null
      const pid = m.spTurn();
      if (!pid) break;
      const ps = m.players.get(pid);
      const card = m.sp.cards.find((c) => m.spCardAvailable(c));
      assert.ok(card, 'a card is still available for seat ' + pid);
      assert.deepEqual(m.pickCard(ps, card.idx), { ok: true });
      picked.add(pid);
    }
    assert.equal(picked.size, 8, 'all eight seats picked');
    assert.ok(m.sp.idx >= m.sp.order.length, 'the draft moved past every seat');
  } finally { m.dispose(); }
});

test('a short official bounty list repeats for the seats above four (two cards, two picks)', () => {
  const modeId = 'mode_multi_normal';
  const sch = DATA.choices.schedule[modeId];
  const short = DATA.choices.cards.bounty.filter((c) => c.draft === true && c.draftPool === 'initial').slice(0, 3);
  assert.equal(short.length, 3, 'three initial-draft bounties in the data');
  const data = {
    ...DATA,
    choices: {
      ...DATA.choices,
      cards: { ...DATA.choices.cards, bounty: short },
      schedule: { ...DATA.choices.schedule, [modeId]: { ...sch, rounds: { ...sch.rounds, '3': { ...sch.rounds['3'], families: [{ family: 'bounty', weight: 1 }] } } } },
    },
  };
  const d8 = generateDraft(new GameData(data, modeId), createRng(9), 3, { players: 8 });
  assert.equal(d8.family, 'bounty');
  assert.equal(d8.cards.length, 12);
  assert.ok(d8.cards.every((c) => c.kind === 'bounty'));
  assert.equal(new Set(d8.cards.map((c) => c.idx)).size, 12, 'each card has its own idx');
  assert.ok(d8.cards.some((c) => d8.cards.filter((x) => x.id === c.id).length > 1), 'a repeated bounty card');
  const d4 = generateDraft(new GameData(data, modeId), createRng(9), 3, { players: 4 });
  assert.equal(d4.cards.length, 3, 'a short fixture list stays short at four seats (no repetition)');
  assert.equal(new Set(d4.cards.map((c) => c.id)).size, 3);
});

test('the client renders a scaled draft (twelve cards, not the old six-card cut)', () => {
  const sp = {
    family: 'bounty',
    cards: Array.from({ length: 12 }, (_, i) => ({ kind: 'bounty', id: 'b' + i, name: 'B' + i, desc: '' })),
    order: ['p0'], picks: {}, taken: {},
  };
  const n = normalizeSp(sp, [{ playerId: 'p0' }]);
  assert.equal(n.cards.length, 12);
  assert.deepEqual(n.cards.map((c) => c.idx), Array.from({ length: 12 }, (_, i) => i));
});
