import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins, pluginData, resolvePlugins } from '../server/plugins.js';
import { validatePlugin } from '../shared/plugins.js';
import { validateC2S } from '../shared/protocol.js';
import { GameData } from '../server/match/gamedata.js';
import { DATA } from './match/harness.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const catalog = loadPlugins();
const manifest = { id: 'six-players', apiVersion: 1, version: '1.0.0', name: 'Six players', modes: ['coop'], rules: { maxPlayers: 6, bossAliveFull: 6 } };
const ok = async (c, msg) => { const reply = await c.request(msg); assert.equal(reply.t, 'ok', JSON.stringify(reply)); };

test('manifest API rejects unsupported versions, code, invalid capacities and unknown rules', () => {
  assert.equal(validatePlugin(manifest).rules.maxPlayers, 6);
  for (const p of [
    { ...manifest, apiVersion: 2 }, { ...manifest, entry: './index.js' },
    { ...manifest, rules: { maxPlayers: 9 } }, { ...manifest, rules: { money: 99 } },
    { ...manifest, modes: ['other'] }, { ...manifest, id: '../x' },
  ]) assert.throws(() => validatePlugin(p));
  assert.throws(() => resolvePlugins(catalog, ['unknown']));
  assert.throws(() => resolvePlugins(catalog, ['eight-players', 'eight-players']));
  assert.throws(() => resolvePlugins(catalog, ['eight-players'], 'solo'));
  assert.throws(() => resolvePlugins([...catalog, validatePlugin(manifest)], ['eight-players', 'six-players']));
  assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', plugins: ['eight-players'] }), null);
  assert.notEqual(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', plugins: ['../bad'] }), null);
});

test('third-party folder installation, invalid manifests and immutable boot snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-plugins-'));
  const warnings = [];
  const save = (id, p) => { mkdirSync(join(dir, id)); writeFileSync(join(dir, id, 'plugin.json'), JSON.stringify(p)); };
  try {
    save(manifest.id, manifest);
    save('bad-api', { ...manifest, id: 'bad-api', apiVersion: 2 });
    save('bad-folder', manifest);
    const loaded = loadPlugins(dir, { warn: s => warnings.push(s) });
    assert.equal(loaded.length, 1); assert.equal(warnings.length, 2);
    assert.match(loaded[0].digest, /^[a-f0-9]{64}$/);
    assert.equal(resolvePlugins(loaded, [manifest.id]).rules.maxPlayers, 6);
    writeFileSync(join(dir, manifest.id, 'plugin.json'), '{}');
    assert.equal(resolvePlugins(loaded, [manifest.id]).rules.maxPlayers, 6);
    assert.throws(() => { loaded[0].rules.maxPlayers = 8; });
    assert.equal(loadPlugins(join(dir, 'absent')).length, 0);
    // Directory links are never discovered as installed plugins, on every platform.
    try { symlinkSync(join(dir, manifest.id), join(dir, 'linked'), 'junction'); } catch { /* OS may disallow links. */ }
    assert.equal(loadPlugins(dir, { warn() {} }).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('room-specific Boss rules preserve official data, solo and actual one-to-four scaling', () => {
  const normal = resolvePlugins(catalog);
  const eight = resolvePlugins(catalog, ['eight-players']);
  assert.equal(normal.rules.maxPlayers, 4);
  assert.equal(pluginData(DATA, normal, 'mode_multi_normal'), DATA);
  const changed = pluginData(DATA, eight, 'mode_multi_normal');
  assert.equal(DATA.config.bossHpScale.aliveFull, 4);
  const base = new GameData(DATA, 'mode_multi_normal');
  const mod = new GameData(changed, 'mode_multi_normal');
  for (let n = 1; n <= 8; n++) {
    const hp = DATA.bosses.boss_8.bloodPoint.NORMAL;
    assert.equal(mod.bossPoolHp('boss_8', n), hp * n);
    assert.equal(base.bossPoolHp('boss_8', n), hp * Math.min(4, n));
  }
  assert.equal(new GameData(changed, 'mode_single_normal').bossPoolHp('boss_8', 8), base.boss('boss_8').bloodPoint.NORMAL);
});

test('simultaneous four/eight rooms: capacity, spectators, high-seat reconnect/kick, AI and isolated match data', async () => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, heavyBurst: 100, heavyPerSec: 100 });
  const clients = [];
  const connect = async (name, token) => {
    const c = await TestClient.connect('ws://127.0.0.1:' + srv.port + '/ws'); clients.push(c);
    c.welcome = await c.hello(name, token); return c;
  };
  try {
    const host4 = await connect('Four');
    assert.equal(host4.welcome.plugins[0].id, 'eight-players');
    await ok(host4, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const four = await host4.waitFor('room.state');
    assert.equal(four.seats.length, 4); assert.deepEqual(four.plugins, []);
    const host8 = await connect('Eight');
    await ok(host8, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', plugins: ['eight-players'] });
    const eight = await host8.waitFor('room.state');
    assert.equal(eight.rules.maxPlayers, 8); assert.equal(eight.plugins[0].version, '1.0.0');
    // A rejected create must not remove the host from its existing room.
    assert.equal((await host8.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', plugins: ['eight-players'] })).t, 'error');
    assert.equal(srv.lobby.getRoom(eight.code).hostId, host8.welcome.playerId);
    for (let i = 0; i < 3; i++) await ok(host4, { t: 'room.addBot' });
    assert.equal((await host4.request({ t: 'room.addBot' })).t, 'error');
    for (let i = 0; i < 6; i++) await ok(host8, { t: 'room.addBot' });
    const p8 = await connect('Last');
    await ok(p8, { t: 'room.join', code: eight.code });
    const extra = await connect('Extra');
    assert.equal((await extra.request({ t: 'room.join', code: eight.code })).t, 'error');
    await ok(extra, { t: 'room.spectate', code: eight.code });
    const spec2 = await connect('Spec2'); await ok(spec2, { t: 'room.spectate', code: eight.code });
    const spec3 = await connect('Spec3'); assert.equal((await spec3.request({ t: 'room.spectate', code: eight.code })).t, 'error');
    await p8.terminate();
    const again = await connect('Last', p8.welcome.token);
    const restored = await again.waitFor('room.state');
    assert.equal(restored.seats[7].playerId, p8.welcome.playerId);
    assert.equal(restored.rules.maxPlayers, 8);
    await ok(host8, { t: 'room.kick', seat: 7, playerId: p8.welcome.playerId });
    await ok(host8, { t: 'room.addBot' });
    await ok(host8, { t: 'room.removeBot', seat: 7 });
    await ok(host8, { t: 'room.addBot' });
    await ok(host4, { t: 'room.start' }); await ok(host8, { t: 'room.start' });
    const m4 = srv.lobby.getRoom(four.code).match;
    const m8 = srv.lobby.getRoom(eight.code).match;
    assert.equal(m4.players.size, 4); assert.equal(m8.players.size, 8);
    assert.equal(m4.gd.config.bossHpScale.aliveFull, 4);
    assert.equal(m8.gd.config.bossHpScale.aliveFull, 8);
    assert.equal((await host8.request({ t: 'room.setPlugins', plugins: [] })).t, 'error');
  } finally { await Promise.all(clients.map(c => c.terminate())); await srv.close(); }
});

test('a custom installation directory is advertised and applied by the real server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-third-party-'));
  mkdirSync(join(dir, manifest.id));
  writeFileSync(join(dir, manifest.id, 'plugin.json'), JSON.stringify(manifest));
  const srv = await startServer({ host: '127.0.0.1', port: 0, pluginsDir: dir, quiet: true });
  let c;
  try {
    c = await TestClient.connect('ws://127.0.0.1:' + srv.port + '/ws');
    const welcome = await c.hello('ThirdParty');
    assert.deepEqual(welcome.plugins.map(p => p.id), ['six-players']);
    await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', plugins: ['six-players'] });
    const room = await c.waitFor('room.state');
    assert.equal(room.seats.length, 6);
    assert.equal(room.rules.bossAliveFull, 6);
    await ok(c, { t: 'room.start' });
    assert.equal(srv.lobby.getRoom(room.code).match.gd.config.bossHpScale.aliveFull, 6);
  } finally {
    if (c) await c.terminate();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
