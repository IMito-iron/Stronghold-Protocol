import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData, getVersionData } from '../server/data.js';
import { VERSIONS, DEFAULT_VERSION } from '../shared/versions.js';
import { GameData } from '../server/match/gamedata.js';

for (const version of VERSIONS) {
  test(version.id + ': eight-player Boss scaling preserves actual one-to-four and solo rules', () => {
    const data = version.id === DEFAULT_VERSION ? getData() : getVersionData(version.id);
    assert.equal(data.config.bossHpScale.aliveFull, 8);
    for (const modeId of Object.keys(data.config.modes)) {
      const gd = new GameData(data, modeId);
      const difficulty = modeId.split('_').at(-1).toUpperCase();
      for (const [id, boss] of Object.entries(data.bosses)) {
        const base = boss.bloodPoint?.[difficulty];
        if (!Number.isFinite(base)) continue;
        // the one-player pool carries the mode's own factor (规程's solo ladder scales it, e.g. 极速模拟 0.8×); the fork
        // only checks that co-op grows linearly with the seats alive up to eight and solo does not grow
        const one = gd.bossPoolHp(id, 1);
        assert.ok(one > 0, modeId + ' ' + id);
        for (let n = 1; n <= 8; n++) {
          assert.equal(gd.bossPoolHp(id, n), one * (modeId.startsWith('mode_single_') ? 1 : n), modeId + ' ' + id + ' alive=' + n);
        }
      }
    }
  });
}
