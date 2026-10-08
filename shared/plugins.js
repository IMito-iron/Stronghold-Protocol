// Plugin API v1: declarative room rules shared by server validation and browser previews.
import { MAX_SEATS, SUPPORTED_SEATS } from './constants.js';

export const PLUGIN_API_VERSION = 1;
export const RULE_KEYS = Object.freeze(['maxPlayers', 'bossAliveFull']);

export function validatePlugin(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid plugin manifest');
  const keys = ['id', 'apiVersion', 'version', 'name', 'description', 'author', 'license', 'modes', 'rules'];
  if (Object.keys(p).some(k => !keys.includes(k))) throw new Error('unknown manifest field');
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.id)) throw new Error('invalid plugin id');
  if (p.apiVersion !== PLUGIN_API_VERSION) throw new Error('unsupported plugin API');
  if (typeof p.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(p.version)) throw new Error('invalid plugin version');
  for (const k of ['name', 'description', 'author', 'license']) {
    if (p[k] !== undefined && (typeof p[k] !== 'string' || !p[k].trim() || p[k].length > 256)) throw new Error('invalid ' + k);
  }
  if (!p.name) throw new Error('missing plugin name');
  if (!Array.isArray(p.modes) || !p.modes.length || p.modes.some(m => !['solo', 'coop'].includes(m)) || new Set(p.modes).size !== p.modes.length) throw new Error('invalid modes');
  if (!p.rules || typeof p.rules !== 'object' || Array.isArray(p.rules) || !Object.keys(p.rules).length) throw new Error('missing rules');
  for (const [k, v] of Object.entries(p.rules)) {
    if (!RULE_KEYS.includes(k) || !Number.isInteger(v) || v < 1 || v > SUPPORTED_SEATS) throw new Error('unsupported rule: ' + k);
  }
  return Object.freeze({ ...p, modes: Object.freeze([...p.modes]), rules: Object.freeze({ ...p.rules }) });
}

export function resolvePlugins(catalog, ids = [], mode = 'coop') {
  if (!Array.isArray(ids) || ids.length > 16 || new Set(ids).size !== ids.length) throw new Error('invalid plugin selection');
  const selected = ids.map(id => {
    const p = catalog.find(p => p.id === id);
    if (!p) throw new Error('plugin unavailable: ' + id);
    if (!p.modes.includes(mode)) throw new Error('plugin incompatible with room mode: ' + id);
    return p;
  }).sort((a, b) => a.id.localeCompare(b.id));
  const rules = { maxPlayers: mode === 'solo' ? 1 : MAX_SEATS, bossAliveFull: MAX_SEATS };
  const owners = new Set();
  for (const p of selected) for (const [k, v] of Object.entries(p.rules)) {
    if (owners.has(k)) throw new Error('conflicting plugin rule: ' + k);
    owners.add(k);
    rules[k] = v;
  }
  if (mode === 'solo' && rules.maxPlayers !== 1) throw new Error('solo capacity must remain one');
  return Object.freeze({ plugins: Object.freeze(selected), rules: Object.freeze(rules) });
}
