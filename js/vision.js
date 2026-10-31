// Finding pins in photos and comparing them. Runs entirely in the browser.
//
// Detection: separates pins from the background (colour difference from the photo's edges + edge
// density), then splits touching pins apart (erosion, then a pin-sized grid as a last resort).
// Matching: a built-in colour/shape fingerprint that always works, plus — when the phone can load
// it — Google's MediaPipe image model for smarter matching.

// ---------- images ----------

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export async function blobToCanvas(blob, maxDim = 2400) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return drawScaled(img, img.naturalWidth, img.naturalHeight, maxDim);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function drawScaled(src, w, h, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const c = makeCanvas(w * scale, h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Crop a normalized rect {x,y,w,h} (0..1, top-left origin) with padding, scaled to at most maxDim. */
export function crop(src, rect, pad = 0.04, maxDim = 256) {
  const W = src.width, H = src.height;
  let x = rect.x * W, y = rect.y * H, w = rect.w * W, h = rect.h * H;
  x -= w * pad; y -= h * pad; w *= 1 + 2 * pad; h *= 1 + 2 * pad;
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
  const cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
  const scale = Math.min(1, maxDim / Math.max(cw, ch));
  const c = makeCanvas(cw * scale, ch * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x0, y0, cw, ch, 0, 0, c.width, c.height);
  return c;
}

// ---------- colour helpers ----------

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function toLab(data, n) {
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = LIN[data[p]], g = LIN[data[p + 1]], b = LIN[data[p + 2]];
    const x = fLab((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const y = fLab(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const z = fLab((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    L[i] = 116 * y - 16; A[i] = 500 * (x - y); B[i] = 200 * (y - z);
  }
  return { L, A, B };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[s.length >> 1];
}

function borderMedian(L, A, B, w, h, t) {
  const ls = [], as = [], bs = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= t && x < w - t && y >= t && y < h - t) continue;
      const i = y * w + x;
      ls.push(L[i]); as.push(A[i]); bs.push(B[i]);
    }
  }
  return [median(ls), median(as), median(bs)];
}

function percentile(arr, p) {
  const step = Math.max(1, Math.floor(arr.length / 4000));
  const sample = [];
  for (let i = 0; i < arr.length; i += step) sample.push(arr[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] || 1;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0, cnt = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) { acc += src[y * w + x + r]; cnt++; }
      if (x - r - 1 >= 0) { acc -= src[y * w + x - r - 1]; cnt--; }
      if (x >= 0 && x < w) tmp[y * w + x] = acc / cnt;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0, cnt = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) { acc += tmp[(y + r) * w + x]; cnt++; }
      if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * w + x]; cnt--; }
      if (y >= 0 && y < h) out[y * w + x] = acc / cnt;
    }
  }
  return out;
}

function otsu(values, bins = 64, maxV = 1.5) {
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor((v / maxV) * bins)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = i; }
  }
  return ((thr + 0.5) / bins) * maxV;
}

// ---------- binary morphology ----------

function dilate(m, w, h, r) { return morph(m, w, h, r, true); }
function erode(m, w, h, r) { return morph(m, w, h, r, false); }
function morph(m, w, h, r, isDilate) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx < 0 || xx >= w ? (isDilate ? 0 : 0) : m[y * w + xx];
        if (isDilate ? s : !s) { v = isDilate ? 1 : 0; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isDilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (isDilate ? s : !s) { v = isDilate ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function fillHoles(m, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!m[i] && !seen[i]) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = m[i] || !seen[i] ? 1 : 0;
  return out;
}

/** Connected components (4-connected). Returns {labels, comps:[{label, area, x0,y0,x1,y1}]} */
function components(m, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [];
  let next = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!m[start] || labels[start]) continue;
    next++;
    const c = { label: next, area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    labels[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && m[j] && !labels[j]) { labels[j] = next; stack.push(j); }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Chamfer distance transform inside a mask. */
function distanceTransform(m, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? INF : 0;
  const D1 = 1, D2 = 1.4142;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, x > 0 ? d[i - 1] + D1 : D1, y > 0 ? d[i - w] + D1 : D1);
    v = Math.min(v, x > 0 && y > 0 ? d[i - w - 1] + D2 : D2, x < w - 1 && y > 0 ? d[i - w + 1] + D2 : D2);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, x < w - 1 ? d[i + 1] + D1 : D1, y < h - 1 ? d[i + w] + D1 : D1);
    v = Math.min(v, x < w - 1 && y < h - 1 ? d[i + w + 1] + D2 : D2, x > 0 && y < h - 1 ? d[i + w - 1] + D2 : D2);
    d[i] = v;
  }
  return d;
}

/** Try to pull touching pins apart by eroding the blob until it breaks into pieces. */
function erosionSplit(labels, comp, w) {
  const bw = comp.x1 - comp.x0 + 1, bh = comp.y1 - comp.y0 + 1;
  const sub = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    sub[y * bw + x] = labels[(comp.y0 + y) * w + comp.x0 + x] === comp.label ? 1 : 0;
  }
  const dt = distanceTransform(sub, bw, bh);
  let D = 0;
  for (const v of dt) if (v > D) D = v;
  if (D < 3) return null;
  let best = null;
  for (const f of [0.3, 0.38, 0.46, 0.54, 0.62, 0.7]) {
    const t = f * D;
    const m = new Uint8Array(bw * bh);
    for (let i = 0; i < m.length; i++) m[i] = dt[i] > t ? 1 : 0;
    const parts = components(m, bw, bh).comps.filter((c) => c.area >= comp.area * 0.025);
    if (parts.length >= 2 && (!best || parts.length > best.parts.length)) best = { parts, t };
  }
  if (!best) return null;
  const g = Math.ceil(best.t) + 1;
  return best.parts.map((p) => ({
    x0: Math.max(comp.x0, comp.x0 + p.x0 - g), y0: Math.max(comp.y0, comp.y0 + p.y0 - g),
    x1: Math.min(comp.x1, comp.x0 + p.x1 + g), y1: Math.min(comp.y1, comp.y0 + p.y1 + g),
  }));
}

/** Split a normalized rect into rows × cols equal cells. */
export function gridRects(r, rows, cols) {
  const out = [];
  const w = r.w / cols, h = r.h / rows;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out.push({ x: r.x + j * w, y: r.y + i * h, w, h });
  return out;
}

const area = (r) => r.w * r.h;
export function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  return inter / (area(a) + area(b) - inter);
}

// ---------- detection ----------

/**
 * Find pins in an image (canvas). Returns normalized rects {x,y,w,h}, top-left origin, reading order.
 */
export function detectPins(src, { workSize = 360, gridSplit = true } = {}) {
  const W0 = src.width, H0 = src.height;
  const sc = Math.min(1, workSize / Math.max(W0, H0));
  const w = Math.max(8, Math.round(W0 * sc)), h = Math.max(8, Math.round(H0 * sc));
  const small = makeCanvas(w, h);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, 0, 0, w, h);
  const data = sctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const { L, A, B } = toLab(data, n);

  // 1. How different is each pixel from the background (sampled from the photo's edges)?
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const [Lb, Ab, Bb] = borderMedian(L, A, B, w, h, t);
  const cd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dl = L[i] - Lb, da = A[i] - Ab, db = B[i] - Bb;
    cd[i] = Math.sqrt(0.5 * dl * dl + da * da + db * db);
  }
  // 2. Edge density (pins have strong metal outlines).
  const mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
    const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    mag[i] = Math.sqrt(gx * gx + gy * gy);
  }
  const ed = boxBlur(mag, w, h, 2);
  const cdS = boxBlur(cd, w, h, 1);
  const pc = percentile(cdS, 0.95), pe = percentile(ed, 0.95);
  const score = new Float32Array(n);
  for (let i = 0; i < n; i++) score[i] = Math.min(1.5, 0.65 * (cdS[i] / pc) + 0.35 * (ed[i] / pe));

  const thr = Math.max(0.22, otsu(score));
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = score[i] > thr ? 1 : 0;
  mask = erode(dilate(mask, w, h, 2), w, h, 2);   // close small gaps
  mask = fillHoles(mask, w, h);
  mask = dilate(erode(mask, w, h, 1), w, h, 1);   // remove specks

  const { labels, comps: all } = components(mask, w, h);
  const minArea = Math.max(12, n * 0.0012);
  // Ignore banners, frames and table edges: blobs that touch the photo's edge and span most of it.
  const isBand = (c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const touchesX = c.x0 <= 4 || c.x1 >= w - 5, touchesY = c.y0 <= 4 || c.y1 >= h - 5;
    return (bw > 0.75 * w && touchesY) || (bh > 0.75 * h && touchesX);
  };
  let comps = all.filter((c) => c.area >= minArea);
  const nonBand = comps.filter((c) => !isBand(c));
  if (nonBand.length) comps = nonBand;
  if (!comps.length) return [];

  const boxOf = (c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  const bArea = (b) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  let boxes = comps.map((c) => ({ ...boxOf(c), comp: c }));

  // Whole photo is one object (e.g. a close-up of a single pin).
  if (boxes.length === 1 && bArea(boxes[0]) > 0.85 * n) {
    return [{ x: boxes[0].x0 / w, y: boxes[0].y0 / h, w: (boxes[0].x1 - boxes[0].x0 + 1) / w, h: (boxes[0].y1 - boxes[0].y0 + 1) / h }];
  }
  // Drop a giant "whole board" blob when there are smaller pins too.
  if (boxes.length > 2) boxes = boxes.filter((b) => bArea(b) < 0.5 * n);

  // 3. Split up boxes that are much bigger than a typical pin, or long rows/columns of pins.
  const areas = boxes.map(bArea).sort((a, b) => a - b);
  const smallHalf = areas.slice(0, Math.ceil(areas.length / 2));
  const typical = smallHalf[smallHalf.length >> 1];
  const singles = boxes.filter((b) => bArea(b) <= typical * 1.7);
  const typW = median(singles.map((b) => b.x1 - b.x0 + 1));
  const typH = median(singles.map((b) => b.y1 - b.y0 + 1));

  const out = [];
  for (const b of boxes) {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const aspect = bw / bh;
    const oversized = boxes.length > 1 && bArea(b) > typical * 1.7;
    const stretched = aspect > 1.65 || aspect < 0.6;
    if (!oversized && !stretched) { out.push(b); continue; }
    const parts = erosionSplit(labels, b.comp, w);
    if (parts && parts.length >= 2) { out.push(...parts); continue; }
    let cols = 1, rows = 1;
    if (oversized && typW > 0 && typH > 0) {
      cols = Math.max(1, Math.round(bw / typW));
      rows = Math.max(1, Math.round(bh / typH));
    } else if (stretched) {
      if (aspect > 1) cols = Math.max(1, Math.round(aspect)); else rows = Math.max(1, Math.round(1 / aspect));
    }
    if (gridSplit && cols * rows >= 2 && cols * rows <= 48) {
      const cw = bw / cols, ch = bh / rows;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        out.push({ x0: b.x0 + j * cw, y0: b.y0 + i * ch, x1: b.x0 + (j + 1) * cw - 1, y1: b.y0 + (i + 1) * ch - 1 });
      }
    } else out.push(b);
  }

  return out
    .map((b) => ({ x: b.x0 / w, y: b.y0 / h, w: (b.x1 - b.x0 + 1) / w, h: (b.y1 - b.y0 + 1) / h }))
    .filter((r) => { const a = r.w / r.h; return a > 0.2 && a < 5; })
    .sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
}

/** For a photo of one pin: the biggest detected object, or the whole photo. */
export function mainPinRect(src) {
  const rects = detectPins(src);
  if (!rects.length) return { x: 0.02, y: 0.02, w: 0.96, h: 0.96 };
  return rects.reduce((a, b) => (area(b) > area(a) ? b : a));
}

// ---------- fingerprints ----------

const N = 32;
const H_BINS = 40, LAYOUT = 108, HOG = 128;
export const BASIC_LEN = H_BINS + LAYOUT + HOG;

/** Built-in colour + layout + shape fingerprint of a pin crop. */
export function describeBasic(cropCanvas) {
  const c = makeCanvas(N, N);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cropCanvas, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N).data;
  const n = N * N;
  const { L, A, B } = toLab(data, n);
  const [Lb, Ab, Bb] = borderMedian(L, A, B, N, N, 2);

  // Foreground weight: ignore the background around the pin (photos have different backgrounds).
  const wgt = new Float32Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(0.5 * (L[i] - Lb) ** 2 + (A[i] - Ab) ** 2 + (B[i] - Bb) ** 2);
    wgt[i] = Math.max(0, Math.min(1, (d - 6) / 14));
    wsum += wgt[i];
  }
  if (wsum < n * 0.15) { wgt.fill(1); wsum = n; }

  const out = new Float32Array(BASIC_LEN);
  // a) hue/saturation histogram (12 hues × 3 saturations + 4 greys)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!wgt[i]) continue;
    const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dlt = mx - mn;
    const s = mx ? dlt / mx : 0;
    let bin;
    if (s < 0.2 || dlt < 0.06) bin = 36 + Math.min(3, Math.floor(mx * 4));
    else {
      let hue = mx === r ? ((g - b) / dlt) % 6 : mx === g ? (b - r) / dlt + 2 : (r - g) / dlt + 4;
      hue = (hue < 0 ? hue + 6 : hue) / 6;
      bin = (Math.floor(hue * 12) % 12) * 3 + (s < 0.45 ? 0 : s < 0.7 ? 1 : 2);
    }
    out[bin] += wgt[i];
  }
  let hs = 0;
  for (let i = 0; i < H_BINS; i++) hs += out[i];
  for (let i = 0; i < H_BINS; i++) out[i] = Math.sqrt(out[i] / (hs || 1));

  // b) colour layout: 6×6 grid of average Lab
  const cell = new Float32Array(36 * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, k = (Math.floor((y * 6) / N) * 6 + Math.floor((x * 6) / N)) * 4;
    cell[k] += wgt[i] * L[i]; cell[k + 1] += wgt[i] * A[i]; cell[k + 2] += wgt[i] * B[i]; cell[k + 3] += wgt[i];
  }
  for (let k = 0; k < 36; k++) {
    const ww = cell[k * 4 + 3];
    const o = H_BINS + k * 3;
    if (ww > 0.5) {
      out[o] = cell[k * 4] / ww / 100;
      out[o + 1] = cell[k * 4 + 1] / ww / 100;
      out[o + 2] = cell[k * 4 + 2] / ww / 100;
    }
  }

  // c) shape: gradient-orientation histograms on a 4×4 grid
  const o = H_BINS + LAYOUT;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x;
    const gx = L[i + 1] - L[i - 1], gy = L[i + N] - L[i - N];
    const m = Math.sqrt(gx * gx + gy * gy) * (0.3 + 0.7 * wgt[i]);
    if (m < 1) continue;
    let ang = Math.atan2(gy, gx);
    if (ang < 0) ang += Math.PI;
    const bin = Math.min(7, Math.floor((ang / Math.PI) * 8));
    out[o + (Math.floor(y / 8) * 4 + Math.floor(x / 8)) * 8 + bin] += m;
  }
  let gs = 0;
  for (let i = o; i < o + HOG; i++) gs += out[i] * out[i];
  gs = Math.sqrt(gs) || 1;
  for (let i = o; i < o + HOG; i++) out[i] /= gs;
  return out;
}

export function distBasic(a, b) {
  if (!a || !b) return Infinity;
  let bc = 0;
  for (let i = 0; i < H_BINS; i++) bc += a[i] * b[i];
  const dh = Math.sqrt(Math.max(0, 1 - bc));
  let s = 0;
  for (let i = H_BINS; i < H_BINS + LAYOUT; i++) { const d = a[i] - b[i]; s += d * d; }
  const dl = Math.min(1, Math.sqrt(s) / 2);
  let dot = 0;
  for (let i = H_BINS + LAYOUT; i < BASIC_LEN; i++) dot += a[i] * b[i];
  const dg = Math.max(0, 1 - dot);
  return 0.45 * dh + 0.3 * dl + 0.25 * dg;
}

// ---------- optional smarter matching (MediaPipe image model, loaded from the internet once) ----------

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite';

export const ml = { status: 'off', error: '', embedder: null, listeners: new Set() };

export async function loadML() {
  if (ml.status === 'loading' || ml.status === 'ready') return;
  ml.status = 'loading';
  ml.listeners.forEach((f) => f());
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 45000));
    const load = (async () => {
      const mod = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
      const fileset = await mod.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      return mod.ImageEmbedder.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL },
        l2Normalize: true,
        quantize: false,
        runningMode: 'IMAGE',
      });
    })();
    ml.embedder = await Promise.race([load, timeout]);
    // sanity check
    const probe = embedML(makeCanvas(64, 64));
    if (!probe || !probe.length) throw new Error('model returned nothing');
    ml.status = 'ready';
  } catch (e) {
    ml.status = 'failed';
    ml.error = String(e && e.message || e);
    ml.embedder = null;
  }
  ml.listeners.forEach((f) => f());
}

export function embedML(canvas) {
  if (!ml.embedder) return null;
  try {
    const res = ml.embedder.embed(canvas);
    const e = res && res.embeddings && res.embeddings[0];
    if (!e || !e.floatEmbedding) return null;
    return Float32Array.from(e.floatEmbedding);
  } catch {
    return null;
  }
}

function distML(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(0, 1 - dot);
}

/** Fingerprint for a crop: always the built-in one, plus the model's when available. */
export function describe(cropCanvas) {
  return { basic: describeBasic(cropCanvas), ml: ml.status === 'ready' ? embedML(cropCanvas) : null };
}

/** Distance between two fingerprints (smaller = more alike). Roughly: < 0.5 same pin, > 0.65 different. */
export function distance(q, r) {
  const b = distBasic(q.basic, r.basic);
  if (q.ml && r.ml && q.ml.length === r.ml.length) {
    const m = distML(q.ml, r.ml);
    return 0.4 * b + 0.6 * Math.min(1, m * 1.4);
  }
  return b;
}

// ---------- pipeline ----------

/** Detect + crop + fingerprint. rects optional (use your own boxes). */
export async function scanCanvas(canvas, rects = null, { makeBlobs = true, maxPins = 60 } = {}) {
  const found = (rects || detectPins(canvas)).slice(0, maxPins);
  const out = [];
  for (const rect of found) {
    const c = crop(canvas, rect);
    const desc = describe(c);
    out.push({ rect, crop: c, blob: makeBlobs ? await canvasToBlob(c) : null, ...desc });
  }
  return out;
}
