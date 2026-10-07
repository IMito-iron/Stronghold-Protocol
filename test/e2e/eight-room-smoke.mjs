
import assert from 'node:assert/strict';
import { TestClient } from '../helpers/wsClient.js';

// Explicit smoke test: SP_SMOKE_URL=http://host:port node test/e2e/eight-room-smoke.mjs
if (!process.env.NODE_TEST_CONTEXT && process.env.SP_SMOKE_URL) {
 const base = process.env.SP_SMOKE_URL;
 const clients = [];
 const ok = async (c, m) => { const result = await c.request(m); assert.equal(result.t, 'ok', JSON.stringify(result)); };
 try {
   const health = await (await fetch(base + '/healthz')).json();
   assert.equal(health.app, '0.2.1-8p.1');
   for (const path of ['/', '/shared/constants.js', '/js/screens/room.js', '/css/screens/room.css', '/fonts/fonts.css', '/vendor/preact.module.js']) {
     const res = await fetch(base + path); assert.equal(res.status, 200, path);
   }
   for (let i = 0; i < 11; i++) {
     const c = await TestClient.connect(base.replace(/^http/, 'ws') + '/ws');
     clients.push(c); const w = await c.hello('Smoke' + i); c.id = w.playerId;
   }
   await ok(clients[0], { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
   const { code } = await clients[0].waitFor('room.state');
   for (let i = 1; i < 8; i++) await ok(clients[i], { t: 'room.join', code });
   assert.equal((await clients[8].request({ t: 'room.join', code })).code, 'ROOM_FULL');
   for (const c of clients.slice(8, 10)) await ok(c, { t: 'room.spectate', code });
   assert.equal((await clients[10].request({ t: 'room.spectate', code })).code, 'ROOM_FULL');
   for (const c of clients.slice(1, 8)) await ok(c, { t: 'room.ready', ready: true });
   await ok(clients[0], { t: 'room.start' });
   for (const c of clients.slice(0, 8)) {
     const pub = await c.waitFor('m.public');
     assert.equal(pub.players.length, 8);
   }
   console.log('PASS deployed health/static/WebSocket: eight players start, ninth rejected, two spectators');
 } finally {
   for (const c of clients) { if (c.isOpen) await c.request({ t: 'room.leave' }).catch(() => {}); await c.terminate(); }
 }
}
