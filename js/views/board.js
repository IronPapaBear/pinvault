// One set photo: box each pin (auto-detect or draw), tap a box to edit it.
import * as db from '../db.js';
import { state } from '../db.js';
import * as C from '../catalog.js';
import * as V from '../vision.js';
import { annotator } from '../annotator.js';
import { h, icon, photoButton, toast, spinner, KINDS, isChase } from '../ui.js';
import { openPinSheet } from './sheets.js';
import { catalogBanner } from './collection.js';

const boardPrefs = { group: '', kind: 'regular' };
let busy = '';

export function boardView(id) {
  const board = state.boards.get(Number(id));
  if (!board) return h('div', { class: 'page' }, h('p', {}, 'Set photo not found.'), h('a', { href: '#/collection' }, 'Back'));
  const series = state.series.get(board.seriesKey);
  const back = h('a', { class: 'btn-text', href: `#/series/${encodeURIComponent(board.seriesKey)}` }, icon('back'), C.shortName(series));

  if (!board.blob) {
    return h('div', { class: 'page' },
      h('header', { class: 'top' }, back, h('h1', { class: 'h2' }, board.label)),
      h('div', { class: 'card stack' },
        h('p', {}, board.error === 'blocked'
          ? 'This set photo couldn\'t be downloaded automatically (the blog\'s image server didn\'t allow it).'
          : 'This set photo isn\'t on your phone yet.'),
        board.url ? h('button', { class: 'btn', onclick: async () => { busy = 'Downloading…'; rerender(); await C.downloadBoards(); busy = ''; await C.autoCatalog(); } }, icon('download'), h('span', {}, 'Try downloading again')) : null,
        h('p', { class: 'small muted' }, 'Or add it yourself: open the blog post, press and hold the set photo, choose “Save to Photos”, then pick it here.'),
        h('a', { class: 'btn', href: series.url, target: '_blank', rel: 'noopener' }, icon('link'), h('span', {}, 'Open blog post')),
        photoButton('Choose the saved photo', async (file) => { await C.setBoardImage(board, file); await C.autoCatalog(); }, 'btn primary'),
        busy ? spinner(busy) : null));
  }

  const slots = db.slotsOfBoard(board.id);
  const boxes = slots.map((s) => ({
    id: s.id, rect: s.rect,
    color: s.owned ? 'var(--green)' : isChase(s.kind) ? 'var(--orange)' : '#60a5fa',
    label: s.name.replace(board.label + ' ', ''),
  }));
  const themes = (series && series.themes) || [];

  const ann = annotator({
    key: 'board-' + board.id, src: db.blobURL(board.blob), boxes, height: '56vh',
    onTapBox: (sid) => { const s = state.slots.get(sid); if (s) openPinSheet(s); },
    onDraw: async (rect) => {
      await C.addBoxes(board, [rect], { group: boardPrefs.group, kind: boardPrefs.kind, edited: !!boardPrefs.group || boardPrefs.kind !== 'regular' });
    },
    onPoint: async (x, y) => {
      busy = 'Finding that pin…'; rerender();
      const canvas = await V.blobToCanvas(board.blob, 2400);
      busy = '';
      await C.addBoxes(board, [V.pinAt(canvas, x, y)], { group: boardPrefs.group, kind: boardPrefs.kind, edited: !!boardPrefs.group || boardPrefs.kind !== 'regular' });
    },
  });

  const kindSelect = h('select', { class: 'select', onchange: (e) => { boardPrefs.kind = e.target.value; } },
    KINDS.map(([k, l]) => h('option', { value: k, selected: boardPrefs.kind === k }, l)));

  return h('div', { class: 'page' },
    h('header', { class: 'top' }, back, h('h1', { class: 'h2' }, board.label)),
    catalogBanner(),
    ann.el,
    h('div', { class: 'row wrap' },
      h('button', {
        class: 'btn small', onclick: async () => {
          busy = 'Looking for pins…'; rerender();
          const canvas = await V.blobToCanvas(board.blob, 2400);
          const existing = slots.map((s) => s.rect);
          const found = V.detectPins(canvas).filter((r) => r.w * r.h < 0.3 && !existing.some((e) => V.iou(e, r) > 0.3));
          await C.addBoxes(board, found, { group: boardPrefs.group, kind: boardPrefs.kind, edited: !!boardPrefs.group || boardPrefs.kind !== 'regular' });
          busy = '';
          toast(found.length ? `Added ${found.length} boxes` : 'No new pins found — draw boxes by hand');
        },
      }, icon('wand'), h('span', {}, 'Auto-detect')),
      h('span', { class: 'small muted' }, `${slots.length} pins boxed`),
      busy ? spinner(busy) : null),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'small bold' }, 'New boxes get:'),
      themes.length ? h('div', { class: 'chips' }, themes.map((t) => h('button', {
        class: 'chip' + (boardPrefs.group === t ? ' on' : ''),
        onclick: () => { boardPrefs.group = boardPrefs.group === t ? '' : t; rerender(); },
      }, t))) : null,
      h('div', { class: 'row' }, h('input', {
        class: 'input', placeholder: 'Theme', value: boardPrefs.group,
        oninput: (e) => { boardPrefs.group = e.target.value; },
      }), kindSelect)),
    h('p', { class: 'small muted' }, 'Tap a box to rename it, set its theme or type, mark it owned, split it, or delete it. Missed one? Tap Box a pin, then tap the pin (or drag around it).'));
}

function rerender() { window.dispatchEvent(new Event('hashchange')); }
