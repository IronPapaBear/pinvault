// Shared pop-up panels: edit a pin, split a box, add a pin from a photo, find a pin on a board.
import * as db from '../db.js?v=202610311148';
import { state } from '../db.js?v=202610311148';
import * as C from '../catalog.js?v=202610311148';
import * as V from '../vision.js?v=202610311148';
import { annotator } from '../annotator.js?v=202610311148';
import { set, h, icon, openSheet, confirmSheet, stepper, photoButton, toast, KINDS, kindBadge, segmented, spinner } from '../ui.js?v=202610311148';

// ---------- edit a pin ----------

export function openPinSheet(slot) {
  const series = state.series.get(slot.seriesKey);
  openSheet({
    title: slot.name,
    build: (api) => {
      const body = h('div', { class: 'pad stack' });
      const refresh = () => {
        if (!state.slots.has(slot.id)) { api.close(); return; }
        api.setTitle(slot.name);
        set(body, ...content());
      };
      const content = () => {
        const refs = db.refsOf(slot.id);
        const themeInput = h('input', { class: 'input', value: slot.group, placeholder: 'Theme (e.g. Castles)' });
        themeInput.addEventListener('change', () => db.updateSlot(slot, { group: themeInput.value.trim() }));
        const nameInput = h('input', { class: 'input', value: slot.name, placeholder: 'Name' });
        nameInput.addEventListener('change', () => { db.updateSlot(slot, { name: nameInput.value.trim() || slot.name }); api.setTitle(slot.name); });
        const themes = (series && series.themes) || [];
        return [
          h('div', { class: 'thumb-strip' }, refs.map((r) => h('div', { class: 'thumb lg' + (r.user ? ' user' : '') },
            h('img', { src: db.blobURL(r.blob), alt: '' }),
            r.user ? h('span', { class: 'thumb-tag' }, icon('camera')) : null))),
          series ? h('div', { class: 'muted small' }, series.title) : null,
          h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
          h('label', { class: 'field' }, h('span', {}, 'Theme'), themeInput),
          themes.length ? h('div', { class: 'chips' }, themes.map((t) => h('button', {
            class: 'chip' + (slot.group === t ? ' on' : ''),
            onclick: async () => { await db.updateSlot(slot, { group: t }); refresh(); },
          }, t))) : null,
          h('div', { class: 'field' }, h('span', {}, 'Type'),
            segmented(KINDS.map(([k, l]) => [k, l.replace('Super Chaser', 'Super')]), slot.kind, async (k) => { await db.updateSlot(slot, { kind: k }); refresh(); })),
          h('div', { class: 'card' }, stepper('Owned', slot.owned, 0, 99, (v) => db.updateSlot(slot, { owned: v }, { markEdited: false }))),
          h('div', { class: 'card stack' },
            h('div', { class: 'small muted' }, 'Add a photo of this pin from your own collection. Real photos match far better than crops from a blog picture.'),
            photoButton('Add my photo', async (file) => {
              const t = toast('Adding photo…');
              const canvas = await V.blobToCanvas(file, 2000);
              const [scan] = await V.scanCanvas(canvas, [V.mainPinRect(canvas)]);
              await db.addRef(slot.id, { blob: scan.blob, basic: scan.basic, ml: scan.ml, user: true });
              toast('Photo added');
              refresh();
            }, 'btn')),
          slot.boardId && slot.rect ? h('button', {
            class: 'btn wide', onclick: () => {
              const ref = refs.find((r) => !r.user);
              openSplitSheet({
                cropURL: ref ? db.blobURL(ref.blob) : '',
                onSplit: async (rows, cols) => { api.close(); await C.splitSlot(slot, rows, cols); toast(`Split into ${rows * cols} pins`); },
              });
            },
          }, icon('split'), h('span', {}, 'This box covers several pins — split it')) : null,
          h('button', {
            class: 'btn danger wide', onclick: async () => {
              if (await confirmSheet(`Delete “${slot.name}”?`, 'Delete', true)) { await db.deleteSlot(slot); api.close(); }
            },
          }, icon('trash'), h('span', {}, 'Delete this pin')),
        ];
      };
      refresh();
      return body;
    },
  });
}

// ---------- split a box ----------

export function openSplitSheet({ cropURL, onSplit, initial }) {
  let rows = 1, cols = 2;
  const sheet = openSheet({
    title: 'Split box',
    build: () => {
      const lines = h('div', { class: 'split-lines' });
      const img = h('img', { src: cropURL, alt: '', class: 'split-img' });
      const drawLines = () => {
        set(lines);
        const inset = (0.04 / 1.08) * 100;
        const span = 100 - 2 * inset;
        for (let c = 0; c <= cols; c++) lines.append(h('div', { class: 'vline', style: { left: inset + (span * c) / cols + '%', top: inset + '%', height: span + '%' } }));
        for (let r = 0; r <= rows; r++) lines.append(h('div', { class: 'hline', style: { top: inset + (span * r) / rows + '%', left: inset + '%', width: span + '%' } }));
        btn.lastChild.textContent = `Split into ${rows * cols} pins`;
        btn.disabled = rows * cols < 2;
      };
      const btn = h('button', { class: 'btn primary wide', onclick: () => { sheet.close(); onSplit(rows, cols); } }, icon('split'), h('span', {}, ''));
      const rowsStep = h('div');
      const colsStep = h('div');
      const renderSteppers = () => {
        set(rowsStep, stepper('Rows', rows, 1, 8, (v) => { rows = v; drawLines(); }));
        set(colsStep, stepper('Columns', cols, 1, 8, (v) => { cols = v; drawLines(); }));
      };
      img.addEventListener('load', () => {
        const a = img.naturalWidth / img.naturalHeight;
        if (initial) { rows = initial.rows; cols = initial.cols; }
        else if (a >= 1.4) { rows = 1; cols = Math.max(2, Math.min(8, Math.round(a))); }
        else if (a <= 0.7) { cols = 1; rows = Math.max(2, Math.min(8, Math.round(1 / a))); }
        else { rows = 2; cols = 2; }
        renderSteppers();
        drawLines();
      });
      renderSteppers();
      drawLines();
      return h('div', { class: 'pad stack' },
        h('div', { class: 'split-wrap' }, img, lines),
        h('p', { class: 'small muted' }, 'Set rows and columns so each yellow cell holds one pin. Each cell becomes its own pin and is matched separately.'),
        h('div', { class: 'card' }, rowsStep, colsStep),
        btn);
    },
  });
  return sheet;
}

// ---------- add a pin that isn't on a board (chasers etc.) ----------

export function openAddFromPhotoSheet(seriesKey) {
  const series = state.series.get(seriesKey);
  let scan = null, name = '', group = '', kind = 'chaser', owned = true;
  const sheet = openSheet({
    title: `Add to ${C.shortName(series)}`,
    build: (api) => {
      const body = h('div', { class: 'pad stack' });
      const render = () => {
        const nameInput = h('input', { class: 'input', value: name, placeholder: 'Name (optional)' });
        nameInput.addEventListener('input', () => { name = nameInput.value; });
        const groupInput = h('input', { class: 'input', value: group, placeholder: 'Theme (optional)' });
        groupInput.addEventListener('input', () => { group = groupInput.value; });
        set(body, 
          scan ? h('div', { class: 'center' }, h('div', { class: 'thumb xl' }, h('img', { src: URL.createObjectURL(scan.blob) }))) : null,
          h('p', { class: 'small muted' }, 'Photograph one pin on a plain background. Use this for chasers and super chasers — they usually aren\'t on the set photos.'),
          photoButton(scan ? 'Retake photo' : 'Take or choose photo', async (file) => {
            body.append(spinner('Finding the pin…'));
            const canvas = await V.blobToCanvas(file, 2000);
            [scan] = await V.scanCanvas(canvas, [V.mainPinRect(canvas)]);
            render();
          }),
          h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
          h('label', { class: 'field' }, h('span', {}, 'Theme'), groupInput),
          (series.themes || []).length ? h('div', { class: 'chips' }, series.themes.map((t) => h('button', { class: 'chip' + (group === t ? ' on' : ''), onclick: () => { group = t; render(); } }, t))) : null,
          h('div', { class: 'field' }, h('span', {}, 'Type'), segmented(KINDS.map(([k, l]) => [k, l.replace('Super Chaser', 'Super')]), kind, (k) => { kind = k; render(); })),
          h('label', { class: 'row card' }, h('span', { class: 'grow' }, 'I own this pin'),
            h('input', { type: 'checkbox', class: 'toggle', checked: owned, onchange: (e) => { owned = e.target.checked; } })),
          h('button', {
            class: 'btn primary wide', disabled: !scan, onclick: async () => {
              const label = KINDS.find(([k]) => k === kind)[1];
              const slot = await db.addSlot({
                seriesKey, name: name.trim() || `${label} ${db.slotsOfSeries(seriesKey).length + 1}`,
                group: group.trim(), kind, owned: owned ? 1 : 0, edited: true,
              });
              await db.addRef(slot.id, { blob: scan.blob, basic: scan.basic, ml: scan.ml, user: true });
              toast('Pin added');
              api.close();
            },
          }, 'Save pin'));
      };
      render();
      return body;
    },
  });
  return sheet;
}

// ---------- find a pin on a board ----------

/** query: {basic, ml}; cropURL: your pin; onPick(slot) */
export function openBoardPicker({ query, cropURL, onPick }) {
  const index = C.buildIndex();
  const bestBySeries = new Map();
  for (const m of C.matchesFor(index, query, 600)) {
    const k = m.slot.seriesKey;
    if (!bestBySeries.has(k) || m.d < bestBySeries.get(k)) bestBySeries.set(k, m.d);
  }
  const ranked = [...bestBySeries.entries()].sort((a, b) => a[1] - b[1]);
  const t = C.threshold();
  let likelyKeys = [];
  if (ranked.length >= 3) {
    const typical = ranked[ranked.length >> 1][1];
    if (ranked[0][1] < t || ranked[0][1] < typical * 0.8) {
      likelyKeys = ranked.slice(0, 3).filter(([, d]) => d < t || d < typical * 0.85).map(([k]) => k);
    }
  }

  let search = '';
  const sheet = openSheet({
    title: 'Find on a board',
    build: (api) => {
      const list = h('div');
      const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Search year, wave or park' });
      searchInput.addEventListener('input', () => { search = searchInput.value.toLowerCase(); renderList(); });

      const boardRow = (b, highlight) => {
        const s = state.series.get(b.seriesKey);
        const d = bestBySeries.get(b.seriesKey);
        return h('button', { class: 'list-row', onclick: () => showBoard(b) },
          h('div', { class: 'thumb sm' }, h('img', { src: db.blobURL(b.blob), alt: '' })),
          h('div', { class: 'grow' }, h('div', { class: 'bold' }, s.title), h('div', { class: 'small muted' }, b.label)),
          highlight && d != null && d < t * 0.75 ? h('span', { class: 'pill green' }, 'Good match') : null,
          icon('chev', 'muted'));
      };

      const renderList = () => {
        const boards = db.seriesList().flatMap((s) => db.boardsOf(s.key).filter((b) => b.blob))
          .filter((b) => !search || `${state.series.get(b.seriesKey).title} ${b.label}`.toLowerCase().includes(search));
        const likely = boards.filter((b) => likelyKeys.includes(b.seriesKey))
          .sort((a, b) => likelyKeys.indexOf(a.seriesKey) - likelyKeys.indexOf(b.seriesKey));
        const others = boards.filter((b) => !likelyKeys.includes(b.seriesKey));
        const noPhoto = db.seriesList().filter((s) => !db.boardsOf(s.key).some((b) => b.blob));
        set(list, 
          likely.length ? h('div', { class: 'section-title' }, 'Most likely') : null,
          likely.length ? h('div', { class: 'list' }, likely.map((b) => boardRow(b, true))) : null,
          h('div', { class: 'section-title' }, likely.length ? 'All other boards' : 'All boards'),
          boards.length ? h('div', { class: 'list' }, others.map((b) => boardRow(b, false)))
            : h('p', { class: 'muted small' }, 'No board photos on this phone yet. Go to Settings → Download set photos.'),
          !likely.length && ranked.length ? h('p', { class: 'small muted' }, 'No board stands out for this pin yet, so boards are listed newest first. The more pins you pick this way, the better PinVault gets at suggesting the right one.') : null,
          noPhoto.length && !search ? h('div', { class: 'section-title' }, 'No board photo') : null,
          noPhoto.length && !search ? h('div', { class: 'list' }, noPhoto.map((s) => h('div', { class: 'list-row muted' }, s.title))) : null,
        );
      };

      const listView = h('div', { class: 'pad stack' },
        h('div', { class: 'row' }, h('div', { class: 'thumb md' }, h('img', { src: cropURL })),
          h('div', { class: 'small muted grow' }, 'Choose the set photo your pin is on, then tap the pin on it. PinVault will recognise this pin by itself from now on.')),
        searchInput, list);

      const showBoard = (board) => {
        api.setLeft(h('button', { class: 'btn-text', onclick: () => { api.setLeft(null); api.setTitle('Find on a board'); api.setContent(listView); } }, icon('back'), 'Back'));
        api.setTitle(`${C.tinyName(state.series.get(board.seriesKey))} ${board.label}`);
        // best guesses on this board
        const scored = db.slotsOfBoard(board.id).map((s) => {
          const refs = db.refsOf(s.id).filter((r) => r.basic);
          return { s, d: refs.length ? Math.min(...refs.map((r) => V.distance(query, r))) : Infinity };
        }).filter((x) => Number.isFinite(x.d)).sort((a, b) => a.d - b.d).slice(0, 3);
        const best = scored.map((x) => x.s.id);
        const boxes = db.slotsOfBoard(board.id).map((s) => ({
          id: s.id, rect: s.rect, color: best.includes(s.id) ? '#facc15' : '#60a5fa',
          label: best[0] === s.id ? 'Best guess' : '', dim: best.length > 0 && !best.includes(s.id),
        }));
        const working = h('div');
        const ann = annotator({
          key: 'pick-' + board.id, src: db.blobURL(board.blob), boxes, height: '58vh',
          onTapBox: (id) => { const s = state.slots.get(id); if (s) { sheet.close(); onPick(s); } },
          onDraw: async (rect) => {
            set(working, spinner('Adding…'));
            const [s] = await C.addBoxes(board, [rect]);
            sheet.close();
            onPick(s);
          },
          onPoint: async (x, y) => {
            set(working, spinner('Finding that pin…'));
            const canvas = await V.blobToCanvas(board.blob, 2400);
            const [s] = await C.addBoxes(board, [V.pinAt(canvas, x, y)]);
            sheet.close();
            onPick(s);
          },
        });
        api.setContent(h('div', { class: 'pad stack' },
          h('div', { class: 'row' }, h('div', { class: 'thumb sm' }, h('img', { src: cropURL })),
            h('div', { class: 'small grow' }, boxes.length
              ? 'Tap the box around the pin that matches yours. Yellow = best guesses. Not boxed? Tap Box a pin, then tap it.'
              : 'Tap Box a pin, then tap the pin that matches yours.')),
          ann.el, working));
      };

      renderList();
      return listView;
    },
  });
  return sheet;
}

/** Sheet listing the closest catalog pins for a scanned pin. */
export function openMatchesSheet({ pin, onChoose, onFind, onNone, onSplit, extra }) {
  openSheet({
    title: 'Pin details',
    build: (api) => h('div', { class: 'pad stack' },
      h('div', { class: 'center' }, h('div', { class: 'thumb xl' }, h('img', { src: pin.url }))),
      onSplit ? h('button', { class: 'btn wide', onclick: () => { api.close(); onSplit(); } }, icon('split'), h('span', {}, 'This box covers several pins — split it')) : null,
      h('div', { class: 'section-title' }, 'Best matches'),
      pin.matches.length ? h('div', { class: 'list' }, pin.matches.map((m, i) => {
        const conf = C.confidence(m.d, i === 0 ? pin.matches : null);
        const s = m.slot;
        const ref = db.thumbRef(s);
        return h('button', { class: 'list-row' + (pin.chosen === i ? ' selected' : ''), onclick: () => { api.close(); onChoose(i); } },
          h('div', { class: 'thumb sm' }, ref ? h('img', { src: db.blobURL(ref.blob) }) : null),
          h('div', { class: 'grow' },
            h('div', { class: 'row tight' }, h('span', { class: 'bold' }, s.name), kindBadge(s.kind)),
            h('div', { class: 'small' }, C.shortName(state.series.get(s.seriesKey)), s.group ? ' · ' + s.group : ''),
            h('div', { class: 'small' }, h('span', { class: 'txt-' + conf.cls }, m.picked ? 'You picked' : conf.label), ' · ',
              s.owned ? h('span', { class: 'txt-green' }, `Have ×${s.owned}`) : h('span', { class: 'txt-red' }, 'Need'))),
          pin.chosen === i ? icon('check', 'txt-accent') : null);
      })) : h('p', { class: 'muted' }, 'Nothing in your catalog looks like this pin yet.'),
      h('button', { class: 'btn wide', onclick: () => { api.close(); onFind(); } }, icon('hand'), h('span', {}, 'Find on a board…')),
      onNone ? h('button', { class: 'btn-text danger', onclick: () => { api.close(); onNone(); } }, 'None of these') : null,
      extra ? extra(api) : null),
  });
}
