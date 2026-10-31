// PinVault web app: start-up, routing and the tab bar.
import * as db from './db.js?v=202610311004';
import * as C from './catalog.js?v=202610311004';
import * as V from './vision.js?v=202610311004';
import { set, h, icon, toast } from './ui.js?v=202610311004';
import { collectionView, seriesView } from './views/collection.js?v=202610311004';
import { boardView } from './views/board.js?v=202610311004';
import { addView, tradeView } from './views/scan.js?v=202610311004';
import { settingsView } from './views/settings.js?v=202610311004';

const main = document.getElementById('main');
const tabs = document.getElementById('tabs');

const TABS = [
  ['collection', 'Collection', 'grid'],
  ['add', 'Add Pins', 'camera'],
  ['trade', 'Trade Board', 'scan'],
  ['settings', 'Settings', 'gear'],
];

function route() {
  const parts = (location.hash || '#/collection').slice(2).split('/').map(decodeURIComponent);
  const [name, arg] = parts;
  switch (name) {
    case 'series': return { tab: 'collection', view: () => seriesView(arg) };
    case 'board': return { tab: 'collection', view: () => boardView(arg) };
    case 'add': return { tab: 'add', view: addView };
    case 'trade': return { tab: 'trade', view: tradeView };
    case 'settings': return { tab: 'settings', view: settingsView };
    default: return { tab: 'collection', view: collectionView };
  }
}

let lastHash = '';
const scrollMemory = new Map();

function render() {
  const r = route();
  const sameRoute = lastHash === location.hash;
  if (!sameRoute) scrollMemory.set(lastHash, window.scrollY);
  // keep focus/caret in a text box across re-renders
  const active = document.activeElement;
  const activeId = active && active.id && main.contains(active) ? active.id : null;
  const sel = activeId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const y = window.scrollY;

  let node;
  try { node = r.view(); }
  catch (e) { console.error(e); node = h('div', { class: 'page' }, h('p', {}, 'Something went wrong: ' + e.message)); }
  set(main, node);

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch { /* */ } }
  }
  window.scrollTo(0, sameRoute ? y : scrollMemory.get(location.hash) || 0);
  lastHash = location.hash;

  set(tabs, ...TABS.map(([key, label, ico]) =>
    h('a', { href: '#/' + key, class: 'tab' + (r.tab === key ? ' on' : '') }, icon(ico), h('span', {}, label))));
}

// Show unexpected errors instead of failing silently (helps fix problems from a screenshot).
window.addEventListener('error', (e) => toast('Error: ' + (e.message || 'unknown'), 8000));
window.addEventListener('unhandledrejection', (e) => toast('Error: ' + ((e.reason && e.reason.message) || e.reason || 'unknown'), 8000));

async function start() {
  try {
    await db.init();
  } catch (e) {
    set(main, h('div', { class: 'page' }, h('h2', {}, 'PinVault can\'t store data here'),
      h('p', {}, 'Your browser blocked storage (private browsing?). Open PinVault in normal Safari or from your Home Screen.')));
    return;
  }
  await C.seed();
  window.addEventListener('hashchange', render);
  db.onChange(render);
  V.ml.listeners.add(render);
  render();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Background set-up: shared layout from the website, set photos, automatic boxes, smarter matching.
  const layout = await C.checkSiteLayout();
  if (layout && (layout.added || layout.updated)) toast(`Updated pin layout (${layout.added + layout.updated} pins)`);
  const missing = [...db.state.boards.values()].some((b) => b.url && !b.blob && b.error !== 'blocked');
  if (missing && navigator.onLine !== false) await C.downloadBoards();
  await C.autoCatalog();
  if (localStorage.getItem('pv.ml') !== 'off') {
    await V.loadML();
    if (V.ml.status === 'ready') await C.rebuildFingerprints({ onlyMissingML: true });
  }
}

start();
