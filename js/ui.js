// Tiny DOM helpers, sheets, toasts and icons.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

/** Replace an element's children (accepts arrays, nulls and strings like h()). */
export function set(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const icon = (name, cls = '') => {
  const span = document.createElement('span');
  span.className = 'ico ' + cls;
  span.innerHTML = ICONS[name] || '';
  return span;
};

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS = {
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  scan: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chev: svg('<path d="M9 18l6-6-6-6"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>', 'stroke-width="3"'),
  star: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z"/></svg>`,
  sparkles: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8zM18 13l.9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9z"/></svg>`,
  seal: svg('<path d="M12 2l2.4 2.1 3.1-.4.9 3 2.8 1.5-1 3 1 3-2.8 1.5-.9 3-3.1-.4L12 22l-2.4-2.1-3.1.4-.9-3-2.8-1.5 1-3-1-3 2.8-1.5.9-3 3.1.4z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'),
  box: svg('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>'),
  wand: svg('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>'),
  video: svg('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  split: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  upload: svg('<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>'),
  link: svg('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  swap: svg('<path d="M7 7h13l-4-4M17 17H4l4 4"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>', 'stroke-width="3"'),
  play: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>`,
  shutter: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" fill="currentColor"/>'),
  flash: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V12M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.6 15a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  share: svg('<path d="M12 3v13M7 8l5-5 5 5M5 12v8h14v-8"/>'),
};

// ---------- toast ----------
let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- bottom sheets ----------
const sheetStack = [];

/**
 * Opens a sheet. `build(api)` returns the sheet's content; api has close(), setContent(node), setTitle(t).
 * Returns the api.
 */
export function openSheet({ title = '', build, onClose, tall = true }) {
  const root = document.getElementById('sheets');
  const titleEl = h('div', { class: 'sheet-title' }, title);
  const body = h('div', { class: 'sheet-body' });
  const leftSlot = h('div', { class: 'sheet-left' });
  const closeBtn = h('button', { class: 'btn-text', onclick: () => api.close() }, 'Done');
  const panel = h('div', { class: 'sheet-panel' + (tall ? ' tall' : '') },
    h('div', { class: 'sheet-head' }, leftSlot, titleEl, h('div', { class: 'sheet-right' }, closeBtn)),
    body);
  const wrap = h('div', { class: 'sheet-wrap' }, h('div', { class: 'sheet-dim', onclick: () => api.close() }), panel);
  const api = {
    el: panel,
    body,
    closed: false,
    close(result) {
      if (api.closed) return;
      api.closed = true;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
      const i = sheetStack.indexOf(api);
      if (i >= 0) sheetStack.splice(i, 1);
      onClose && onClose(result);
    },
    setContent(node) { set(body, node); body.scrollTop = 0; },
    setTitle(t) { titleEl.textContent = t; },
    setLeft(node) { set(leftSlot, node); },
    setDoneLabel(t) { closeBtn.textContent = t; },
  };
  root.append(wrap);
  sheetStack.push(api);
  requestAnimationFrame(() => wrap.classList.add('open'));
  try {
    const content = build(api);
    if (content) body.append(content);
  } catch (e) {
    console.error(e);
    body.append(h('div', { class: 'pad stack' },
      h('div', { class: 'bold txt-orange' }, 'Something went wrong here'),
      h('div', { class: 'small mono' }, String(e && (e.stack || e.message) || e).slice(0, 600)),
      h('div', { class: 'small muted' }, 'Please send a screenshot of this to get it fixed.')));
  }
  return api;
}

export function confirmSheet(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet({
      title: '', tall: false,
      onClose: () => { if (!done) resolve(false); },
      build: () => h('div', { class: 'pad stack' },
        h('p', {}, message),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary') + ' wide', onclick: () => { done = true; resolve(true); s.close(); } }, okLabel),
        h('button', { class: 'btn wide', onclick: () => { s.close(); } }, 'Cancel')),
    });
  });
}

// ---------- form bits ----------
export function segmented(options, value, onPick) {
  const el = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    el.append(h('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label));
  }
  return el;
}

export function stepper(label, value, min, max, onChange) {
  const val = h('span', { class: 'step-val' }, String(value));
  let v = value;
  const set = (n) => { v = Math.max(min, Math.min(max, n)); val.textContent = String(v); onChange(v); };
  return h('div', { class: 'row stepper' },
    h('span', { class: 'grow' }, label),
    h('button', { class: 'btn round', onclick: () => set(v - 1) }, icon('minus')),
    val,
    h('button', { class: 'btn round', onclick: () => set(v + 1) }, icon('plus')));
}

/** A button that opens the camera / photo picker and calls onFile(File). */
export function photoButton(label, onFile, cls = 'btn primary', iconName = 'camera') {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden-input' });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) onFile(f);
  });
  return h('label', { class: cls }, icon(iconName), h('span', {}, label), input);
}

export function fileButton(label, accept, onFile, cls = 'btn') {
  const input = h('input', { type: 'file', accept, class: 'hidden-input' });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) onFile(f);
  });
  return h('label', { class: cls }, h('span', {}, label), input);
}

export function downloadFile(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function kindBadge(kind) {
  if (!kind || kind === 'regular') return null;
  const labels = { completer: 'Completer', chaser: 'Chaser', superChaser: 'Super Chaser' };
  return h('span', { class: 'badge ' + (kind === 'completer' ? 'purple' : 'orange') },
    icon(kind === 'completer' ? 'seal' : kind === 'chaser' ? 'star' : 'sparkles'), labels[kind]);
}

export const KINDS = [['regular', 'Regular'], ['completer', 'Completer'], ['chaser', 'Chaser'], ['superChaser', 'Super Chaser']];
export const isChase = (k) => k === 'chaser' || k === 'superChaser';

export function progressBar(value, total, color) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: pct + '%', background: color || '' } }));
}

export function spinner(label) {
  return h('div', { class: 'row muted' }, h('span', { class: 'spin' }), label ? h('span', {}, label) : null);
}
