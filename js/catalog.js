// Catalog setup: series, board photos, automatic pin boxes, shared layouts, backups and matching.
import * as db from './db.js';
import { state } from './db.js';
import { SERIES } from './seed.js';
import * as V from './vision.js';

// ---------- status shown in the UI ----------
export const status = { running: false, phase: '', done: 0, total: 0, note: '' };
function setStatus(fields) { Object.assign(status, fields); db.changed(); }

// ---------- seeding ----------
export async function seed() {
  for (const [i, s] of SERIES.entries()) {
    const existing = state.series.get(s.key);
    if (!existing) {
      await db.put('series', { key: s.key, year: s.year, wave: s.wave, title: s.title, url: s.url, themes: s.themes, order: i });
    } else if (!existing.themes || !existing.themes.length) {
      existing.themes = s.themes;
      await db.put('series', existing);
    }
    const haveUrls = new Set(db.boardsOf(s.key).map((b) => b.url));
    for (const b of s.boards) {
      if (haveUrls.has(b.url)) continue;
      await db.put('boards', { seriesKey: s.key, label: b.label, url: b.url, blob: null, autoScanned: false, error: '', createdAt: Date.now() + Math.random() });
    }
  }
}

export const shortName = (s) => (s ? `${s.year} · ${s.wave}` : '');
/** Very short label for boxes on photos, e.g. '26 A, '22 S2. */
export function tinyName(s) {
  if (!s) return '';
  const yy = "'" + String(s.year).slice(2);
  const w = s.wave.replace(/^Wave /, '').replace(/^Series (\d+)$/, 'S$1').replace(/^Series$/, '').replace(/^\d{4}–(\d+)$/, '–$1');
  return w ? `${yy} ${w}`.replace(' –', '–') : yy;
}

// ---------- board photos ----------

/** Downloads board photos from the blog's image server (one time per phone). */
export async function downloadBoards({ onlyMissing = true } = {}) {
  const boards = [...state.boards.values()].filter((b) => b.url && (!onlyMissing || !b.blob));
  if (!boards.length) return { ok: 0, failed: 0 };
  setStatus({ running: true, phase: 'Downloading set photos', done: 0, total: boards.length });
  let ok = 0, failed = 0;
  for (const b of boards) {
    try {
      const res = await fetch(b.url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not an image');
      b.blob = blob; b.error = ''; b.autoScanned = b.autoScanned && false;
      await db.put('boards', b);
      ok++;
    } catch (e) {
      b.error = navigator.onLine === false ? 'offline' : 'blocked';
      await db.put('boards', b);
      failed++;
    }
    setStatus({ done: status.done + 1 });
  }
  setStatus({ running: false, phase: '' });
  return { ok, failed };
}

export async function setBoardImage(board, file) {
  const canvas = await V.blobToCanvas(file, 3000);
  board.blob = await V.canvasToBlob(canvas, 'image/jpeg', 0.9);
  board.error = '';
  board.autoScanned = false;
  await db.put('boards', board);
}

export async function addOwnBoard(seriesKey, file) {
  const canvas = await V.blobToCanvas(file, 3000);
  const blob = await V.canvasToBlob(canvas, 'image/jpeg', 0.9);
  const n = db.boardsOf(seriesKey).length + 1;
  return db.put('boards', { seriesKey, label: `My photo ${n}`, url: '', blob, autoScanned: false, error: '', createdAt: Date.now() });
}

// ---------- automatic boxes ----------
const DETECTOR_VERSION = 1;

/** Boxes the pins on every board photo that hasn't been done yet, and makes sure every box has a crop. */
export async function autoCatalog() {
  if (status.running) return;
  if (db.getMeta('detectorVersion', 0) < DETECTOR_VERSION) {
    await resetAutoBoxes(false);
    await db.setMeta('detectorVersion', DETECTOR_VERSION);
  }
  const boards = [...state.boards.values()].filter((b) => b.blob && (!b.autoScanned || needsRefs(b)));
  if (!boards.length) return;
  setStatus({ running: true, phase: 'Finding pins on board photos', done: 0, total: boards.length });
  for (const board of boards) {
    try {
      const canvas = await V.blobToCanvas(board.blob, 2400);
      if (!board.autoScanned && !board.fromLayout) {
        const existing = db.slotsOfBoard(board.id).map((s) => s.rect);
        const rects = V.detectPins(canvas)
          .filter((r) => r.w * r.h < 0.3)
          .filter((r) => !existing.some((e) => e && V.iou(e, r) > 0.3));
        let n = existing.length;
        for (const rect of rects) {
          n++;
          const slot = await db.addSlot({ seriesKey: board.seriesKey, boardId: board.id, rect, name: `${board.label} #${n}` });
          await makeBoardRef(slot, canvas);
        }
      }
      // Boxes that came from a shared layout (or older versions) still need their crops.
      for (const slot of db.slotsOfBoard(board.id)) {
        if (slot.rect && !db.refsOf(slot.id).some((r) => !r.user)) await makeBoardRef(slot, canvas);
      }
      board.autoScanned = true;
      await db.put('boards', board);
    } catch (e) {
      console.warn('auto-catalog failed for board', board.label, e);
    }
    setStatus({ done: status.done + 1 });
    await new Promise((r) => setTimeout(r, 0));
  }
  setStatus({ running: false, phase: '' });
}

function needsRefs(board) {
  return db.slotsOfBoard(board.id).some((s) => s.rect && !db.refsOf(s.id).some((r) => !r.user));
}

export async function makeBoardRef(slot, boardCanvas) {
  const c = V.crop(boardCanvas, slot.rect);
  const desc = V.describe(c);
  const blob = await V.canvasToBlob(c);
  for (const r of db.refsOf(slot.id)) if (!r.user) await db.remove('refs', r.id);
  return db.addRef(slot.id, { blob, basic: desc.basic, ml: desc.ml, user: false });
}

/** Adds boxes on a board image (used by the board editor and Find on a board). */
export async function addBoxes(board, rects, fields = {}) {
  const canvas = await V.blobToCanvas(board.blob, 2400);
  const made = [];
  let n = db.slotsOfBoard(board.id).length;
  for (const rect of rects) {
    n++;
    const slot = await db.addSlot({ seriesKey: board.seriesKey, boardId: board.id, rect, name: `${board.label} #${n}`, ...fields });
    await makeBoardRef(slot, canvas);
    made.push(slot);
  }
  return made;
}

export async function splitSlot(slot, rows, cols) {
  const board = state.boards.get(slot.boardId);
  if (!board || !board.blob || !slot.rect) return [];
  const rects = V.gridRects(slot.rect, rows, cols);
  const { group, kind } = slot;
  await db.deleteSlot(slot);
  return addBoxes(board, rects, { group, kind, edited: !!group || kind !== 'regular' });
}

const untouched = (s) => !s.edited && !s.owned && !db.refsOf(s.id).some((r) => r.user);

/** Removes automatic boxes you haven't touched and boxes every board again. */
export async function resetAutoBoxes(run = true) {
  for (const board of state.boards.values()) {
    if (board.fromLayout) continue;
    for (const s of db.slotsOfBoard(board.id)) if (untouched(s)) await db.deleteSlot(s);
    board.autoScanned = false;
    await db.put('boards', board);
  }
  if (run) await autoCatalog();
}

/** Recompute every fingerprint (e.g. once the smarter model has loaded). */
export async function rebuildFingerprints({ onlyMissingML = false } = {}) {
  const refs = [...state.refs.values()].filter((r) => r.blob && (!onlyMissingML || !r.ml));
  if (!refs.length) return 0;
  const was = status.running;
  if (!was) setStatus({ running: true, phase: 'Updating fingerprints', done: 0, total: refs.length });
  let n = 0;
  for (const r of refs) {
    try {
      const c = await V.blobToCanvas(r.blob, 256);
      const d = V.describe(c);
      r.basic = d.basic;
      if (d.ml) r.ml = d.ml;
      await db.put('refs', r);
      n++;
    } catch { /* skip */ }
    if (!was) setStatus({ done: status.done + 1 });
  }
  if (!was) setStatus({ running: false, phase: '' });
  return n;
}

// ---------- matching ----------

export function buildIndex() {
  const bySlot = new Map();
  for (const r of state.refs.values()) {
    if (!r.basic) continue;
    const slot = state.slots.get(r.slotId);
    if (!slot) continue;
    if (!bySlot.has(slot.id)) bySlot.set(slot.id, { slot, refs: [] });
    bySlot.get(slot.id).refs.push(r);
  }
  return [...bySlot.values()];
}

export function matchesFor(index, query, limit = 5) {
  if (!query || !query.basic) return [];
  const scored = index.map(({ slot, refs }) => ({ slot, d: Math.min(...refs.map((r) => V.distance(query, r))) }));
  return scored.filter((m) => Number.isFinite(m.d)).sort((a, b) => a.d - b.d).slice(0, limit);
}

export function threshold() { return Number(localStorage.getItem('pv.threshold') || 0.58); }
export function setThreshold(v) { localStorage.setItem('pv.threshold', String(v)); }

export function confidence(d) {
  const t = threshold();
  if (d < t * 0.75) return { label: 'Strong match', cls: 'green' };
  if (d < t) return { label: 'Likely', cls: 'blue' };
  return { label: 'Unsure', cls: 'gray' };
}

// ---------- shared layout (boxes, names, themes — no images) ----------

export function exportLayout() {
  const boards = [];
  for (const b of state.boards.values()) {
    if (!b.url) continue;
    const slots = db.slotsOfBoard(b.id).filter((s) => s.rect).map((s) => ({
      uid: s.uid, rect: [s.rect.x, s.rect.y, s.rect.w, s.rect.h].map((v) => +v.toFixed(4)),
      name: s.name, group: s.group, kind: s.kind,
    }));
    if (slots.length) boards.push({ url: b.url, seriesKey: b.seriesKey, label: b.label, slots });
  }
  const extras = db.allSlots().filter((s) => !s.boardId).map((s) => ({ uid: s.uid, seriesKey: s.seriesKey, name: s.name, group: s.group, kind: s.kind }));
  return { app: 'PinVault', type: 'layout', version: Date.now(), boards, extras };
}

export async function importLayout(json) {
  if (!json || json.type !== 'layout') throw new Error('This file is not a PinVault layout.');
  let added = 0, updated = 0;
  const byUid = new Map(db.allSlots().map((s) => [s.uid, s]));
  for (const lb of json.boards || []) {
    let board = [...state.boards.values()].find((b) => b.url === lb.url);
    if (!board) {
      if (!state.series.has(lb.seriesKey)) continue;
      board = await db.put('boards', { seriesKey: lb.seriesKey, label: lb.label, url: lb.url, blob: null, autoScanned: false, error: '', createdAt: Date.now() });
    }
    const keep = new Set(lb.slots.map((s) => s.uid));
    // Untouched automatic boxes are replaced by the shared ones.
    for (const s of db.slotsOfBoard(board.id)) if (!keep.has(s.uid) && untouched(s)) await db.deleteSlot(s);
    for (const ls of lb.slots) {
      const rect = { x: ls.rect[0], y: ls.rect[1], w: ls.rect[2], h: ls.rect[3] };
      const existing = byUid.get(ls.uid);
      if (existing) {
        const moved = !existing.rect || V.iou(existing.rect, rect) < 0.98;
        await db.updateSlot(existing, { name: ls.name, group: ls.group || '', kind: ls.kind || 'regular', rect }, { markEdited: false });
        if (moved) for (const r of db.refsOf(existing.id)) if (!r.user) await db.remove('refs', r.id);
        updated++;
      } else {
        await db.addSlot({ uid: ls.uid, seriesKey: board.seriesKey, boardId: board.id, rect, name: ls.name, group: ls.group || '', kind: ls.kind || 'regular' });
        added++;
      }
    }
    board.fromLayout = true;
    board.autoScanned = true;
    await db.put('boards', board);
  }
  for (const ex of json.extras || []) {
    if (byUid.has(ex.uid) || !state.series.has(ex.seriesKey)) continue;
    await db.addSlot({ uid: ex.uid, seriesKey: ex.seriesKey, name: ex.name, group: ex.group || '', kind: ex.kind || 'regular' });
    added++;
  }
  return { added, updated };
}

/** If the website has a newer shared layout (layout.json), apply it. */
export async function checkSiteLayout() {
  try {
    const res = await fetch('layout.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.version || json.version <= db.getMeta('layoutVersion', 0)) return null;
    const r = await importLayout(json);
    await db.setMeta('layoutVersion', json.version);
    return r;
  } catch {
    return null;
  }
}

// ---------- personal backup (what you own + your photos) ----------

async function blobToDataURL(blob) {
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
}

export async function exportBackup() {
  const slots = [];
  for (const s of db.allSlots()) {
    const photos = [];
    for (const r of db.refsOf(s.id)) if (r.user && r.blob) photos.push(await blobToDataURL(r.blob));
    if (!s.owned && !photos.length && !s.edited && s.boardId) continue;
    const board = s.boardId ? state.boards.get(s.boardId) : null;
    slots.push({
      uid: s.uid, owned: s.owned, name: s.name, group: s.group, kind: s.kind, seriesKey: s.seriesKey,
      boardUrl: board ? board.url : '', rect: s.rect, photos,
    });
  }
  return { app: 'PinVault', type: 'backup', version: Date.now(), slots };
}

export async function importBackup(json) {
  if (!json || json.type !== 'backup') throw new Error('This file is not a PinVault backup.');
  const byUid = new Map(db.allSlots().map((s) => [s.uid, s]));
  let restored = 0;
  for (const b of json.slots || []) {
    let slot = byUid.get(b.uid);
    if (!slot && b.boardUrl && b.rect) {
      const board = [...state.boards.values()].find((x) => x.url === b.boardUrl);
      if (board) {
        slot = db.slotsOfBoard(board.id).find((s) => s.rect && V.iou(s.rect, b.rect) > 0.6);
        if (!slot) slot = await db.addSlot({ uid: b.uid, seriesKey: board.seriesKey, boardId: board.id, rect: b.rect, name: b.name });
      }
    }
    if (!slot && state.series.has(b.seriesKey)) slot = await db.addSlot({ uid: b.uid, seriesKey: b.seriesKey, name: b.name });
    if (!slot) continue;
    await db.updateSlot(slot, { owned: b.owned || 0, name: b.name, group: b.group || '', kind: b.kind || 'regular' }, { markEdited: true });
    const have = db.refsOf(slot.id).filter((r) => r.user).length;
    if (!have) {
      for (const p of b.photos || []) {
        const blob = await (await fetch(p)).blob();
        const c = await V.blobToCanvas(blob, 256);
        const d = V.describe(c);
        await db.addRef(slot.id, { blob, basic: d.basic, ml: d.ml, user: true });
      }
    }
    restored++;
  }
  await autoCatalog();
  return restored;
}
