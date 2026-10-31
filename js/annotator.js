// Image with boxes on top: zoom, tap a box, or switch to "Draw box" and drag around a pin.
import { set, h, icon } from './ui.js?v=202610311133';

const memory = new Map(); // remembers zoom/draw per annotator key across re-renders

/**
 * opts: { key, src (url), boxes:[{id, rect:{x,y,w,h}, color, label, dim}], height, allowDraw,
 *         onDraw(rect), onTapBox(id) }
 */
export function annotator(opts) {
  const mem = memory.get(opts.key) || { zoom: 1, draw: false };
  memory.set(opts.key, mem);
  const allowDraw = opts.allowDraw !== false && !!opts.onDraw;

  const img = h('img', { src: opts.src, class: 'anno-img', draggable: false, alt: '' });
  const layer = h('div', { class: 'anno-layer' });
  const stage = h('div', { class: 'anno-stage' }, img, layer);
  const scroll = h('div', { class: 'anno-scroll', style: { height: opts.height || '320px' } }, stage);

  const zoomLabel = h('span', { class: 'muted small mono' });
  const drawBtn = h('button', { class: 'btn small' });
  // At 1× the whole photo fits inside the viewer; zooming makes it bigger and scrollable.
  const applyZoom = () => {
    const cw = scroll.clientWidth, ch = scroll.clientHeight;
    const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
    if (cw && ch && aspect) {
      const fit = Math.min(cw, ch * aspect);
      stage.style.width = fit * mem.zoom + 'px';
      stage.style.marginLeft = stage.style.marginRight = fit * mem.zoom < cw ? 'auto' : '0';
      stage.style.marginTop = fit * mem.zoom / aspect < ch ? Math.max(0, (ch - fit * mem.zoom / aspect) / 2) + 'px' : '0';
    } else {
      stage.style.width = mem.zoom * 100 + '%';
    }
    zoomLabel.textContent = mem.zoom.toFixed(1) + '×';
  };
  img.addEventListener('load', applyZoom);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(applyZoom).observe(scroll);
  const applyDraw = () => {
    drawBtn.className = 'btn small ' + (mem.draw ? 'warn' : '');
    set(drawBtn, icon('box'), h('span', {}, mem.draw ? 'Tap a pin, or drag around it' : 'Box a pin'));
    scroll.classList.toggle('drawing', mem.draw);
  };
  drawBtn.addEventListener('click', () => { mem.draw = !mem.draw; applyDraw(); });

  const bar = h('div', { class: 'anno-bar' },
    allowDraw ? drawBtn : h('span'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn small round', onclick: () => { mem.zoom = Math.max(1, mem.zoom - 0.5); applyZoom(); } }, icon('zoomOut')),
    zoomLabel,
    h('button', { class: 'btn small round', onclick: () => { mem.zoom = Math.min(5, mem.zoom + 0.5); applyZoom(); } }, icon('zoomIn')));

  function renderBoxes(boxes) {
    set(layer);
    for (const b of boxes || []) {
      const el = h('div', {
        class: 'anno-box' + (b.dim ? ' dim' : ''),
        style: {
          left: b.rect.x * 100 + '%', top: b.rect.y * 100 + '%',
          width: b.rect.w * 100 + '%', height: b.rect.h * 100 + '%',
          '--c': b.color || 'var(--accent)',
        },
      }, b.label && !b.dim ? h('span', { class: 'anno-label' }, b.label) : null);
      el.addEventListener('click', (e) => {
        if (mem.draw) return;
        e.stopPropagation();
        opts.onTapBox && opts.onTapBox(b.id);
      });
      layer.append(el);
    }
  }

  // drawing
  let start = null, draft = null;
  const pos = (e) => {
    const r = layer.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  layer.addEventListener('pointerdown', (e) => {
    if (!mem.draw) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    start = pos(e);
    draft = h('div', { class: 'anno-draft' });
    layer.append(draft);
  });
  layer.addEventListener('pointermove', (e) => {
    if (!start || !draft) return;
    const p = pos(e);
    Object.assign(draft.style, {
      left: Math.min(start.x, p.x) * 100 + '%', top: Math.min(start.y, p.y) * 100 + '%',
      width: Math.abs(p.x - start.x) * 100 + '%', height: Math.abs(p.y - start.y) * 100 + '%',
    });
  });
  const finish = (e) => {
    if (!start) return;
    const p = pos(e);
    const rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    start = null;
    if (draft) { draft.remove(); draft = null; }
    if (rect.w > 0.015 && rect.h > 0.015) opts.onDraw && opts.onDraw(rect);
    else if (opts.onPoint) opts.onPoint(p.x, p.y);
  };
  layer.addEventListener('pointerup', finish);
  layer.addEventListener('pointercancel', () => { start = null; if (draft) { draft.remove(); draft = null; } });

  applyZoom();
  applyDraw();
  renderBoxes(opts.boxes);

  const el = h('div', { class: 'anno' }, bar, scroll);
  return { el, setBoxes: renderBoxes };
}
