// Settings: matching, set photos, sharing layouts with friends, backups, install help.
import * as db from '../db.js';
import { state } from '../db.js';
import * as C from '../catalog.js';
import * as V from '../vision.js';
import { h, icon, toast, downloadFile, fileButton, confirmSheet, spinner } from '../ui.js';
import { catalogBanner } from './collection.js';

const rerender = () => window.dispatchEvent(new Event('hashchange'));
const local = { persisted: null };

export function settingsView() {
  const slots = db.allSlots();
  const boards = [...state.boards.values()];
  const withPhoto = boards.filter((b) => b.blob).length;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (local.persisted === null && navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => { local.persisted = p; rerender(); });
    local.persisted = 'checking';
  }

  const slider = h('input', { type: 'range', min: '0.35', max: '0.75', step: '0.01', value: String(C.threshold()), class: 'range' });
  const sliderVal = h('span', { class: 'mono muted' }, C.threshold().toFixed(2));
  slider.addEventListener('input', () => { C.setThreshold(Number(slider.value)); sliderVal.textContent = Number(slider.value).toFixed(2); });

  const mlLabel = {
    off: 'Off', loading: 'Loading…', ready: 'On', failed: 'Not available',
  }[V.ml.status];

  return h('div', { class: 'page' },
    h('header', { class: 'top' }, h('h1', {}, 'Settings')),
    catalogBanner(),

    !standalone ? h('div', { class: 'card stack tight accentbox' },
      h('div', { class: 'bold' }, icon('share'), ' Install on your Home Screen'),
      h('div', { class: 'small' }, 'In Safari tap the Share button, then “Add to Home Screen”. PinVault then opens full-screen with its own icon, works offline, and keeps your collection safe from Safari\'s automatic clean-up.')) : null,

    h('div', { class: 'section-title' }, 'Matching'),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Match strictness'), sliderVal),
      h('div', { class: 'row small muted' }, h('span', {}, 'Strict'), h('span', { class: 'grow' }), h('span', {}, 'Loose')),
      slider,
      h('div', { class: 'small muted' }, 'If PinVault labels the wrong pins, move toward Strict. If it says “No confident match” for pins you\'ve catalogued, move toward Loose. Adding your own photos to pins helps more than either.')),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Smart matching (image AI)'), h('span', { class: 'bold' }, mlLabel)),
      h('div', { class: 'small muted' }, 'A small image model from Google (MediaPipe) that improves matching. It downloads once (about 10 MB) and then works offline. Without it, PinVault uses its built-in colour-and-shape matcher.'),
      V.ml.status === 'failed' ? h('div', { class: 'small txt-orange' }, 'Couldn\'t load: ' + V.ml.error) : null,
      V.ml.status !== 'ready' && V.ml.status !== 'loading' ? h('button', { class: 'btn small', onclick: async () => {
        localStorage.setItem('pv.ml', 'on');
        await V.loadML();
        if (V.ml.status === 'ready') { toast('Smart matching is on'); await C.rebuildFingerprints({ onlyMissingML: true }); }
        rerender();
      } }, 'Turn on smart matching') : null,
      V.ml.status === 'ready' ? h('button', { class: 'btn small', onclick: () => { localStorage.setItem('pv.ml', 'off'); toast('Smart matching will be off next time you open PinVault'); } }, 'Turn off') : null),

    h('div', { class: 'card stack tight' },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Read pin names from checklists'),
        h('input', { type: 'checkbox', class: 'toggle', checked: localStorage.getItem('pv.ocr') !== 'off',
          onchange: (e) => { localStorage.setItem('pv.ocr', e.target.checked ? 'on' : 'off'); } })),
      h('div', { class: 'small muted' }, 'Newer set photos are printed checklists with each pin\'s name, “Chaser:” and the series title. PinVault reads those (a one-time ~5 MB download) so your pins get real names, themes and chaser marks. Names you\'ve typed yourself are never changed.'),
      h('button', { class: 'btn small', disabled: C.status.running, onclick: async () => {
        for (const s of db.allSlots()) if (s.labelRect && !s.edited && s.autoNamed) await db.updateSlot(s, { autoNamed: false }, { markEdited: false });
        await C.readNames();
        toast('Done reading names');
      } }, 'Read names again')),

    h('div', { class: 'section-title' }, 'Set photos'),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'On this phone'), h('span', { class: 'bold' }, `${withPhoto} of ${boards.length}`)),
      h('button', { class: 'btn small', disabled: C.status.running || withPhoto === boards.length, onclick: async () => {
        const r = await C.downloadBoards(); await C.autoCatalog();
        toast(r.failed ? `${r.ok} downloaded, ${r.failed} couldn't be — add those from the series page` : `Downloaded ${r.ok}`);
      } }, icon('download'), h('span', {}, 'Download missing set photos')),
      h('button', { class: 'btn small', disabled: C.status.running, onclick: async () => {
        if (await confirmSheet('Redo the automatic boxes on all set photos? Pins you\'ve marked owned, renamed, given a theme or photographed are kept.', 'Re-box')) await C.resetAutoBoxes(true);
      } }, icon('wand'), h('span', {}, 'Re-box pins on all set photos')),
      h('button', { class: 'btn small', disabled: C.status.running, onclick: async () => { const n = await C.rebuildFingerprints(); toast(`Updated ${n} fingerprints`); } }, 'Rebuild fingerprints'),
      h('div', { class: 'small muted' }, 'Set photos come from Disney Pins Blog and are downloaded by each phone for personal reference. PinVault only goes online to download set photos, the optional image AI, and shared layouts.')),

    h('div', { class: 'section-title' }, 'Share with friends'),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'small' }, 'Once you\'ve tidied up the boxes, names, themes and chasers, export the layout and upload it to the website as layout.json. Everyone\'s PinVault picks it up automatically. It contains no photos and nothing about what you own.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => downloadFile('layout.json', JSON.stringify(C.exportLayout())) }, icon('upload'), h('span', {}, 'Export layout')),
        fileButton('Import layout', 'application/json,.json', async (f) => {
          try { const r = await C.importLayout(JSON.parse(await f.text())); toast(`Layout: ${r.added} added, ${r.updated} updated`); await C.autoCatalog(); }
          catch (e) { toast(e.message || 'Couldn\'t read that file'); }
        }, 'btn small'))),

    h('div', { class: 'section-title' }, 'Backup'),
    h('div', { class: 'card stack tight' },
      h('div', { class: 'small' }, 'Your collection lives only on this phone. Save a backup now and then (to Files or iCloud Drive), and use it to move to a new phone.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: async () => {
          const b = await C.exportBackup();
          downloadFile(`pinvault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
        } }, icon('upload'), h('span', {}, 'Save backup')),
        fileButton('Restore backup', 'application/json,.json', async (f) => {
          try { const n = await C.importBackup(JSON.parse(await f.text())); toast(`Restored ${n} pins`); }
          catch (e) { toast(e.message || 'Couldn\'t read that file'); }
        }, 'btn small')),
      h('div', { class: 'small muted' }, local.persisted === true ? '✓ Storage is protected on this device.' : local.persisted === false ? 'Tip: install PinVault on your Home Screen so the browser keeps its storage.' : '')),

    h('div', { class: 'section-title' }, 'Catalog'),
    h('div', { class: 'card stack tight small' },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Pins catalogued'), h('b', {}, String(slots.length))),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Owned'), h('b', {}, String(slots.filter((s) => s.owned).length))),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Reference images'), h('b', {}, String(state.refs.size)))),

    h('div', { class: 'card stack tight small muted' },
      h('a', { href: 'https://disneypinsblog.com/pages/hidden-disney-pin-series', target: '_blank', rel: 'noopener' }, 'Hidden Disney series on Disney Pins Blog'),
      h('div', {}, 'PinVault is a fan-made tool, not affiliated with Disney or Disney Pins Blog.')),

    h('button', { class: 'btn-text danger', onclick: async () => {
      if (await confirmSheet('Erase PinVault on this phone? Your pins, photos and what you own will be deleted. Save a backup first if you want to keep them.', 'Erase everything', true)) {
        await db.eraseEverything();
        localStorage.clear();
        location.reload();
      }
    } }, 'Erase everything on this phone'));
}
