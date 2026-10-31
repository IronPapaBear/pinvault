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

// ---------- finding the board / mat / lanyard the pins sit on ----------

/** k-means colour clusters (Lab), deterministic. */
function kmeans(L, A, B, n, k, iters = 8) {
  const step = Math.max(1, Math.floor(n / 6000));
  const cent = [];
  for (let j = 0; j < k; j++) { const i = Math.floor(((j + 0.5) / k) * n); cent.push([L[i], A[i], B[i]]); }
  // spread the starting points (k-means++ style, deterministic)
  for (let j = 1; j < k; j++) {
    let best = -1, bi = 0;
    for (let i = 0; i < n; i += step) {
      let dm = Infinity;
      for (let q = 0; q < j; q++) { const d = (L[i] - cent[q][0]) ** 2 + (A[i] - cent[q][1]) ** 2 + (B[i] - cent[q][2]) ** 2; if (d < dm) dm = d; }
      if (dm > best) { best = dm; bi = i; }
    }
    cent[j] = [L[bi], A[bi], B[bi]];
  }
  const lab = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bd = Infinity, bj = 0;
      for (let j = 0; j < k; j++) {
        const d = (L[i] - cent[j][0]) ** 2 + (A[i] - cent[j][1]) ** 2 + (B[i] - cent[j][2]) ** 2;
        if (d < bd) { bd = d; bj = j; }
      }
      lab[i] = bj;
      const a = acc[bj]; a[0] += L[i]; a[1] += A[i]; a[2] += B[i]; a[3]++;
    }
    for (let j = 0; j < k; j++) if (acc[j][3]) cent[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
  }
  return { lab, cent };
}

/** Filled convex hull of a mask (rows scanned as one interval each). */
function convexHullMask(m, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0) { pts.push([x0, y]); if (x1 !== x0) pts.push([x1, y]); }
  }
  const out = new Uint8Array(w * h);
  if (pts.length < 3) return out.fill(1);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const poly = lower.slice(0, -1).concat(upper.slice(0, -1));
  for (let y = 0; y < h; y++) {
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      if ((ay <= y && by >= y) || (by <= y && ay >= y)) {
        const x = ay === by ? Math.min(ax, bx) : ax + ((y - ay) * (bx - ax)) / (by - ay);
        const x2 = ay === by ? Math.max(ax, bx) : x;
        xmin = Math.min(xmin, x, x2); xmax = Math.max(xmax, x, x2);
      }
    }
    if (xmin <= xmax) for (let x = Math.max(0, Math.floor(xmin)); x <= Math.min(w - 1, Math.ceil(xmax)); x++) out[y * w + x] = 1;
  }
  return out;
}

/**
 * Looks for one big, evenly coloured region with several "holes" in it — a pin board, mat or lanyard
 * with pins on it. Returns { fg: mask of things on the board, mean: board colour } or null.
 */
function findBoard(L, A, B, w, h) {
  const n = w * h;
  const k = 6;
  const { lab, cent } = kmeans(L, A, B, n, k);
  const r = Math.max(3, Math.round(Math.max(w, h) * 0.025));
  let best = null;
  for (let j = 0; j < k; j++) {
    let m = new Uint8Array(n);
    let cnt = 0;
    for (let i = 0; i < n; i++) if (lab[i] === j) { m[i] = 1; cnt++; }
    if (cnt < n * 0.08) continue;
    // Also count close shades of the same colour (e.g. the darker holes of a mat) as board.
    for (let i = 0; i < n; i++) {
      if (m[i]) continue;
      const d = (L[i] - cent[j][0]) ** 2 * 0.5 + (A[i] - cent[j][1]) ** 2 + (B[i] - cent[j][2]) ** 2;
      if (d < 7 * 7) m[i] = 1;
    }
    m = dilate(erode(m, w, h, 1), w, h, 1);
    const { labels, comps } = components(m, w, h);
    if (!comps.length) continue;
    const big = comps.reduce((a, b) => (b.area > a.area ? b : a));
    if (big.area < n * 0.08) continue;
    const region = new Uint8Array(n);
    for (let i = 0; i < n; i++) region[i] = labels[i] === big.label ? 1 : 0;
    // Close the outline so pins hanging over the edge still count as "on" the board.
    const closed = erode(dilate(region, w, h, r), w, h, r);
    const filled = fillHoles(closed, w, h);
    // Only count things within the board's outline (its convex hull), not the room around it.
    const hull = convexHullMask(region, w, h);
    const holes = new Uint8Array(n);
    for (let i = 0; i < n; i++) holes[i] = filled[i] && !region[i] && hull[i] ? 1 : 0;
    const hc = components(dilate(erode(holes, w, h, 1), w, h, 1), w, h).comps
      .filter((c) => c.area >= n * 0.002 && c.area <= n * 0.3);
    const holeArea = hc.reduce((s, c) => s + c.area, 0);
    // The board is the region holding the most "things" (pins), weighted by how much of it they fill.
    const score = hc.length * Math.sqrt(holeArea / n);
    if (hc.length >= 2 && (!best || score > best.score)) best = { score, fg: holes, mean: cent[j], hull, region, filled };
  }
  return best;
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

  // Edge strength (pins have strong metal outlines and busy artwork).
  const mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
    const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    mag[i] = Math.sqrt(gx * gx + gy * gy);
  }

  // A. Pins sitting on a board, mat or lanyard: find the board and treat what's on it as pins.
  const board = findBoard(L, A, B, w, h);
  let mask, bgColor;
  if (board) {
    mask = board.fg;
    bgColor = board.mean;
    // Pins coloured almost like the board (a dark pin on a dark mat) still have shiny metal outlines:
    // add anything clearly brighter or more colourful than the board, inside the board's outline.
    for (let i = 0; i < n; i++) {
      if (mask[i] || !board.hull[i] || !board.filled[i]) continue;
      const chroma = Math.hypot(A[i] - bgColor[1], B[i] - bgColor[2]);
      if (L[i] - bgColor[0] > 28 || chroma > 16) mask[i] = 1;
    }
    mask = erode(dilate(mask, w, h, 1), w, h, 1);
    mask = fillHoles(mask, w, h);
    mask = dilate(erode(mask, w, h, 1), w, h, 1);
  } else {
    // B. Pins on a plain background: compare every pixel with the photo's edges.
    const t = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    bgColor = borderMedian(L, A, B, w, h, t);
    const [Lb, Ab, Bb] = bgColor;
    const cd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dl = L[i] - Lb, da = A[i] - Ab, db = B[i] - Bb;
      cd[i] = Math.sqrt(0.5 * dl * dl + da * da + db * db);
    }
    const ed = boxBlur(mag, w, h, 2);
    const cdS = boxBlur(cd, w, h, 1);
    const pc = percentile(cdS, 0.95), pe = percentile(ed, 0.95);
    const score = new Float32Array(n);
    for (let i = 0; i < n; i++) score[i] = Math.min(1.5, 0.65 * (cdS[i] / pc) + 0.35 * (ed[i] / pe));
    const thr = Math.max(0.22, otsu(score));
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = score[i] > thr ? 1 : 0;
    mask = erode(dilate(mask, w, h, 2), w, h, 2);   // close small gaps
    mask = fillHoles(mask, w, h);
    mask = dilate(erode(mask, w, h, 1), w, h, 1);   // remove specks
  }

  const { labels, comps: all } = components(mask, w, h);
  const minArea = Math.max(12, n * (board ? 0.0035 : 0.0012));
  // Ignore banners, frames and table edges: blobs that touch the photo's edge and span most of it.
  const isBand = (c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const touchesX = c.x0 <= 4 || c.x1 >= w - 5, touchesY = c.y0 <= 4 || c.y1 >= h - 5;
    return (bw > 0.75 * w && touchesY) || (bh > 0.75 * h && touchesX);
  };
  let comps = all.filter((c) => c.area >= minArea);
  if (board) {
    // Keep blobs that look like pins: clearly different from the board and full of detail
    // (drops the board's own holes, fingers and shadows).
    const stats = new Map(comps.map((c) => [c.label, { d: 0, m: 0, n: 0, on: 0 }]));
    for (let i = 0; i < n; i++) {
      const st = stats.get(labels[i]);
      if (!st) continue;
      const dl = L[i] - bgColor[0], da = A[i] - bgColor[1], db = B[i] - bgColor[2];
      st.d += Math.sqrt(0.5 * dl * dl + da * da + db * db); st.m += mag[i]; st.n++;
      if (board.filled[i]) st.on++;
    }
    const magRef = percentile(mag, 0.9) || 1;
    comps = comps.filter((c) => {
      const st = stats.get(c.label);
      c.colorDist = st.d / st.n; c.detail = st.m / st.n / magRef;
      return c.colorDist > 16 && c.detail > 0.35;
    });
    // Drop a blob far bigger than the pins around it (a patch of the room behind the board).
    if (comps.length >= 3) {
      const ba = (c) => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
      const sorted = comps.map(ba).sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      comps = comps.filter((c) => ba(c) <= med * 3.2);
    }
  }
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
    if (gridSplit && !board && cols * rows >= 2 && cols * rows <= 48) {
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

// ---------- printed checklists (pins drawn on white with names under them and coloured section bars) ----------

/**
 * Recognises the official-style checklist graphics. Returns null for ordinary photos.
 * Result: { pins: [{rect, labelRect, section}], sections: [{rect}] } — all normalized 0..1.
 */
export function detectChecklist(src) {
  const W0 = src.width, H0 = src.height;
  const sc = Math.min(1, 1000 / Math.max(W0, H0));
  const w = Math.round(W0 * sc), h = Math.round(H0 * sc);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const { L, A, B } = toLab(d, n);
  // Paper = white or very light grey/blue (cards and panels); everything else is "ink".
  const fg = new Uint8Array(n);
  let paper = 0;
  for (let i = 0; i < n; i++) {
    const chroma = Math.hypot(A[i], B[i]);
    const light = L[i] > 86 && chroma < 14;
    if (light) paper++; else fg[i] = 1;
  }
  if (paper / n < 0.3) return null; // not a printed checklist

  // Full-width coloured rows (series bars, or the gaps between series cards).
  const rowFrac = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += fg[y * w + x];
    rowFrac[y] = s / w;
  }
  const bars = [];
  for (let y = 0; y < h; y++) {
    if (rowFrac[y] > 0.85) {
      let y1 = y;
      while (y1 + 1 < h && rowFrac[y1 + 1] > 0.85) y1++;
      if (y1 - y + 1 >= Math.max(3, h * 0.006)) bars.push({ y0: y, y1 });
      y = y1;
    }
  }
  if (bars.length < 2) return null;
  // The divider colour (median of the bar rows); pixels of that colour are tabs/edges, not pins.
  const bl = [], ba = [], bb = [];
  for (const bar of bars) for (let y = bar.y0; y <= bar.y1; y += 2) for (let x = 0; x < w; x += 4) {
    const i = y * w + x; bl.push(L[i]); ba.push(A[i]); bb.push(B[i]);
  }
  const barCol = [median(bl), median(ba), median(bb)];
  const isBarColour = (i) => {
    const dl = L[i] - barCol[0], da = A[i] - barCol[1], db = B[i] - barCol[2];
    return 0.5 * dl * dl + da * da + db * db < 22 * 22;
  };

  const pins = [];
  const sections = [];
  const footer = Math.round(h * 0.985);
  for (let s = 0; s < bars.length; s++) {
    const top = bars[s].y1 + 1;
    const bottom = s + 1 < bars.length ? bars[s + 1].y0 - 1 : Math.min(h - 1, footer);
    const sh = bottom - top + 1;
    if (sh < h * 0.04) continue;
    // A series is printed on paper; skip logo headers and the like (mostly coloured).
    let paperRows = 0;
    for (let y = top; y <= bottom; y++) for (let x = 0; x < w; x += 3) paperRows += fg[y * w + x] ? 0 : 1;
    if (paperRows / (sh * Math.ceil(w / 3)) < 0.35) continue;

    // Title: a tab of the divider colour in the top-left of the section, else the bar above it.
    let tx0 = w, ty0 = sh, tx1 = -1, ty1 = -1;
    for (let y = 0; y < sh * 0.35; y++) for (let x = 0; x < w * 0.6; x++) {
      const i = (top + y) * w + x;
      if (fg[i] && isBarColour(i)) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
    }
    const tab = tx1 - tx0 > w * 0.12 && ty1 - ty0 > sh * 0.05;
    sections.push({ rect: tab
      ? { x: tx0 / w, y: (top + ty0) / h, w: (tx1 - tx0 + 1) / w, h: (ty1 - ty0 + 1) / h }
      : { x: 0, y: bars[s].y0 / h, w: 1, h: (bars[s].y1 - bars[s].y0 + 1) / h } });
    const secIndex = sections.length - 1;

    // Section mask (ink that isn't divider-coloured), small gaps closed, then blobs.
    let m = new Uint8Array(w * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) {
      const i = (top + y) * w + x;
      m[y * w + x] = fg[i] && !isBarColour(i) ? 1 : 0;
    }
    m = erode(dilate(m, w, sh, 2), w, sh, 2);
    const { comps } = components(m, w, sh);
    // Pin pieces are tall; letters of the names are short.
    const solid = (cc) => cc.area / ((cc.x1 - cc.x0 + 1) * (cc.y1 - cc.y0 + 1)) > 0.16; // frames/outlines are mostly empty
    const nearEdge = (cc) => (cc.x0 + cc.x1) / 2 < w * 0.04 || (cc.x0 + cc.x1) / 2 > w * 0.96;
    let parts = comps.filter((cc) => cc.y1 - cc.y0 + 1 >= sh * 0.2 && cc.area >= 30 && cc.x1 - cc.x0 + 1 >= w * 0.03 && solid(cc) && !nearEdge(cc))
      .map((cc) => ({ x0: cc.x0, x1: cc.x1, y0: cc.y0, y1: cc.y1 }))
      .sort((a, b) => a.x0 - b.x0);
    // Merge pieces of the same pin (overlapping columns).
    const merged = [];
    for (const p of parts) {
      const last = merged[merged.length - 1];
      if (last) {
        const ov = Math.min(last.x1, p.x1) - Math.max(last.x0, p.x0);
        const narrow = Math.min(last.x1 - last.x0, p.x1 - p.x0) + 1;
        if (ov > narrow * 0.3) {
          last.x0 = Math.min(last.x0, p.x0); last.x1 = Math.max(last.x1, p.x1);
          last.y0 = Math.min(last.y0, p.y0); last.y1 = Math.max(last.y1, p.y1);
          continue;
        }
      }
      merged.push({ ...p });
    }
    // Small leftovers next to a pin (a detached ear, a flag) join their nearest neighbour.
    const widths = merged.map((p) => p.x1 - p.x0 + 1).sort((a, b) => a - b);
    const medW = widths[widths.length >> 1] || 1;
    const final = [];
    for (const p of merged) {
      const pw = p.x1 - p.x0 + 1;
      const last = final[final.length - 1];
      if (last && pw < medW * 0.4 && p.x0 - last.x1 < medW * 0.15) {
        last.x1 = Math.max(last.x1, p.x1); last.y0 = Math.min(last.y0, p.y0); last.y1 = Math.max(last.y1, p.y1);
        continue;
      }
      if (last && (last.x1 - last.x0 + 1) < medW * 0.4 && p.x0 - last.x1 < medW * 0.15) {
        last.x1 = p.x1; last.y0 = Math.min(last.y0, p.y0); last.y1 = Math.max(last.y1, p.y1);
        continue;
      }
      final.push({ ...p });
    }
    // A box about twice as wide as a pin is usually two pins side by side: cut at the emptiest column.
    for (let k = final.length - 1; k >= 0; k--) {
      const p = final[k];
      const pw = p.x1 - p.x0 + 1, ph = p.y1 - p.y0 + 1;
      if (pw < medW * 1.6 || final.length < 3) continue;
      let bestX = -1, bestV = Infinity;
      for (let x = p.x0 + Math.round(pw * 0.25); x <= p.x1 - Math.round(pw * 0.25); x++) {
        let v = 0;
        for (let y = p.y0; y <= p.y1; y++) v += m[y * w + x];
        if (v < bestV) { bestV = v; bestX = x; }
      }
      if (bestX > 0 && bestV <= ph * 0.08) {
        final.splice(k, 1, { ...p, x1: bestX - 1 }, { ...p, x0: bestX + 1 });
      }
    }
    // If a line of the name got joined onto the bottom of a pin, cut it off at the blank gap above it.
    for (const p of final) {
      const ph = p.y1 - p.y0 + 1;
      const empty = (yy) => {
        let s = 0;
        for (let x = p.x0; x <= p.x1; x++) s += fg[(top + yy) * w + x];
        return s <= 1;
      };
      let yb = p.y1;
      while (yb > p.y0 && empty(yb)) yb--;
      for (let yy = yb; yy > p.y0 + ph * 0.6; yy--) {
        if (empty(yy) && empty(yy - 1)) {
          let g = yy - 1;
          while (g > p.y0 && empty(g - 1)) g--;
          if (yb - yy < ph * 0.3) p.y1 = g - 1;
          break;
        }
      }
    }
    final.forEach((p, i) => {
      // The name sits below the pin, between the neighbours' midpoints.
      const left = i > 0 ? (final[i - 1].x1 + p.x0) / 2 : Math.max(0, p.x0 - medW * 0.3);
      const right = i < final.length - 1 ? (p.x1 + final[i + 1].x0) / 2 : Math.min(w - 1, p.x1 + medW * 0.3);
      const labelTop = top + p.y1 + 1;
      pins.push({
        section: secIndex,
        rect: { x: p.x0 / w, y: (top + p.y0) / h, w: (p.x1 - p.x0 + 1) / w, h: (p.y1 - p.y0 + 1) / h },
        labelRect: { x: left / w, y: labelTop / h, w: (right - left) / w, h: Math.max(1, bottom - labelTop + 1) / h },
      });
    });
  }
  return pins.length >= 3 ? { pins, sections } : null;
}

/** Finds pins by their bright metal outlines / bright enamel against a darker background. */
function outlineRects(src) {
  const sc = Math.min(1, 260 / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * sc)), h = Math.max(8, Math.round(src.height * sc));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const n = w * h;
  const { L, A, B } = toLab(ctx.getImageData(0, 0, w, h).data, n);
  const [Lb, Ab, Bb] = borderMedian(L, A, B, w, h, Math.max(2, Math.round(Math.min(w, h) * 0.04)));
  let m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const chroma = Math.hypot(A[i] - Ab, B[i] - Bb);
    m[i] = L[i] - Lb > 22 || chroma > 18 ? 1 : 0;
  }
  m = erode(dilate(m, w, h, 2), w, h, 2);
  m = fillHoles(m, w, h);
  m = dilate(erode(m, w, h, 2), w, h, 2);
  return components(m, w, h).comps.filter((cc) => cc.area >= n * 0.01)
    .map((cc) => ({ x: cc.x0 / w, y: cc.y0 / h, w: (cc.x1 - cc.x0 + 1) / w, h: (cc.y1 - cc.y0 + 1) / h }));
}

/**
 * "Tap a pin": finds the pin around a tapped point (normalized x, y) by looking at a window around it,
 * growing the window if the pin runs off its edge. Returns a normalized rect.
 */
export function pinAt(src, px, py) {
  const W = src.width, H = src.height;
  let best = null;
  for (const frac of [0.3, 0.45, 0.62]) {
    const side = frac * Math.min(W, H);
    const x0 = Math.max(0, px * W - side / 2), y0 = Math.max(0, py * H - side / 2);
    const x1 = Math.min(W, px * W + side / 2), y1 = Math.min(H, py * H + side / 2);
    const cw = x1 - x0, ch = y1 - y0;
    const c = makeCanvas(cw, ch);
    c.getContext('2d').drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
    const cx = (px * W - x0) / cw, cy = (py * H - y0) / ch;
    const rects = detectPins(c, { workSize: 260, gridSplit: false });
    const contains = (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    const inside = rects.filter(contains);
    let pick = inside.sort((a, b) => a.w * a.h - b.w * b.h)[0];
    // Dark pins on dark boards: trace the shiny metal outline instead, and keep the bigger find.
    const traced = outlineRects(c).filter(contains).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (traced && traced.w * traced.h < 0.8 && (!pick || pick.w * pick.h < 0.05)) pick = traced;
    if (!pick && rects.length) {
      const dist = (r) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
      const near = rects.sort((a, b) => dist(a) - dist(b))[0];
      if (dist(near) < 0.18) pick = near;
    }
    if (!pick) continue;
    best = { x: (x0 + pick.x * cw) / W, y: (y0 + pick.y * ch) / H, w: (pick.w * cw) / W, h: (pick.h * ch) / H };
    const m = 0.02;
    const touches = pick.x < m || pick.y < m || pick.x + pick.w > 1 - m || pick.y + pick.h > 1 - m;
    if (!touches) break;
  }
  if (best) return best;
  const s = 0.16 * Math.min(W, H);
  return { x: Math.max(0, px - s / 2 / W), y: Math.max(0, py - s / 2 / H), w: s / W, h: s / H };
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
