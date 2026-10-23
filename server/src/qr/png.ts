import { crc32 } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

export const MAX_PNG_DIMENSION = 8000;

/** Rasterise an SVG to PNG at an exact pixel width, embedding DPI metadata so print tools size it correctly. */
export function svgToPng(svg: string, widthPx: number, dpi = 300): Buffer {
  const width = Math.max(16, Math.min(MAX_PNG_DIMENSION, Math.round(widthPx)));
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    // All text is converted to outlines, so no fonts are needed.
    font: { loadSystemFonts: false },
    imageRendering: 0,
    shapeRendering: 2,
  });
  const png = resvg.render().asPng();
  return withDpi(png, dpi);
}

/** Insert (or replace) a pHYs chunk declaring the image resolution. */
export function withDpi(png: Buffer, dpi: number): Buffer {
  const signatureLength = 8;
  const ihdrEnd = signatureLength + 8 + png.readUInt32BE(signatureLength) + 4;
  const pixelsPerMetre = Math.round(dpi / 0.0254);

  const data = Buffer.alloc(9);
  data.writeUInt32BE(pixelsPerMetre, 0);
  data.writeUInt32BE(pixelsPerMetre, 4);
  data.writeUInt8(1, 8); // unit: metre
  const type = Buffer.from('pHYs', 'ascii');
  const chunk = Buffer.alloc(4 + 4 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 8 + data.length);

  // Strip any existing pHYs chunk.
  const chunks: Buffer[] = [png.subarray(0, ihdrEnd), chunk];
  let offset = ihdrEnd;
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const end = offset + 12 + len;
    if (png.toString('ascii', offset + 4, offset + 8) !== 'pHYs') chunks.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}
