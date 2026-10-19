// Room browser (大厅画面右下角): every open Alliance, collapsible, with 加入 / 观战 per room.
//
//   <${RoomBrowser} />   mounted by screens/lobby.js
//
// Data: the S2C `lobby.rooms` frame (server/lobby.js sendRooms, DESIGN §8.1) → store.ui.rooms. The server pushes it to
// every session that is in no room right after its hello and again whenever a room changes (debounced), so the panel
// is live without polling. A row is named after its host and lists the human seats' names; the alliance key (`code`)
// is the buttons' argument and is never rendered. 加入 is disabled while the room's match runs (the server answers
// ROOM_STARTED); 观战 stays clickable and a room whose two spectator seats are taken answers ROOM_FULL. A collapsed
// panel keeps only its header (with the count), so the lobby underneath stays reachable on a phone.
//
// The list is public: it names the open rooms and their players to anyone who can reach the server. /healthz already
// exposed the counts; this adds the names (docs/design/network.md).

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, confirmDialog } from './components.js';
import { net } from '../net.js';
import { useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { toast, toastError } from './toasts.js';
import { ERR, MAX_SPECTATORS } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

/** localStorage: the panel starts collapsed / expanded across sessions. */
const PREF = 'lobby.roomsCollapsed';

/**
 * One row of the S2C `lobby.rooms` frame (server/lobby.js roomsList).
 * @typedef {{ code: string, hostName: string, mode: string, difficulty: string, inMatch: boolean, modded: boolean,
 *   test: boolean,
 *   players: string[], bots: number, seatsUsed: number, seatsMax: number, spectators: number,
 *   spectatorsMax: number }} RoomRow
 */

/** The last room list, or null before the first snapshot (the panel stays hidden until then). */
function useRooms() {
  return useStore((s) => s.ui.rooms) || null;
}

/** The lobby's floating room browser. Renders nothing before the first snapshot or while offline. */
export function RoomBrowser() {
  const rooms = useRooms();
  const conn = useStore((s) => s.connection, shallowEqual);
  const [collapsed, setCollapsed] = useState(() => !!loadPref(PREF, false));
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const online = conn.status === 'online';
  if (!online || !rooms) return null;

  // only co-op rooms: a solo room can be neither joined (ROOM_FULL) nor watched (solo rooms have no spectator seat)
  /** @type {RoomRow[]} */
  const list = rooms.filter((r) => r.mode === 'coop');
  const count = list.length;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    savePref(PREF, next);
  };

  /**
   * Join or spectate one room. The buttons carry the alliance key; the list never shows it.
   * @param {'join' | 'spectate'} kind
   * @param {RoomRow} room
   */
  const act = async (kind, room) => {
    if (busy) return;
    setBusy(kind + ':' + room.code);
    /** @param {boolean} [testAck] */
    const send = (testAck = false) => net.request(kind === 'join' ? 'room.join' : 'room.spectate',
      { code: room.code, ...(testAck ? { testAck: true } : {}) });
    try {
      try {
        await send();
      } catch (err) {
        if (err?.code !== ERR.TEST_CONFIRM) throw err;
        // 0.3.1 test rooms: a seat in one records nothing, so the server asks for an explicit ack (joinKnown's flow)
        const text = kind === 'spectate'
          ? t('这是测试房间，不计入任何记录。确认观战？')
          : t('这是测试房间，不计入任何记录。确认加入？');
        if (!(await confirmDialog({ title: t('测试'), text }))) return;
        await send(true);
      }
    } catch (err) {
      const code = err?.code;
      if (code === ERR.ROOM_NOT_FOUND) toast(t('该同盟已解散'), 'warn');
      else if (code === ERR.ROOM_STARTED) toast(t('该同盟已开始模拟，无法加入（可以观战）'), 'warn');
      else if (code === ERR.ROOM_FULL) {
        toast(kind === 'join' ? t('该同盟已满') : t('观战席已满（每个同盟最多 {MAX_SPECTATORS} 名）', { MAX_SPECTATORS }), 'warn');
      } else if (code === ERR.ALREADY) toast(t('你已经在另一个同盟中，请先离开'), 'warn');
      else toastError(err);
    } finally {
      setBusy(null);
    }
  };

  return html`<aside class=${collapsed ? 'room-browser is-collapsed' : 'room-browser'} aria-label=${t('房间列表')}>
    <button type="button" class="room-browser__head" onClick=${toggle} aria-expanded=${!collapsed}
      title=${collapsed ? t('展开房间列表') : t('收起房间列表')}>
      <${Icon} name="users" class="room-browser__icon" />
      <span class="room-browser__title">${t('房间列表')}</span>
      <b class="room-browser__count num">${count}</b>
      <${Icon} name="chevronRight" class="room-browser__chev" />
    </button>
    ${collapsed ? null : html`<div class="room-browser__list">
      ${count === 0
        ? html`<div class="room-browser__empty">${t('暂无正在进行的同盟')}</div>`
        : list.map((room) => html`<div key=${room.code} class=${room.inMatch ? 'room-browser__row is-in-match' : 'room-browser__row'}>
            <div class="room-browser__meta">
              <span class="room-browser__name" title=${room.hostName}>${room.hostName || t('未命名')}</span>
              ${room.modded ? html`<span class="room-browser__tag">${t('非官方')}</span>` : null}
              ${room.test ? html`<span class="room-browser__tag is-test">${t('测试')}</span>` : null}
              <span class="room-browser__state">${room.inMatch ? t('游戏中') : t('等待中')}</span>
            </div>
            <div class="room-browser__players">
              ${room.players.map((name, i) => html`<span key=${i} class="room-browser__player" title=${name}>${name}</span>`)}
              ${room.bots ? html`<span class="room-browser__player is-bot"><${Icon} name="robot" />${t('AI × {n}', { n: room.bots })}</span>` : null}
              <span class="room-browser__seats num">${room.seatsUsed}/${room.seatsMax}</span>
              ${room.spectators ? html`<span class="room-browser__spec"><${Icon} name="eye" />${room.spectators}</span>` : null}
            </div>
            <div class="room-browser__actions">
              <${Button} size="sm" variant="amber" icon="users" disabled=${room.inMatch || busy != null}
                loading=${busy === 'join:' + room.code} onClick=${() => act('join', room)}>${t('加入')}<//>
              <${Button} size="sm" variant="secondary" icon="eye" disabled=${busy != null}
                loading=${busy === 'spectate:' + room.code} onClick=${() => act('spectate', room)}>${t('观战')}<//>
            </div>
          </div>`)}
    </div>`}
  </aside>`;
}
