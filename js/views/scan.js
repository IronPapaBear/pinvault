// Add Pins and Trade Board tabs: photograph pins, see what they are, what you need.
import * as db from '../db.js';
import * as C from '../catalog.js';
import * as V from '../vision.js';
import { annotator } from '../annotator.js';
import { h, icon, photoButton, toast, spinner, kindBadge, isChase } from '../ui.js';
import { openSplitSheet, openBoardPicker, openMatchesSheet } from './sheets.js';
import { catalogBanner } from './collection.js';
import { openLive } from './live.js';
import { state } from '../db.js';

let nextId = 1;
const rerender = () => window.dispatchEvent(new Event('hashchange'));

function newSession() {
  return { url: '', canvas: null, pins: [], working: '', catalogEmpty: false, saved: '', onlyNeeds: false, savePhotos: true };
}
export const sessions = { add: newSession(), trade: newSession() };

function makePin(scan, index) {
  const matches = C.matchesFor(index, scan, 5);
  const confident = C.isConfident(matches);
  return {
    id: nextId++, rect: scan.rect, blob: scan.blob, url: scan.blob ? URL.createObjectURL(scan.blob) : '',
    basic: scan.basic, ml: scan.ml, matches, chosen: confident ? 0 : null, include: !!confident,
  };
}
const chosenSlot = (p) => (p.chosen != null && p.matches[p.chosen] ? state.slots.get(p.matches[p.chosen].slot.id) : null);

export async function loadPhoto(session, source) {
  session.working = 'Looking for pins…';
  session.pins = [];
  session.saved = '';
  rerender();
  await new Promise((r) => setTimeout(r, 30));
  const canvas = source instanceof HTMLCanvasElement ? source : await V.blobToCanvas(source, 2400);
  session.canvas = canvas;
  if (session.url) URL.revokeObjectURL(session.url);
  session.url = URL.createObjectURL(await V.canvasToBlob(canvas, 'image/jpeg', 0.9));
  let scans = await V.scanCanvas(canvas);
  if (!scans.length) scans = await V.scanCanvas(canvas, [{ x: 0, y: 0, w: 1, h: 1 }]);
  const index = C.buildIndex();
  session.catalogEmpty = index.length === 0;
  session.pins = scans.map((s) => makePin(s, index));
  session.working = '';
  rerender();
}

async function tapPin(session, x, y) {
  session.working = 'Finding that pin…'; rerender();
  await new Promise((r) => setTimeout(r, 20));
  await addBox(session, V.pinAt(session.canvas, x, y));
  session.working = '';
  rerender();
}

async function addBox(session, rect) {
  const [scan] = await V.scanCanvas(session.canvas, [rect]);
  if (scan) session.pins.push(makePin(scan, C.buildIndex()));
  rerender();
}

async function splitPin(session, pin, rows, cols) {
  const i = session.pins.indexOf(pin);
  if (i < 0) return;
  session.working = 'Splitting…'; rerender();
  const scans = await V.scanCanvas(session.canvas, V.gridRects(pin.rect, rows, cols));
  const index = C.buildIndex();
  session.pins.splice(i, 1, ...scans.map((s) => makePin(s, index)));
  session.working = '';
  rerender();
}

function choose(pin, slot) {
  pin.matches = pin.matches.filter((m) => m.slot.id !== slot.id);
  pin.matches.unshift({ slot, d: 0, picked: true });
  pin.chosen = 0;
  pin.include = true;
  rerender();
}

function findOnBoard(pin) {
  openBoardPicker({ query: pin, cropURL: pin.url, onPick: (slot) => choose(pin, slot) });
}

function showPin(session, pin, extra) {
  openMatchesSheet({
    pin,
    onChoose: (i) => { pin.chosen = i; pin.include = true; rerender(); },
    onFind: () => findOnBoard(pin),
    onNone: () => { pin.chosen = null; pin.include = false; rerender(); },
    onSplit: () => openSplitSheet({ cropURL: pin.url, onSplit: (r, c) => splitPin(session, pin, r, c) }),
    extra,
  });
}

function newPhotoButton(session) {
  return h('button', { class: 'btn-text', onclick: () => { Object.assign(session, newSession()); rerender(); } }, icon('back'), 'New photo');
}

// ---------- Add Pins ----------

export function addView() {
  const s = sessions.add;
  if (!s.canvas && !s.working) {
    return h('div', { class: 'page' },
      h('header', { class: 'top' }, h('h1', {}, 'Add Pins')),
      catalogBanner(),
      h('div', { class: 'hero' },
        h('div', { class: 'hero-ico' }, icon('camera')),
        h('h2', {}, 'Photograph pins you own'),
        h('p', { class: 'muted' }, 'Lay one or more pins on a plain, contrasting background with a little space between them. PinVault finds each pin and tells you which series and wave it\'s from.'),
        photoButton('Take or choose photo', (f) => loadPhoto(s, f), 'btn primary big'),
        h('button', { class: 'btn big', onclick: () => openLive({ onFreeze: (c) => loadPhoto(s, c) }) }, icon('video'), h('span', {}, 'Live scan')),
        s.saved ? h('div', { class: 'txt-green bold' }, icon('check'), ' ', s.saved) : null));
  }

  const boxes = s.pins.map((p, i) => ({
    id: p.id, rect: p.rect, label: String(i + 1),
    color: chosenSlot(p) ? (p.include ? 'var(--green)' : '#60a5fa') : '#9ca3af',
  }));
  const selected = s.pins.filter((p) => p.include && chosenSlot(p));

  return h('div', { class: 'page' },
    h('header', { class: 'top' }, newPhotoButton(s), h('h1', { class: 'h2' }, 'Add Pins')),
    catalogBanner(),
    s.canvas ? annotator({
      key: 'add', src: s.url, boxes, height: '40vh',
      onDraw: (rect) => addBox(s, rect),
      onPoint: (x, y) => tapPin(s, x, y),
      onTapBox: (id) => { const p = s.pins.find((x) => x.id === id); if (p) openSplitSheet({ cropURL: p.url, onSplit: (r, c) => splitPin(s, p, r, c) }); },
    }).el : null,
    s.working ? spinner(s.working) : null,
    s.catalogEmpty && !s.working ? h('div', { class: 'card warnbox small' },
      'Nothing is catalogued yet, so pins can\'t be recognised automatically. Tap “Find on a board” under a pin to pick it from the set photos — PinVault will recognise it by itself after that.') : null,
    h('div', { class: 'list' }, s.pins.map((p, i) => addRow(s, p, i))),
    s.pins.length ? h('div', { class: 'card stack tight' },
      h('label', { class: 'row' }, h('span', { class: 'grow small' }, 'Save my photos to improve matching'),
        h('input', { type: 'checkbox', class: 'toggle', checked: s.savePhotos, onchange: (e) => { s.savePhotos = e.target.checked; } })),
      h('button', {
        class: 'btn primary wide', disabled: !selected.length, onclick: async () => {
          for (const p of selected) {
            const slot = chosenSlot(p);
            await db.updateSlot(slot, { owned: (slot.owned || 0) + 1 }, { markEdited: false });
            if (s.savePhotos && p.blob) await db.addRef(slot.id, { blob: p.blob, basic: p.basic, ml: p.ml, user: true });
          }
          const n = selected.length;
          Object.assign(s, newSession(), { saved: `Added ${n} pin${n === 1 ? '' : 's'} to your collection` });
          rerender();
        },
      }, icon('plus'), h('span', {}, `Add ${selected.length} to my collection`))) : null,
    s.pins.length ? h('p', { class: 'small muted' }, 'Missed a pin? Tap Box a pin, then tap the pin (or drag around it). A box around several pins? Tap the box to split it.') : null);
}

function addRow(s, p, i) {
  const slot = chosenSlot(p);
  const m = p.chosen != null ? p.matches[p.chosen] : null;
  const conf = m ? (m.picked ? { label: 'You picked', cls: 'green' } : C.confidence(m.d, p.matches)) : null;
  const ref = slot ? db.thumbRef(slot) : null;
  return h('div', { class: 'list-row top' },
    h('div', { class: 'thumb md numbered', 'data-n': i + 1, onclick: () => showPin(s, p) }, h('img', { src: p.url })),
    h('div', { class: 'grow stack tight', onclick: () => showPin(s, p) },
      slot ? [
        h('div', { class: 'row tight' }, h('span', { class: 'bold' }, slot.name), kindBadge(slot.kind)),
        h('div', { class: 'small' }, C.shortName(state.series.get(slot.seriesKey)), slot.group ? ' · ' + slot.group : ''),
        h('div', { class: 'small' }, h('span', { class: 'txt-' + conf.cls + ' bold' }, conf.label),
          slot.owned ? h('span', { class: 'muted' }, ` · already have ×${slot.owned}`) : null),
        h('span', { class: 'small txt-accent' }, 'Other matches…'),
      ] : [
        h('div', { class: 'bold muted' }, 'No confident match'),
        h('button', { class: 'btn small primary', onclick: (e) => { e.stopPropagation(); findOnBoard(p); } }, icon('hand'), h('span', {}, 'Find on a board')),
      ]),
    h('div', { class: 'stack tight center' },
      ref ? h('div', { class: 'thumb sm' }, h('img', { src: db.blobURL(ref.blob) })) : null,
      h('input', { type: 'checkbox', class: 'toggle', checked: p.include, disabled: !slot, onchange: (e) => { p.include = e.target.checked; rerender(); } })));
}

// ---------- Trade Board ----------

function tradeStatus(p) {
  const slot = chosenSlot(p);
  if (!slot) return 'unknown';
  if (slot.owned) return 'have';
  return isChase(slot.kind) ? 'chaser' : 'need';
}
export const STATUS_COLOR = { need: 'var(--red)', chaser: 'var(--orange)', have: 'var(--green)', unknown: '#9ca3af' };

export function tradeView() {
  const s = sessions.trade;
  if (!s.canvas && !s.working) {
    return h('div', { class: 'page' },
      h('header', { class: 'top' }, h('h1', {}, 'Trade Board')),
      catalogBanner(),
      h('div', { class: 'hero' },
        h('div', { class: 'hero-ico' }, icon('scan')),
        h('h2', {}, 'Scan a trade board'),
        h('p', { class: 'muted' }, 'Point your camera at a cast member lanyard or trade board. Red = you need it, orange = a chaser you need, green = you have it, gray = not recognised.'),
        h('button', { class: 'btn primary big', onclick: () => openLive({ onFreeze: (c) => loadPhoto(s, c) }) }, icon('video'), h('span', {}, 'Start live scan')),
        h('div', { class: 'small muted' }, 'or'),
        photoButton('Use a photo', (f) => loadPhoto(s, f), 'btn big')));
  }

  const statuses = s.pins.map(tradeStatus);
  const count = (k) => statuses.filter((x) => x === k).length;
  const needs = s.pins.filter((p) => ['need', 'chaser'].includes(tradeStatus(p)));
  const boxes = s.pins.map((p) => {
    const st = tradeStatus(p);
    const slot = chosenSlot(p);
    const isNeed = st === 'need' || st === 'chaser';
    return {
      id: p.id, rect: p.rect, color: STATUS_COLOR[st], dim: s.onlyNeeds && !isNeed,
      label: slot ? (isNeed ? `${st === 'chaser' ? '★ ' : ''}NEED ${C.tinyName(state.series.get(slot.seriesKey))}` : '✓') : '',
    };
  });

  return h('div', { class: 'page' },
    h('header', { class: 'top' }, newPhotoButton(s), h('h1', { class: 'h2' }, 'Trade Board')),
    s.canvas ? annotator({
      key: 'trade', src: s.url, boxes, height: '48vh',
      onDraw: (rect) => addBox(s, rect),
      onPoint: (x, y) => tapPin(s, x, y),
      onTapBox: (id) => { const p = s.pins.find((x) => x.id === id); if (p) showTrade(s, p); },
    }).el : null,
    s.working ? spinner(s.working) : h('div', { class: 'card stack tight' },
      h('div', { class: 'bold' }, `Found ${s.pins.length} pins`),
      h('div', { class: 'row wrap small bold' },
        h('span', { class: 'txt-red' }, `● ${count('need') + count('chaser')} need`),
        count('chaser') ? h('span', { class: 'txt-orange' }, icon('star'), ` ${count('chaser')} chaser${count('chaser') === 1 ? '' : 's'}`) : null,
        h('span', { class: 'txt-green' }, `✓ ${count('have')} have`),
        count('unknown') ? h('span', { class: 'muted' }, `? ${count('unknown')} not recognised`) : null),
      s.catalogEmpty ? h('div', { class: 'small txt-orange' }, 'Your catalog is still empty, so nothing can be recognised yet. Open the Collection tab and let it download and box the set photos first.') : null,
      h('label', { class: 'row' }, h('span', { class: 'grow small' }, 'Highlight only pins I need'),
        h('input', { type: 'checkbox', class: 'toggle', checked: s.onlyNeeds, onchange: (e) => { s.onlyNeeds = e.target.checked; rerender(); } }))),
    needs.length ? [h('div', { class: 'section-title' }, 'You need'), h('div', { class: 'list' }, needs.map((p) => {
      const slot = chosenSlot(p);
      const ref = db.thumbRef(slot);
      return h('button', { class: 'list-row', onclick: () => showTrade(s, p) },
        h('div', { class: 'thumb sm' }, h('img', { src: p.url })),
        h('div', { class: 'grow' }, h('div', { class: 'row tight' }, h('span', { class: 'bold' }, slot.name), kindBadge(slot.kind)),
          h('div', { class: 'small' }, state.series.get(slot.seriesKey).title), slot.group ? h('div', { class: 'small muted' }, slot.group) : null),
        ref ? h('div', { class: 'thumb sm' }, h('img', { src: db.blobURL(ref.blob) })) : null);
    }))] : null,
    h('p', { class: 'small muted' }, 'Tap any box for details or to split a box that covers several pins. Missed a pin? Tap Box a pin, then tap the pin (or drag around it).'));
}

function showTrade(s, p) {
  showPin(s, p, (api) => {
    const slot = chosenSlot(p);
    if (!slot) return null;
    return h('button', {
      class: 'btn primary wide', onclick: async () => {
        await db.updateSlot(slot, { owned: (slot.owned || 0) + 1 }, { markEdited: false });
        if (p.blob) await db.addRef(slot.id, { blob: p.blob, basic: p.basic, ml: p.ml, user: true });
        toast(`Added ${slot.name} to your collection`);
        api.close();
        rerender();
      },
    }, icon('swap'), h('span', {}, 'I traded for this — add to collection'));
  });
}
