
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_SEATS } from '../shared/constants.js';

test('offline capacity generation changes only aliveFull and preserves explicit output selection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-player-limit-'));
  try {
    const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
    config.bossHpScale.aliveFull = 4;
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/build-data.mjs', import.meta.url)),
      '--offline', '--sync-player-limit', '--out', dir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const generated = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    assert.equal(generated.bossHpScale.aliveFull, MAX_SEATS);
    generated.bossHpScale.aliveFull = 4;
    assert.deepEqual(generated, config);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
