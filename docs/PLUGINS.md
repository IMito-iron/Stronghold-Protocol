# Room plugins — API v1

This fork supports administrator-installed, declarative gameplay plugins. Players choose installed plugins when creating a room; joining players automatically receive the same rules. No browser extension or client installation is required.

## Install and remove

Copy a folder containing plugin.json into plugins/<id>/ and restart the server. SP_PLUGINS_DIR selects an alternative directory (it replaces the default directory). In Docker, mount a directory read-only at /app/plugins, or set SP_PLUGINS_DIR to a mounted directory. Copy the bundled eight-players folder into that directory if you want it available.

Installation makes a plugin available; it does not enable it globally. No selection means upstream four-player co-op. Existing production deployments are not automatically upgraded by a branch checkout.

Remove a folder and restart to uninstall. There is no hot reload: the catalog is validated and frozen at boot. Malformed, incompatible and symlinked manifests are excluded with a server warning. At most 64 plugins are loaded; each manifest is at most 32 KiB. Missing directories yield an empty catalog.

## Author a plugin

Create plugins/six-players/plugin.json, for example:

```json
{
  "id": "six-players",
  "apiVersion": 1,
  "version": "1.0.0",
  "name": "Six-player co-op",
  "description": "Six players with proportional Boss HP.",
  "author": "Your name",
  "license": "GPL-3.0-or-later",
  "modes": ["coop"],
  "rules": { "maxPlayers": 6, "bossAliveFull": 6 }
}
```

id must match the folder and use lowercase letters, digits, dots, underscores or hyphens (1–64 characters, starting with a letter or digit). version is x.y.z. name is required; description, author and license are optional. Text fields are limited to 256 characters. modes is a nonempty unique list of solo/coop. Unknown manifest fields and rules are rejected.

API v1 exposes two integer rules (1–8):
- maxPlayers: cooperative player capacity, humans plus AI. Solo capacity must stay one. Spectators remain separate, two per cooperative room.
- bossAliveFull: upper bound on the existing Boss alive-player calculation. Bots and disconnected players count; eliminated and departed players do not. The official Boss formula and solo multiplier remain unchanged.

Rules apply per room, never to the process-wide official data. Two plugins writing the same rule conflict, even if their values agree; selection is rejected instead of depending on load order. Plugins with disjoint rules compose. A manifest must declare at least one rule. maxPlayers alone does not implicitly change Boss scaling.

v1 is a declarative rules API, not an arbitrary JavaScript execution API. Economy, card-pool changes and combat callbacks are not implemented. New capabilities require an explicit future API contract and shared-client simulation support. Existing language/content packs remain a separate subsystem.

## Network and lifecycle

welcome.plugins contains the available validated manifests plus a SHA-256 digest of each source manifest. room.create accepts an optional plugins array of unique IDs (maximum 16); omission means no plugins. Unknown or incompatible plugins fail before the caller leaves an existing room.

room.state includes plugins (selected manifests, versions and digests) and rules (effective maxPlayers and bossAliveFull). These immutable snapshots survive host transfer and reconnect for the lifetime of the room. Plugins can only be selected during creation; create another room to change them. Restarting the server ends in-memory rooms as before.

The server validates the selection and applies per-match data overlays. The client previews the same rule resolver and renders the server's room capacity. Protocol/result buffers support up to eight players, but this does not grant a four-player room extra seats. Existing clients omitting plugins still create ordinary rooms; use the client served by this fork to join plugin rooms.

## Bundled example and validation

eight-players selects maxPlayers=8 and bossAliveFull=8 for cooperative rooms. The generated official data remains unchanged. Without a plugin, the original capacity, Boss defaults and 1–4-player balance are preserved.

Run node --test test/plugins.test.js for manifests, external installation, conflicts, isolation and WebSocket capacity/reconnect tests. The existing golden suite checks unchanged upstream gameplay. test/e2e/plugins.e2e.mjs exercises the plugin through real browser clicks and eight-player battles (normal/boss/hidden); see its header for SSH-tunnel use.
