// Reads printed text (pin names, series titles) using Tesseract.js, loaded once from a public CDN.
// Optional: if it can't load, PinVault simply keeps the "Disneyland #3"-style names.
import { makeCanvas } from './vision.js?v=202610311004';

const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;
export const ocrState = { status: 'off', error: '' };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load the text reader'));
    document.head.append(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      ocrState.status = 'loading';
      await loadScript(SRC);
      const worker = await window.Tesseract.createWorker('eng');
      ocrState.status = 'ready';
      return worker;
    })().catch((e) => {
      ocrState.status = 'failed';
      ocrState.error = String(e && e.message || e);
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** True if the text reader is available (loads it the first time). */
export async function ready() {
  try {
    await Promise.race([getWorker(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 60000))]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the text inside a normalized rect of a canvas. invert: for light text on a coloured bar.
 */
export async function read(src, rect, { invert = false } = {}) {
  const worker = await getWorker();
  const x = Math.max(0, Math.floor(rect.x * src.width)), y = Math.max(0, Math.floor(rect.y * src.height));
  const w = Math.min(src.width - x, Math.ceil(rect.w * src.width)), h = Math.min(src.height - y, Math.ceil(rect.h * src.height));
  if (w < 4 || h < 4) return '';
  // Scale so text is a comfortable size, and turn it into dark text on white.
  const scale = Math.max(1, Math.min(3, 90 / h));
  const c = makeCanvas(w * scale + 20, h * scale + 20);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h, 10, 10, w * scale, h * scale);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    const v = invert ? (lum > 200 ? 0 : 255) : (lum < 150 ? 0 : 255);
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  if (invert) {
    // the 10px white border we added became black; repaint it white
    for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
      if (xx < 10 || yy < 10 || xx >= c.width - 10 || yy >= c.height - 10) {
        const p = (yy * c.width + xx) * 4;
        d[p] = d[p + 1] = d[p + 2] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const { data } = await worker.recognize(c);
  return (data && data.text) || '';
}
