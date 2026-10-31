// Local database (IndexedDB) with an in-memory copy for fast access.
// Everything lives on this device only.

const DB_NAME = 'pinvault';
const DB_VERSION = 1;
const STORES = ['series', 'boards', 'slots', 'refs', 'meta'];

let idb = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('series')) db.createObjectStore('series', { keyPath: 'key' });
      for (const name of ['boards', 'slots', 'refs']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// iPhones close the database connection when the app sits in the background,
// so reopen it whenever it's gone and retry the operation once.
let opening = null;
async function connection(force = false) {
  if (idb && !force) return idb;
  if (!opening) {
    opening = openDB().then((d) => {
      d.onclose = () => { if (idb === d) idb = null; };
      d.onversionchange = () => { d.close(); if (idb === d) idb = null; };
      idb = d;
      return d;
    }).finally(() => { opening = null; });
  }
  return opening;
}

async function tx(storeName, mode, fn) {
  try {
    return await txOnce(await connection(), storeName, mode, fn);
  } catch (e) {
    if (e && (e.name === 'InvalidStateError' || /clos/i.test(e.message || ''))) {
      idb = null;
      return txOnce(await connection(true), storeName, mode, fn);
    }
    throw e;
  }
}

function txOnce(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getAll = (name) => tx(name, 'readonly', (s) => s.getAll());
const putRaw = (name, obj) => tx(name, 'readwrite', (s) => s.put(obj));
const delRaw = (name, key) => tx(name, 'readwrite', (s) => s.delete(key));

// ---------- in-memory state ----------

export const state = {
  series: new Map(),  // key -> series
  boards: new Map(),  // id -> board {id, seriesKey, label, url, blob, autoScanned, error, createdAt}
  slots: new Map(),   // id -> slot {id, uid, seriesKey, boardId, rect, name, group, kind, owned, edited, createdAt}
  refs: new Map(),    // id -> ref {id, slotId, blob, basic, ml, user, createdAt}
  meta: new Map(),
};

const listeners = new Set();
let pending = false;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function changed() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => { pending = false; listeners.forEach((fn) => fn()); });
}

export async function init() {
  await connection();
  for (const name of STORES) {
    const rows = await getAll(name);
    const map = state[name];
    for (const row of rows) map.set(name === 'series' || name === 'meta' ? row.key : row.id, row);
  }
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ---------- generic ----------

export async function put(name, obj) {
  const id = await putRaw(name, obj);
  if (name === 'series' || name === 'meta') state[name].set(obj.key, obj);
  else { obj.id = id; state[name].set(id, obj); }
  changed();
  return obj;
}

export async function remove(name, key) {
  await delRaw(name, key);
  state[name].delete(key);
  changed();
}

export function getMeta(key, fallback = null) {
  const m = state.meta.get(key);
  return m ? m.value : fallback;
}
export function setMeta(key, value) { return put('meta', { key, value }); }

// ---------- helpers ----------

export const seriesList = () => [...state.series.values()].sort((a, b) => a.order - b.order);
export const boardsOf = (seriesKey) =>
  [...state.boards.values()].filter((b) => b.seriesKey === seriesKey).sort((a, b) => a.createdAt - b.createdAt);
export const slotsOfSeries = (seriesKey) =>
  [...state.slots.values()].filter((s) => s.seriesKey === seriesKey).sort((a, b) => a.createdAt - b.createdAt);
export const slotsOfBoard = (boardId) =>
  [...state.slots.values()].filter((s) => s.boardId === boardId).sort((a, b) => a.createdAt - b.createdAt);
export const refsOf = (slotId) =>
  [...state.refs.values()].filter((r) => r.slotId === slotId).sort((a, b) => a.createdAt - b.createdAt);
export const allSlots = () => [...state.slots.values()];

export function thumbRef(slot) {
  const refs = refsOf(slot.id);
  return refs.find((r) => !r.user) || refs[0] || null;
}

export async function addSlot(fields) {
  const slot = {
    uid: uid(), seriesKey: null, boardId: null, rect: null, name: 'Pin', group: '', kind: 'regular',
    owned: 0, edited: false, createdAt: Date.now() + Math.random(), ...fields,
  };
  return put('slots', slot);
}

export async function updateSlot(slot, changes, { markEdited = true } = {}) {
  Object.assign(slot, changes);
  if (markEdited) slot.edited = true;
  return put('slots', slot);
}

export async function deleteSlot(slot) {
  for (const r of refsOf(slot.id)) await remove('refs', r.id);
  await remove('slots', slot.id);
}

export async function addRef(slotId, { blob, basic, ml = null, user = false }) {
  return put('refs', { slotId, blob, basic, ml, user, createdAt: Date.now() + Math.random() });
}

export async function eraseEverything() {
  if (idb) idb.close();
  idb = null;
  await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

// ---------- object URLs for blobs (cached) ----------
const urlCache = new WeakMap();
export function blobURL(blob) {
  if (!blob) return '';
  let u = urlCache.get(blob);
  if (!u) { u = URL.createObjectURL(blob); urlCache.set(blob, u); }
  return u;
}
