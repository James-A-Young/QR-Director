import { buildMatrix, eyeOrigins, isFinderModule, type EyePosition, type QrMatrix } from './matrix.js';
import { circlePath, diamondPath, fmt, orientCorners, rectPath, starPath } from './shapes.js';
import { effectiveErrorCorrection, type Fill, type QrStyle } from './style.js';
import { textToPath } from './text.js';

export interface LogoImage {
  /** data: URI of the image; it is letterboxed into a square so its aspect ratio does not matter. */
  href: string;
}

export interface RenderOptions {
  /** Text to encode (usually the short URL). */
  data: string;
  style: QrStyle;
  logo?: LogoImage | null;
  /** Width of the output, e.g. 1024 (px) or 50 (mm). Height follows the frame's aspect ratio. */
  width?: number;
  unit?: 'px' | 'mm' | 'in';
  title?: string;
}

export interface RenderResult {
  svg: string;
  /** Size of the drawing in module units, so callers can derive pixel heights. */
  viewBox: { width: number; height: number };
  version: number;
  modules: number;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

function fillDefs(fill: Fill, id: string, x: number, y: number, size: number): { paint: string; defs: string } {
  if (fill.type === 'solid') return { paint: fill.color, defs: '' };
  if (fill.type === 'radial') {
    const c = size / 2;
    return {
      paint: `url(#${id})`,
      defs:
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(x + c)}" cy="${fmt(y + c)}" r="${fmt(c * Math.SQRT2)}">` +
        `<stop offset="0" stop-color="${fill.from}"/><stop offset="1" stop-color="${fill.to}"/></radialGradient>`,
    };
  }
  const rad = (fill.angle * Math.PI) / 180;
  const c = size / 2;
  const dx = Math.cos(rad) * c;
  const dy = Math.sin(rad) * c;
  return {
    paint: `url(#${id})`,
    defs:
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(x + c - dx)}" y1="${fmt(y + c - dy)}" x2="${fmt(x + c + dx)}" y2="${fmt(y + c + dy)}">` +
      `<stop offset="0" stop-color="${fill.from}"/><stop offset="1" stop-color="${fill.to}"/></linearGradient>`,
  };
}

/** Path for one data module at (x, y), shaped according to its neighbours where relevant. */
function modulePath(shape: QrStyle['modules']['shape'], m: QrMatrix, row: number, col: number, x: number, y: number) {
  const dark = (r: number, c: number) => m.isDark(r, c) && !isFinderModule(m.size, r, c);
  const up = dark(row - 1, col);
  const down = dark(row + 1, col);
  const left = dark(row, col - 1);
  const right = dark(row, col + 1);
  switch (shape) {
    case 'square':
      return `M${x} ${y}h1v1h-1Z`;
    case 'dots':
      return circlePath(x + 0.5, y + 0.5, 0.45);
    case 'diamond':
      return diamondPath(x + 0.5, y + 0.5, 0.55);
    case 'rounded': {
      // Round a corner only when both edges meeting at it are exposed: runs join into smooth bars.
      const r = 0.5;
      return rectPath(x, y, 1, 1, [!up && !left ? r : 0, !up && !right ? r : 0, !down && !right ? r : 0, !down && !left ? r : 0]);
    }
    case 'classy': {
      const r = 0.6;
      return rectPath(x, y, 1, 1, [!up && !left ? r : 0, 0, !down && !right ? r : 0, 0]);
    }
    case 'vertical': {
      const r = 0.4;
      return rectPath(x + 0.1, y, 0.8, 1, [up ? 0 : r, up ? 0 : r, down ? 0 : r, down ? 0 : r]);
    }
    case 'horizontal': {
      const r = 0.4;
      return rectPath(x, y + 0.1, 1, 0.8, [left ? 0 : r, right ? 0 : r, right ? 0 : r, left ? 0 : r]);
    }
  }
}

function eyeOuterPath(shape: QrStyle['eyes']['outerShape'], x: number, y: number, position: EyePosition): string {
  switch (shape) {
    case 'square':
      return rectPath(x, y, 7, 7) + rectPath(x + 1, y + 1, 5, 5);
    case 'rounded':
      return rectPath(x, y, 7, 7, [2, 2, 2, 2]) + rectPath(x + 1, y + 1, 5, 5, [1.2, 1.2, 1.2, 1.2]);
    case 'extra-rounded':
      return rectPath(x, y, 7, 7, [3, 3, 3, 3]) + rectPath(x + 1, y + 1, 5, 5, [2.1, 2.1, 2.1, 2.1]);
    case 'circle':
      return circlePath(x + 3.5, y + 3.5, 3.5) + circlePath(x + 3.5, y + 3.5, 2.5);
    case 'leaf': {
      const outer = orientCorners([3, 0, 3, 0], position);
      const inner = orientCorners([2, 0, 2, 0], position);
      return rectPath(x, y, 7, 7, outer) + rectPath(x + 1, y + 1, 5, 5, inner);
    }
  }
}

function eyeInnerPath(shape: QrStyle['eyes']['innerShape'], x: number, y: number, position: EyePosition): string {
  const cx = x + 1.5;
  const cy = y + 1.5;
  switch (shape) {
    case 'square':
      return rectPath(x, y, 3, 3);
    case 'rounded':
      return rectPath(x, y, 3, 3, [0.9, 0.9, 0.9, 0.9]);
    case 'circle':
      return circlePath(cx, cy, 1.5);
    case 'diamond':
      return diamondPath(cx, cy, 1.85);
    case 'leaf':
      return rectPath(x, y, 3, 3, orientCorners([1.5, 0, 1.5, 0], position));
    case 'star':
      return starPath(cx, cy + 0.1, 1.85, 1.1);
  }
}

/** Icon of a phone scanning a code, drawn in a 24x24 box. */
function scanIconPath(x: number, y: number, size: number): string {
  const s = size / 24;
  const p = (px: number, py: number, w: number, h: number, r = 0) => rectPath(x + px * s, y + py * s, w * s, h * s, [r * s, r * s, r * s, r * s]);
  // Corner brackets.
  const t = 2;
  const l = 6;
  const brackets = [
    p(1, 1, l, t, 1), p(1, 1, t, l, 1),
    p(23 - l, 1, l, t, 1), p(23 - t, 1, t, l, 1),
    p(1, 23 - t, l, t, 1), p(1, 23 - l, t, l, 1),
    p(23 - l, 23 - t, l, t, 1), p(23 - t, 23 - l, t, l, 1),
  ].join('');
  // Three tiny finder patterns plus a few data dots.
  const finder = (fx: number, fy: number) => p(fx, fy, 5, 5, 1) + p(fx + 1.4, fy + 1.4, 2.2, 2.2, 0.4);
  const dots = p(14, 14, 2, 2, 0.6) + p(17, 17, 2, 2, 0.6) + p(14, 17.5, 1.6, 1.6, 0.6) + p(17.5, 14, 1.6, 1.6, 0.6);
  return brackets + finder(5, 5) + finder(14, 5) + finder(5, 14) + dots;
}

interface Layout {
  width: number;
  height: number;
  /** Top-left of the QR area (quiet zone included). */
  qrX: number;
  qrY: number;
  parts: string[];
  /** Parts drawn after the QR code (on top). */
  overlays: string[];
}

function layoutFrame(style: QrStyle, qrWidth: number): Layout {
  const f = style.frame;
  const W = qrWidth;
  const t = W * 0.045; // border thickness
  const radius = (base: number) => base * f.rounding;
  const text = f.text.trim();

  const textShape = (cx: number, cy: number, maxWidth: number, maxFont: number, color: string) => {
    if (!text) return '';
    const shape = textToPath(text, { cx, cy, maxWidth, maxFontSize: maxFont, weight: 'semibold' });
    return shape.d ? `<path fill="${color}" d="${shape.d}"/>` : '';
  };

  switch (f.style) {
    case 'none':
      return { width: W, height: W, qrX: 0, qrY: 0, parts: [], overlays: [] };

    case 'card-pill': {
      // Rounded card around the code with a separate pill-shaped call to action underneath.
      const cardW = W + t * 2;
      const gap = W * 0.04;
      const pillH = W * 0.24;
      const height = cardW + gap + pillH;
      const cardR = radius(W * 0.09);
      const innerR = Math.max(0, cardR - t);
      const parts = [
        `<path fill="${f.color}" d="${rectPath(0, 0, cardW, cardW, [cardR, cardR, cardR, cardR])}"/>`,
        `<path fill="${f.innerColor}" d="${rectPath(t, t, W, W, [innerR, innerR, innerR, innerR])}"/>`,
      ];
      const pillY = cardW + gap;
      const pillR = radius(pillH / 2);
      parts.push(`<path fill="${f.color}" d="${rectPath(0, pillY, cardW, pillH, [pillR, pillR, pillR, pillR])}"/>`);
      let textLeft = pillH * 0.35;
      if (f.showIcon) {
        const d = pillH * 0.8;
        const cx = pillH * 0.1 + d / 2;
        const cy = pillY + pillH / 2;
        parts.push(`<path fill="${f.innerColor}" d="${f.rounding > 0.15 ? circlePath(cx, cy, d / 2) : rectPath(cx - d / 2, cy - d / 2, d, d, [d * 0.15, d * 0.15, d * 0.15, d * 0.15])}"/>`);
        const icon = d * 0.5;
        parts.push(`<path fill="${f.color}" d="${scanIconPath(cx - icon / 2, cy - icon / 2, icon)}"/>`);
        textLeft = pillH * 0.1 + d + pillH * 0.15;
      }
      const textRight = cardW - pillH * 0.35;
      parts.push(textShape((textLeft + textRight) / 2, pillY + pillH / 2, textRight - textLeft, pillH * 0.32, f.textColor));
      return { width: cardW, height, qrX: t, qrY: t, parts, overlays: [] };
    }

    case 'banner-bottom':
    case 'banner-top': {
      const bandH = W * 0.2;
      const width = W + t * 2;
      const height = W + t * 2 + bandH - t;
      const r = radius(W * 0.08);
      const innerR = Math.max(0, r - t);
      const top = f.style === 'banner-top';
      const qrY = top ? bandH : t;
      const parts = [
        `<path fill="${f.color}" d="${rectPath(0, 0, width, height, [r, r, r, r])}"/>`,
        `<path fill="${f.innerColor}" d="${rectPath(t, qrY, W, W, top ? [0, 0, innerR, innerR] : [innerR, innerR, 0, 0])}"/>`,
      ];
      const bandCy = top ? bandH / 2 : qrY + W + bandH / 2;
      let textCx = width / 2;
      let maxTextW = width - bandH * 0.8;
      if (f.showIcon) {
        const icon = bandH * 0.5;
        const tw = Math.min(
          maxTextW - icon * 1.4,
          text ? textToPath(text, { cx: 0, cy: 0, maxWidth: maxTextW - icon * 1.4, maxFontSize: bandH * 0.42 }).width : 0,
        );
        const groupW = icon + (text ? icon * 0.4 + tw : 0);
        const ix = width / 2 - groupW / 2;
        parts.push(`<path fill="${f.textColor}" d="${scanIconPath(ix, bandCy - icon / 2, icon)}"/>`);
        textCx = ix + icon + icon * 0.4 + tw / 2;
        maxTextW = tw;
      }
      parts.push(textShape(textCx, bandCy, maxTextW, bandH * 0.42, f.textColor));
      return { width, height, qrX: t, qrY, parts, overlays: [] };
    }

    case 'outline-label': {
      const stroke = W * 0.025;
      const pad = W * 0.04;
      const labelH = W * 0.18;
      const width = W + (stroke + pad) * 2;
      const height = W + (stroke + pad) * 2 + labelH;
      const r = radius(W * 0.08);
      const half = stroke / 2;
      const parts = [
        `<path fill="${f.innerColor}" stroke="${f.color}" stroke-width="${fmt(stroke)}" d="${rectPath(half, half, width - stroke, height - stroke, [r, r, r, r])}"/>`,
        textShape(width / 2, stroke + pad + W + labelH / 2 - pad / 2, width - (stroke + pad) * 4, labelH * 0.5, f.textColor),
      ];
      return { width, height, qrX: stroke + pad, qrY: stroke + pad, parts, overlays: [] };
    }
  }
}

export function renderQrSvg(opts: RenderOptions): RenderResult {
  const { style } = opts;
  const matrix = buildMatrix(opts.data, effectiveErrorCorrection(style));
  const size = matrix.size;
  const margin = style.margin;
  const qrWidth = size + margin * 2;

  const layout = layoutFrame(style, qrWidth);
  const ox = layout.qrX + margin; // origin of module (0,0)
  const oy = layout.qrY + margin;

  // ---- logo geometry and excavation --------------------------------------------------------
  const logo = style.logo.assetId && opts.logo ? opts.logo : null;
  const center = size / 2;
  const plate = style.logo.plate;
  // `size` is the cleared area (what affects scanning); the logo is fitted inside it.
  const plateSize = size * style.logo.size;
  const half = plateSize / 2;
  const fit = plate === 'diamond' ? 0.5 : plate === 'circle' ? 0.78 : 1; // largest square inside the plate
  const logoSide = (plateSize * fit) / (1 + style.logo.padding * 2);
  const insidePlate = (row: number, col: number) => {
    const dx = Math.abs(col + 0.5 - center);
    const dy = Math.abs(row + 0.5 - center);
    const grow = 0.15; // also clear modules the plate edge would barely clip
    if (plate === 'circle') return Math.hypot(dx, dy) < half + grow;
    if (plate === 'diamond') return dx + dy < half + grow;
    return dx < half + grow && dy < half + grow;
  };
  const excavate = logo !== null && style.logo.excavate;

  // ---- data modules ----------------------------------------------------------------------
  let modules = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!matrix.isDark(row, col) || isFinderModule(size, row, col)) continue;
      if (excavate && insidePlate(row, col)) continue;
      modules += modulePath(style.modules.shape, matrix, row, col, col, row);
    }
  }

  // ---- eyes ------------------------------------------------------------------------------
  let eyeOuter = '';
  let eyeInner = '';
  for (const eye of eyeOrigins(size)) {
    eyeOuter += eyeOuterPath(style.eyes.outerShape, eye.col, eye.row, eye.position);
    eyeInner += eyeInnerPath(style.eyes.innerShape, eye.col + 2, eye.row + 2, eye.position);
  }

  const fg = fillDefs(style.foreground, 'qrd-fg', 0, 0, size);
  const defs = [fg.defs];
  const body: string[] = [...layout.parts];

  if (!style.background.transparent) {
    body.push(`<rect x="${fmt(layout.qrX)}" y="${fmt(layout.qrY)}" width="${fmt(qrWidth)}" height="${fmt(qrWidth)}" fill="${style.background.color}"/>`);
  }

  const symbol: string[] = [];
  symbol.push(`<path fill="${fg.paint}" d="${modules}"/>`);
  symbol.push(`<path fill="${style.eyes.outerColor ?? fg.paint}" fill-rule="evenodd" d="${eyeOuter}"/>`);
  symbol.push(`<path fill="${style.eyes.innerColor ?? fg.paint}" d="${eyeInner}"/>`);

  if (logo) {
    const c = center;
    let plateShape = '';
    if (plate === 'square') plateShape = rectPath(c - half, c - half, plateSize, plateSize);
    if (plate === 'rounded') {
      const r = plateSize * 0.2;
      plateShape = rectPath(c - half, c - half, plateSize, plateSize, [r, r, r, r]);
    }
    if (plate === 'circle') plateShape = circlePath(c, c, half);
    if (plate === 'diamond') plateShape = diamondPath(c, c, half);
    if (plateShape) {
      const border = style.logo.borderColor
        ? ` stroke="${style.logo.borderColor}" stroke-width="${fmt(Math.max(0.3, logoSide * 0.05))}" stroke-linejoin="round"`
        : '';
      symbol.push(`<path fill="${style.logo.plateColor}"${border} d="${plateShape}"/>`);
    }
    symbol.push(
      `<image x="${fmt(c - logoSide / 2)}" y="${fmt(c - logoSide / 2)}" width="${fmt(logoSide)}" height="${fmt(logoSide)}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(logo.href)}"/>`,
    );
  }

  body.push(`<g transform="translate(${fmt(ox)} ${fmt(oy)})">${symbol.join('')}</g>`);
  body.push(...layout.overlays);

  const vw = layout.width;
  const vh = layout.height;
  const unit = opts.unit ?? 'px';
  const outW = opts.width ?? 1024;
  const outH = (outW * vh) / vw;
  const dim = (v: number) => (unit === 'px' ? fmt(v) : `${fmt(v)}${unit}`);
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${fmt(vw)} ${fmt(vh)}" width="${dim(outW)}" height="${dim(outH)}">` +
    title +
    (defs.join('') ? `<defs>${defs.join('')}</defs>` : '') +
    body.filter(Boolean).join('') +
    `</svg>`;

  return { svg, viewBox: { width: vw, height: vh }, version: matrix.version, modules: size };
}
