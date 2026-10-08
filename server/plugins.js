// Administrators install folders before boot. Manifests contain data, never executable code.
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validatePlugin, resolvePlugins } from '../shared/plugins.js';

export const DEFAULT_PLUGINS_DIR = fileURLToPath(new URL('../plugins/', import.meta.url));

export function loadPlugins(dir = process.env.SP_PLUGINS_DIR || DEFAULT_PLUGINS_DIR, log = console) {
  const root = resolve(dir);
  if (!lstatExists(root)) return Object.freeze([]);
  const catalog = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    try {
      const file = join(root, entry.name, 'plugin.json');
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 32768) throw new Error('manifest must be a regular file up to 32 KiB');
      const source = readFileSync(file, 'utf8');
      const plugin = validatePlugin(JSON.parse(source));
      if (plugin.id !== entry.name) throw new Error('plugin id must match folder name');
      if (catalog.length >= 64) throw new Error('at most 64 installed plugins');
      catalog.push(Object.freeze({ ...plugin, digest: createHash('sha256').update(source).digest('hex') }));
    } catch (e) { log.warn('[plugins] ' + entry.name + ': ' + e.message); }
  }
  return Object.freeze(catalog);
}
function lstatExists(path) {
  try { return lstatSync(path).isDirectory(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

/** A per-match overlay; all other official data remains shared. */
export function pluginData(data, selection, modeId) {
  if (!selection.plugins.some(p => Object.hasOwn(p.rules, 'bossAliveFull'))) return data;
  const config = data.config || {};
  const mode = config.modes?.[modeId] || {};
  const override = { aliveFull: selection.rules.bossAliveFull };
  return { ...data, config: { ...config,
    bossHpScale: { ...config.bossHpScale, ...override },
    modes: { ...config.modes, [modeId]: { ...mode, bossHpScale: { ...mode.bossHpScale, ...override } } },
  } };
}
export { resolvePlugins };
