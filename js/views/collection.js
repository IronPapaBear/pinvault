// Collection tab: By Series list, one series, and the all-pins Gallery.
import * as db from '../db.js?v=202610311008';
import { state } from '../db.js?v=202610311008';
import * as C from '../catalog.js?v=202610311008';
import { set, h, icon, segmented, progressBar, photoButton, isChase, kindBadge, toast, spinner } from '../ui.js?v=202610311008';
import { openPinSheet, openAddFromPhotoSheet } from './sheets.js?v=202610311008';

export function catalogBanner() {
  const s = C.status;
  if (!s.running) return null;
  return h('div', { class: 'banner' }, h('span', { class: 'spin' }),
    h('div', {}, h('div', { class: 'bold' }, s.phase + '…'),
      h('div', { class: 'small muted' }, `${Math.min(s.done + 1, s.total)} of ${s.total}`)));
}

function summaryCard(slots) {
  const owned = slots.filter((s) => s.owned > 0).length;
  const chasers = slots.filter((s) => isChase(s.kind));
  return h('div', { class: 'card stack tight' },
    h('div', { class: 'row' }, h('div', { class: 'bold grow' }, `${owned} of ${slots.length} pins`),
      chasers.length ? h('span', { class: 'txt-orange small bold' }, icon('star'), ` ${chasers.filter((s) => s.owned).length}/${chasers.length} chasers`) : null),
    slots.length ? progressBar(owned, slots.length, 'var(--green)') : null);
}

export function collectionView() {
  const mode = localStorage.getItem('pv.collectionMode') || 'series';
  const setMode = (m) => { localStorage.setItem('pv.collectionMode', m); location.hash = '#/collection'; window.dispatchEvent(new Event('hashchange')); };
  return h('div', { class: 'page' },
    h('header', { class: 'top' }, h('h1', {}, 'My Pins'),
      segmented([['series', 'By Series'], ['gallery', 'Gallery']], mode, setMode)),
    catalogBanner(),
    mode === 'gallery' ? galleryView() : seriesListView());
}

function seriesListView() {
  const slots = db.allSlots();
  const years = [...new Set(db.seriesList().map((s) => s.year))].sort((a, b) => b - a);
  const missingPhotos = [...state.boards.values()].filter((b) => b.url && !b.blob).length;
  return h('div', { class: 'stack' },
    summaryCard(slots),
    missingPhotos && !C.status.running ? h('div', { class: 'card stack tight' },
      h('div', { class: 'small' }, `${missingPhotos} set photo${missingPhotos === 1 ? '' : 's'} not downloaded yet.`),
      h('button', { class: 'btn small', onclick: async () => { const r = await C.downloadBoards(); await C.autoCatalog(); if (r.failed) toast(`${r.failed} couldn't download — see the series page`); } }, icon('download'), h('span', {}, 'Download set photos'))) : null,
    years.map((y) => [
      h('div', { class: 'section-title' }, String(y)),
      h('div', { class: 'list' }, db.seriesList().filter((s) => s.year === y).map(seriesRow)),
    ]));
}

function seriesRow(series) {
  const slots = db.slotsOfSeries(series.key);
  const owned = slots.filter((s) => s.owned > 0).length;
  const chasers = slots.filter((s) => isChase(s.kind));
  const boards = db.boardsOf(series.key);
  return h('a', { class: 'list-row', href: `#/series/${encodeURIComponent(series.key)}` },
    h('div', { class: 'grow stack tight' },
      h('div', { class: 'bold' }, series.title),
      slots.length ? [
        progressBar(owned, slots.length, owned === slots.length ? 'var(--green)' : 'var(--accent)'),
        h('div', { class: 'small muted row tight' }, `${owned} / ${slots.length}`,
          chasers.length ? h('span', { class: 'txt-orange' }, icon('star'), ` ${chasers.filter((s) => s.owned).length}/${chasers.length}`) : null),
      ] : h('div', { class: 'small muted' }, boards.some((b) => b.blob) ? 'Set photos ready' : boards.length ? 'Set photos not downloaded' : 'No set photo — add your own')),
    icon('chev', 'muted'));
}

// ---------- one series ----------

const seriesFilter = { value: 'all' };

export function seriesView(key) {
  const series = state.series.get(key);
  if (!series) return h('div', { class: 'page' }, h('p', {}, 'Series not found.'));
  const boards = db.boardsOf(key);
  const slots = db.slotsOfSeries(key);
  const f = seriesFilter.value;
  const shown = slots.filter((s) => f === 'all' || (f === 'need' ? !s.owned : s.owned > 0));
  const groups = new Map();
  for (const s of shown) {
    const g = s.group || 'Ungrouped';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  const groupNames = [...groups.keys()].sort((a, b) => (a === 'Ungrouped') - (b === 'Ungrouped') || a.localeCompare(b));

  return h('div', { class: 'page' },
    h('header', { class: 'top' },
      h('a', { class: 'btn-text', href: '#/collection' }, icon('back'), 'My Pins'),
      h('h1', { class: 'h2' }, series.title)),
    catalogBanner(),
    slots.length ? summaryCard(slots) : null,

    h('div', { class: 'section-title' }, 'Set photos'),
    h('div', { class: 'list' },
      boards.map((b) => {
        const n = db.slotsOfBoard(b.id).length;
        return h('a', { class: 'list-row', href: `#/board/${b.id}` },
          h('div', { class: 'thumb sm' }, b.blob ? h('img', { src: db.blobURL(b.blob), alt: '' }) : icon('download', 'muted')),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, b.label),
            h('div', { class: 'small ' + (b.error ? 'txt-orange' : 'muted') },
              b.blob ? `${n} pin${n === 1 ? '' : 's'} boxed` : b.error === 'blocked' ? 'Couldn\'t download — tap to add it yourself' : b.error === 'offline' ? 'Offline — will download later' : 'Not downloaded yet')),
          icon('chev', 'muted'));
      }),
      !boards.length ? h('div', { class: 'list-row muted small' }, 'No set photo for this series on the blog post.') : null),
    h('div', { class: 'row wrap' },
      boards.some((b) => b.url && !b.blob) ? h('button', { class: 'btn small', onclick: async () => { await C.downloadBoards(); await C.autoCatalog(); } }, icon('download'), h('span', {}, 'Download')) : null,
      photoButton('Photograph a set', async (file) => { await C.addOwnBoard(key, file); await C.autoCatalog(); }, 'btn small'),
      h('a', { class: 'btn small', href: series.url, target: '_blank', rel: 'noopener' }, icon('link'), h('span', {}, 'Blog post'))),

    slots.length ? [
      h('div', { class: 'section-title row' }, h('span', { class: 'grow' }, 'Pins'),
        segmented([['all', 'All'], ['need', 'Need'], ['have', 'Have']], f, (v) => { seriesFilter.value = v; window.dispatchEvent(new Event('hashchange')); })),
      groupNames.map((g) => [
        h('div', { class: 'group-title' }, g, h('span', { class: 'muted' }, ` ${groups.get(g).filter((s) => s.owned).length}/${groups.get(g).length}`)),
        h('div', { class: 'tiles' }, groups.get(g).map((s) => pinTile(s))),
      ]),
      !shown.length ? h('p', { class: 'muted small' }, f === 'need' ? 'You have every pin in this series!' : 'None yet.') : null,
    ] : null,

    h('div', { class: 'card stack tight' },
      h('button', { class: 'btn wide', onclick: () => openAddFromPhotoSheet(key) }, icon('plus'), h('span', {}, 'Add a pin from a photo')),
      h('div', { class: 'small muted' }, 'For chasers and super chasers (usually not on the set photos) or any pin the set photo missed.')));
}

export function pinTile(s, { size = 84, showSeries = false } = {}) {
  const ref = db.thumbRef(s);
  const series = state.series.get(s.seriesKey);
  const toggle = h('button', {
    class: 'tile-check' + (s.owned ? ' on' : ''), 'aria-label': s.owned ? 'Mark as needed' : 'Mark as owned',
    onclick: (e) => { e.stopPropagation(); db.updateSlot(s, { owned: s.owned ? 0 : 1 }, { markEdited: false }); },
  }, s.owned ? icon('check') : null);
  return h('div', { class: 'tile' + (s.owned ? ' owned' : ' need'), style: { '--size': size + 'px' }, onclick: () => openPinSheet(s) },
    h('div', { class: 'tile-img' },
      ref ? h('img', { src: db.blobURL(ref.blob), alt: s.name, loading: 'lazy' }) : icon('info', 'muted'),
      toggle,
      isChase(s.kind) ? h('span', { class: 'tile-chase' }, icon(s.kind === 'chaser' ? 'star' : 'sparkles')) : null,
      s.owned > 1 ? h('span', { class: 'tile-count' }, '×' + s.owned) : null),
    size >= 70 ? h('div', { class: 'tile-name' }, s.name) : null,
    size >= 70 ? h('div', { class: 'tile-sub' }, showSeries ? C.shortName(series) : s.group || '') : null);
}

// ---------- gallery ----------

const gallery = {
  get filter() { return localStorage.getItem('pv.gFilter') || 'all'; },
  set filter(v) { localStorage.setItem('pv.gFilter', v); },
  get group() { return localStorage.getItem('pv.gGroup') || 'wave'; },
  set group(v) { localStorage.setItem('pv.gGroup', v); },
  get chasers() { return localStorage.getItem('pv.gChasers') === '1'; },
  set chasers(v) { localStorage.setItem('pv.gChasers', v ? '1' : '0'); },
  get size() { return Number(localStorage.getItem('pv.gSize') || 84); },
  set size(v) { localStorage.setItem('pv.gSize', String(v)); },
  search: '',
};

function galleryView() {
  const results = h('div', { class: 'stack' });
  const rerender = () => window.dispatchEvent(new Event('hashchange'));
  const searchInput = h('input', { class: 'input', type: 'search', id: 'gallery-search', placeholder: 'Search name, theme or wave', value: gallery.search });
  searchInput.addEventListener('input', () => { gallery.search = searchInput.value; renderResults(); });

  function renderResults() {
    const all = db.allSlots();
    const q = gallery.search.trim().toLowerCase();
    const items = all.filter((s) => {
      if (gallery.filter === 'need' && s.owned) return false;
      if (gallery.filter === 'have' && !s.owned) return false;
      if (gallery.chasers && !isChase(s.kind)) return false;
      if (!q) return true;
      const ser = state.series.get(s.seriesKey);
      return `${s.name} ${s.group} ${s.kind} ${ser ? ser.title + ' ' + C.shortName(ser) : ''}`.toLowerCase().includes(q);
    });
    const sections = [];
    if (gallery.group === 'none') sections.push(['All pins', items]);
    else if (gallery.group === 'wave') {
      for (const ser of db.seriesList()) {
        const list = items.filter((s) => s.seriesKey === ser.key)
          .sort((a, b) => (a.group || '~').localeCompare(b.group || '~') || a.createdAt - b.createdAt);
        if (list.length) sections.push([ser.title, list]);
      }
    } else if (gallery.group === 'theme') {
      const m = new Map();
      for (const s of items) { const g = s.group || 'Ungrouped'; if (!m.has(g)) m.set(g, []); m.get(g).push(s); }
      [...m.keys()].sort((a, b) => (a === 'Ungrouped') - (b === 'Ungrouped') || a.localeCompare(b))
        .forEach((k) => sections.push([k, m.get(k)]));
    } else {
      for (const [k, label] of [['superChaser', 'Super Chasers'], ['chaser', 'Chasers'], ['completer', 'Completers'], ['regular', 'Regular pins']]) {
        const list = items.filter((s) => s.kind === k);
        if (list.length) sections.push([label, list]);
      }
    }
    set(results, 
      !all.length ? h('div', { class: 'empty' }, icon('grid'), h('div', { class: 'bold' }, 'No pins yet'),
        h('div', { class: 'small muted' }, 'Pins appear here once the set photos are downloaded and boxed.')) : null,
      all.length && !items.length ? h('p', { class: 'muted' }, 'No pins match.') : null,
      sections.map(([title, list]) => {
        const owned = list.filter((s) => s.owned).length;
        return h('section', {},
          h('div', { class: 'sticky-head row' }, h('span', { class: 'bold grow' }, title),
            h('span', { class: owned === list.length ? 'txt-green small' : 'muted small' }, `${owned}/${list.length}`)),
          h('div', { class: 'tiles', style: { '--size': gallery.size + 'px' } }, list.map((s) => pinTile(s, { size: gallery.size, showSeries: gallery.group !== 'wave' }))));
      }));
  }

  const groupSelect = h('select', { class: 'select', onchange: (e) => { gallery.group = e.target.value; renderResults(); } },
    [['wave', 'Group: Wave'], ['theme', 'Group: Theme'], ['type', 'Group: Type'], ['none', 'No groups']]
      .map(([v, l]) => h('option', { value: v, selected: gallery.group === v }, l)));

  renderResults();
  return h('div', { class: 'stack' },
    summaryCard(db.allSlots()),
    segmented([['all', 'All'], ['need', 'Need'], ['have', 'Have']], gallery.filter, (v) => { gallery.filter = v; rerender(); }),
    h('div', { class: 'row wrap' },
      groupSelect,
      h('button', { class: 'btn small' + (gallery.chasers ? ' orange' : ''), onclick: () => { gallery.chasers = !gallery.chasers; rerender(); } }, icon('star'), h('span', {}, 'Chasers')),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn small round', onclick: () => { gallery.size = Math.max(56, gallery.size - 14); rerender(); } }, icon('zoomOut')),
      h('button', { class: 'btn small round', onclick: () => { gallery.size = Math.min(140, gallery.size + 14); rerender(); } }, icon('zoomIn'))),
    searchInput,
    results);
}
