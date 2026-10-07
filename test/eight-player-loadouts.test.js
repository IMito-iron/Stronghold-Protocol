
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { readFileSync } from 'node:fs';
import { setLang, setMessages, t } from '../shared/i18n.js';
import { MAX_SEATS } from '../shared/constants.js';

test('seats five through eight retain DIY, ownership and loadouts into a real match', async () => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, heavyBurst: 30, heavyPerSec: 10 });
  const clients = [];
  const ok = async (c, m) => { const v = await c.request(m); assert.equal(v.t, 'ok', JSON.stringify(v)); };
  try {
    let code;
    for (let i = 0; i < 8; i++) {
      const c = await TestClient.connect('ws://127.0.0.1:' + srv.port + '/ws'); clients.push(c);
      const welcome = await c.hello('Loadout' + i); c.id = welcome.playerId;
      if (!i) {
        await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
        code = (await c.waitFor('room.state')).code;
      } else await ok(c, { t: 'room.join', code });
      if (i >= 4) {
        await ok(c, { t: 'room.diy', picks: { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } } });
        await ok(c, { t: 'room.ownership', notOwned: ['chess_char_4_22_a'] });
        await ok(c, { t: 'room.loadout', entries: { chess_char_5_11_a: { skill: 1, module: 'none' } } });
      }
      if (i) await ok(c, { t: 'room.ready', ready: true });
    }
    const seats = srv.lobby.getRoom(code).seats;
    for (const s of seats.slice(4)) {
      assert.equal(s.diy.chess_char_5_diy1_a.charId, 'char_112_siege');
      assert.deepEqual(s.notOwned, ['chess_char_4_22_a']);
      assert.equal(s.loadout.chess_char_5_11_a.skill, 1);
    }
    await ok(clients[0], { t: 'room.start' });
    for (const c of clients.slice(4)) {
      const priv = await c.waitFor('m.private');
      assert.equal(priv.diy.chess_char_5_diy1_a.charId, 'char_112_siege');
      const ps = srv.lobby.getRoom(code).match.players.get(c.id);
      assert.deepEqual(ps.standIns, ['chess_char_4_22_a']);
      assert.equal(ps.loadout.chess_char_5_11_a.skill, 1);
    }
  } finally {
    await Promise.all(clients.map(c => c.terminate()));
    await srv.close();
  }
});

test('every bundled language interpolates the eight-player room capacity', () => {
  try {
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      setMessages(lang, JSON.parse(readFileSync(new URL('../public/i18n/' + lang + '.json', import.meta.url), 'utf8')));
      setLang(lang);
      const label = t('1–{n} 名博士 · 可由 AI 队友补位', { n: MAX_SEATS });
      assert.ok(label.includes('8'), lang + ': ' + label);
      assert.ok(!label.includes('{n}'), lang + ': unresolved placeholder');
    }
  } finally { setLang('zh'); }
});
