import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

type Font = ReturnType<typeof opentype.parse>;

const fonts = new Map<string, Font>();

function loadFont(file: string): Font {
  let font = fonts.get(file);
  if (!font) {
    const buf = readFileSync(fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url)));
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    fonts.set(file, font);
  }
  return font;
}

export interface TextShape {
  /** SVG path data for the text outlines. */
  d: string;
  width: number;
  fontSize: number;
}

/**
 * Lays text out glyph by glyph (no complex shaping) and converts it to outlines, so exported SVGs
 * do not depend on fonts being installed wherever the file is opened or printed.
 *
 * The text is horizontally centred on `cx` and vertically centred (by cap height) on `cy`, shrinking
 * the font size if needed so it fits within `maxWidth`.
 */
export function textToPath(
  text: string,
  opts: { cx: number; cy: number; maxWidth: number; maxFontSize: number; weight?: 'semibold' | 'bold' },
): TextShape {
  const font = loadFont(opts.weight === 'bold' ? 'Inter-Bold.otf' : 'Inter-SemiBold.otf');
  const glyphs = Array.from(text).map((ch) => font.charToGlyph(ch));
  const unitsWidth = glyphs.reduce((sum, g, i) => {
    const next = glyphs[i + 1];
    return sum + (g.advanceWidth ?? 0) + (next ? font.getKerningValue(g, next) : 0);
  }, 0);
  if (unitsWidth === 0) return { d: '', width: 0, fontSize: opts.maxFontSize };

  const fontSize = Math.min(opts.maxFontSize, (opts.maxWidth * font.unitsPerEm) / unitsWidth);
  const scale = fontSize / font.unitsPerEm;
  const width = unitsWidth * scale;
  const capHeight = ((font.tables.os2?.sCapHeight as number | undefined) ?? font.unitsPerEm * 0.7) * scale;
  const baseline = opts.cy + capHeight / 2;

  let x = opts.cx - width / 2;
  let d = '';
  glyphs.forEach((g, i) => {
    d += g.getPath(x, baseline, fontSize).toPathData(3);
    const next = glyphs[i + 1];
    x += ((g.advanceWidth ?? 0) + (next ? font.getKerningValue(g, next) : 0)) * scale;
  });
  return { d, width, fontSize };
}
