
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startRealServer, sleep } from './client.mjs';

// Explicit browser suite (not part of default node --test discovery).
// CHROME_PATH=/path/to/chrome EIGHT_SCENARIO=normal|boss|hidden node test/e2e/eight-players.e2e.mjs
// EIGHT_BASE=http://127.0.0.1:port supports an SSH-forwarded fastServer running the matching scenario.
if (!process.env.NODE_TEST_CONTEXT || process.env.EIGHT_E2E === '1') {
const out = 'test/e2e/out/eight-players';
mkdirSync(out, { recursive: true });
const scenario = process.env.EIGHT_SCENARIO || 'normal';
const count = Number(process.env.EIGHT_COUNT || 8);
const srv = process.env.EIGHT_BASE ? { base: process.env.EIGHT_BASE, logs: [], stop: async () => {} } : await startRealServer({ fast: { timerScale: .03, combatSpeed: 8, startRound: scenario === 'normal' ? 1 : scenario, kit: 4, autoPlace: true } });
const browser = await puppeteer.launch({
 executablePath: process.env.CHROME_PATH, headless: true,
 args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio'],
 protocolTimeout: 90000
});
const pages = [], contexts = [], errors = [], starts = Array.from({ length: count }, () => []);
async function clickText(page, selector, text) {
 const handles = await page.$$(selector);
 for (const h of handles) {
   if ((await h.evaluate(e => e.textContent)).includes(text)) { await h.click(); return; }
 }
 throw new Error('button missing: ' + selector + ' / ' + text);
}
async function state(p) { return p.evaluate(() => { const s = globalThis.__SP__.store.get(); return { room: s.room, pub: s.match.public, result: !!s.match.result, me: s.me.playerId, runner: globalThis.__SP_RUNNER__?.state() }; }); }
try {
 let code;
 for (let i = 0; i < count; i++) {
   const context = await browser.createBrowserContext(); contexts.push(context);
   const p = await context.newPage(); pages.push(p);
   await p.setViewport({ width: 1280, height: 720 });
   p.on('pageerror', e => errors.push('P' + (i + 1) + ': ' + e.message));
   const cdp = await p.createCDPSession(); await cdp.send('Network.enable');
   cdp.on('Network.webSocketFrameReceived', ({ response }) => {
     try { const m = JSON.parse(response.payloadData); if (m.t === 'b.start') starts[i].push(m); } catch {}
   });
   await p.goto(srv.base + (code ? '/?room=' + code : '/'), { waitUntil: 'networkidle0' });
   await p.waitForSelector('.title-login input');
   await p.type('.title-login input', 'EightP' + (i + 1));
   await clickText(p, '.title-login button', '开始');
   if (i === 0) {
     await p.waitForSelector('.lobby-screen');
     await clickText(p, '.mode-card', '同盟模拟');
     await clickText(p, '.diff-card', '险境模拟');
     await clickText(p, '.create-box button', '创建同盟');
   }
   await p.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
   code = (await state(p)).room.code;
   if (i) await clickText(p, '.room-bar__right button', '准备就绪');
 }
 const host = pages[0];
 assert.equal((await state(host)).room.seats.filter(Boolean).length, count);
 if (count === 8) {
   for (const [width, height, label] of [[1920,1080,'desktop'],[740,390,'phone-landscape'],[390,844,'narrow']]) {
     await host.setViewport({ width, height }); await sleep(250);
     await host.screenshot({ path: out + '/room-' + label + '.png' });
     const layout = await host.evaluate(() => {
       const seats = document.querySelector('.seats');
       const last = seats.lastElementChild;
       last.scrollIntoView({ block: 'nearest' });
       const r = last.getBoundingClientRect();
       const b = document.querySelector('.room-bar__right button').getBoundingClientRect();
       return { seats: seats.children.length, lastVisible: r.bottom <= innerHeight && r.right <= innerWidth, actionVisible: b.bottom <= innerHeight && b.right <= innerWidth, columns: getComputedStyle(seats).gridTemplateColumns };
     });
     console.log(label, layout);
     assert.equal(layout.seats, 8);
     assert.ok(layout.lastVisible && layout.actionVisible, label + ' clipped controls');
   }
   await host.setViewport({ width: 1280, height: 720 });
 }
 await clickText(host, '.room-bar__right button', '开始模拟');
 let disconnected = false, finished = false, lastStatus = 0, teamChecked = false;
 const deadline = Date.now() + 360000;
 while (Date.now() < deadline) {
   const states = await Promise.all(pages.map(state));
   if (Date.now() - lastStatus > 10000) {
     console.log('progress', states.map(s => [s.pub?.phase, s.pub?.round, s.result, s.runner?.kind]));
     lastStatus = Date.now();
   }
   if (!teamChecked && await host.$('.team')) {
     const rows = await host.$$eval('.team__row', es => es.length);
     assert.equal(rows, count);
     await host.screenshot({ path: out + '/' + scenario + '-' + count + '-team.png' });
     teamChecked = true;
   }
   if (scenario === 'normal' && !disconnected) {
     const last = states.at(-1).runner;
     if (last?.authoritative && !last.done && last.kind === 'normal') {
       await pages.at(-1).evaluate(() => globalThis.__SP__.net.reconnectNow());
       disconnected = true;
     }
   }
   if (scenario === 'normal' ? states.every(s => s.pub?.round >= 2) : states.every(s => s.result)) { finished = true; break; }
   await sleep(300);
 }
 writeFileSync(out + '/' + scenario + '-' + count + '-server.log', srv.logs.join('\n'));
 assert.ok(finished, 'all clients must advance or settle');
 const kind = scenario === 'normal' ? 'normal' : scenario;
 const fields = new Set(starts.flat().filter(m => m.authoritative && m.spec?.kind === kind).map(m => m.fieldId));
 assert.equal(fields.size, scenario === 'normal' ? count : Math.ceil(count / 2));
 if (scenario === 'normal') {
   assert.ok(disconnected, 'disconnect exercised');
   assert.ok(starts.at(-1).some(m => m.spec?.kind === 'normal' && !m.authoritative), 'reconnected client receives takeover replica');
   if (!process.env.EIGHT_BASE) assert.ok(srv.logs.some(l => l.includes('server takeover from') && l.includes('(disconnect)')), 'server took over disconnected field');
   for (let i = 0; i < count; i++) assert.ok(starts[i].some(m => m.authoritative && m.spec?.kind === 'normal'), 'P' + (i + 1) + ' authoritative combat');
 }
 assert.deepEqual(errors, []);
 console.log('PASS', scenario, count, 'players;', fields.size, 'fields; takeover=', disconnected);
 await pages[0].screenshot({ path: out + '/' + scenario + '-' + count + '-finished.png' });
} finally {
 for (const context of contexts) await context.close().catch(() => {});
 await browser.close(); await srv.stop();
}

}
