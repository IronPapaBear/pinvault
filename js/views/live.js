// Live scan: point the camera, boxes and NEED labels follow the pins.
import * as C from '../catalog.js?v=202610311136';
import * as V from '../vision.js?v=202610311136';
import { state } from '../db.js?v=202610311136';
import { set, h, icon, isChase } from '../ui.js?v=202610311136';

const COLORS = { need: '#ef4444', chaser: '#f97316', have: '#22c55e', unknown: 'rgba(255,255,255,.55)' };

export function openLive({ onFreeze }) {
  const video = h('video', { class: 'live-video', playsinline: true, muted: true, autoplay: true });
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  const layer = h('div', { class: 'live-layer' });
  const statusPill = h('div', { class: 'live-pill' }, 'Starting camera…');
  const counts = h('div', { class: 'live-counts' });
  const strip = h('div', { class: 'live-strip' });
  const msg = h('div', { class: 'live-msg' });
  const pauseBtn = h('button', { class: 'btn' });
  const freezeBtn = h('button', { class: 'btn primary' }, icon('shutter'), h('span', {}, 'Freeze & review'));
  const torchBtn = h('button', { class: 'live-round hidden' }, icon('flash'));
  const closeBtn = h('button', { class: 'live-round' }, icon('close'));

  const root = h('div', { class: 'live' }, video, layer,
    h('div', { class: 'live-top' }, closeBtn, statusPill, torchBtn),
    msg,
    h('div', { class: 'live-bottom' }, counts, strip, h('div', { class: 'row' }, pauseBtn, freezeBtn)));
  document.body.append(root);
  document.body.classList.add('no-scroll');

  let stream = null, timer = null, paused = false, closed = false, torch = false;
  let tracks = [];
  const index = C.buildIndex();
  const t = C.threshold();
  const work = V.makeCanvas(2, 2);
  let lastNeed = 0;

  const setPause = (p) => {
    paused = p;
    set(pauseBtn, icon(p ? 'play' : 'pause'), h('span', {}, p ? 'Resume' : 'Pause'));
    statusPill.textContent = p ? 'Paused' : 'Live — point at pins';
  };
  setPause(false);

  function close() {
    closed = true;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    root.remove();
    document.body.classList.remove('no-scroll');
  }
  closeBtn.onclick = close;
  pauseBtn.onclick = () => setPause(!paused);

  freezeBtn.onclick = () => {
    if (!video.videoWidth) return;
    const c = V.makeCanvas(video.videoWidth, video.videoHeight);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    close();
    onFreeze(c);
  };

  torchBtn.onclick = async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    torch = !torch;
    try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { /* unsupported */ }
    torchBtn.classList.toggle('on', torch);
  };

  if (!index.length) msg.textContent = 'Your catalog is empty, so pins show gray. Let the Collection tab set up the set photos first.';

  start();

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This browser can\'t use the camera here. Open PinVault from your Home Screen (or in Safari) over https.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      showError(e && e.name === 'NotAllowedError'
        ? 'PinVault doesn\'t have camera access. On iPhone: Settings → Safari → Camera → Allow (or tap “aA” in the address bar → Website Settings).'
        : 'Couldn\'t start the camera: ' + (e && e.message || e));
      return;
    }
    if (closed) { stream.getTracks().forEach((tr) => tr.stop()); return; }
    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay quirks */ }
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps && caps.torch) torchBtn.classList.remove('hidden');
    loop();
  }

  function showError(text) {
    statusPill.textContent = 'Camera unavailable';
    set(msg, h('div', {}, text), h('button', { class: 'btn', onclick: close }, 'Close'));
    msg.classList.add('error');
  }

  async function loop() {
    if (closed) return;
    const startT = performance.now();
    if (!paused && video.videoWidth) {
      try { await analyse(); } catch (e) { console.warn(e); }
    }
    const spent = performance.now() - startT;
    timer = setTimeout(loop, Math.max(120, 450 - spent));
  }

  async function analyse() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, 720 / Math.max(vw, vh));
    work.width = Math.round(vw * scale);
    work.height = Math.round(vh * scale);
    work.getContext('2d').drawImage(video, 0, 0, work.width, work.height);
    const rects = V.detectPins(work, { workSize: 300, gridSplit: false })
      .sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 14);
    const now = performance.now();
    const claimed = new Set();
    for (const rect of rects) {
      const c = V.crop(work, rect, 0.04, 160);
      const q = V.describe(c);
      const ms = C.matchesFor(index, q, 2);
      const best = C.isConfident(ms) ? ms[0] : null;
      let tr = null, bestIoU = 0.25;
      for (const x of tracks) {
        if (claimed.has(x)) continue;
        const o = V.iou(x.rect, rect);
        if (o > bestIoU) { bestIoU = o; tr = x; }
      }
      if (tr) {
        tr.rect = { x: tr.rect.x + (rect.x - tr.rect.x) * 0.6, y: tr.rect.y + (rect.y - tr.rect.y) * 0.6, w: tr.rect.w + (rect.w - tr.rect.w) * 0.6, h: tr.rect.h + (rect.h - tr.rect.h) * 0.6 };
        tr.hits++; tr.seen = now; tr.crop = c;
      } else {
        tr = { rect, hits: 1, seen: now, votes: new Map(), crop: c };
        tracks.push(tr);
      }
      if (best) tr.votes.set(best.slot.id, (tr.votes.get(best.slot.id) || 0) + 1);
      claimed.add(tr);
    }
    tracks = tracks.filter((x) => now - x.seen < 1300);
    render();
  }

  function winner(tr) {
    if (tr.hits < 2 || !tr.votes.size) return null;
    let best = null, n = 0;
    for (const [id, v] of tr.votes) if (v > n) { n = v; best = id; }
    return state.slots.get(best) || null;
  }
  function statusOf(tr) {
    const s = winner(tr);
    if (!s) return 'unknown';
    if (s.owned) return 'have';
    return isChase(s.kind) ? 'chaser' : 'need';
  }

  function render() {
    // Map frame coordinates into the cover-fitted video element.
    const vw = video.videoWidth, vh = video.videoHeight;
    const W = root.clientWidth, H = root.clientHeight;
    const sc = Math.max(W / vw, H / vh);
    const sw = vw * sc, sh = vh * sc, ox = (W - sw) / 2, oy = (H - sh) / 2;
    set(layer);
    let need = 0, chaser = 0, have = 0;
    set(strip);
    for (const tr of tracks) {
      const st = statusOf(tr);
      const slot = winner(tr);
      if (st === 'need') need++;
      if (st === 'chaser') { need++; chaser++; }
      if (st === 'have') have++;
      const box = h('div', {
        class: 'live-box' + (st === 'unknown' ? ' unknown' : ''),
        style: {
          left: ox + tr.rect.x * sw + 'px', top: oy + tr.rect.y * sh + 'px',
          width: tr.rect.w * sw + 'px', height: tr.rect.h * sh + 'px', '--c': COLORS[st],
        },
      }, slot && st !== 'unknown' ? h('span', { class: 'live-label' },
        st === 'have' ? '✓ Have' : `${st === 'chaser' ? '★ ' : ''}NEED ${C.tinyName(state.series.get(slot.seriesKey))}`) : null);
      layer.append(box);
      if ((st === 'need' || st === 'chaser') && slot) {
        strip.append(h('div', { class: 'live-chip' + (st === 'chaser' ? ' chaser' : '') },
          h('img', { src: tr.crop.toDataURL('image/jpeg', 0.6) }),
          h('span', {}, C.shortName(state.series.get(slot.seriesKey)))));
      }
    }
    set(counts, 
      h('span', { class: 'txt-red' }, `● ${need} need`),
      chaser ? h('span', { class: 'txt-orange' }, `★ ${chaser} chaser${chaser === 1 ? '' : 's'}`) : null,
      h('span', { class: 'txt-green' }, `✓ ${have} have`));
    if (need > lastNeed && navigator.vibrate) navigator.vibrate(60);
    lastNeed = need;
  }

  return { close };
}
