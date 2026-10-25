import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { renderQrSvg } from '../src/qr/render.js';
import { svgToPng, withDpi } from '../src/qr/png.js';
import { qrPayload, buildMatrix, isFinderModule } from '../src/qr/matrix.js';
import {
  EYE_INNER_SHAPES,
  EYE_OUTER_SHAPES,
  FRAME_STYLES,
  LOGO_PLATES,
  MODULE_SHAPES,
  parseStyle,
  type QrStyleInput,
} from '../src/qr/style.js';
import { decodePng } from './qr-decode.js';

const URL_TEXT = 'https://go.example.com/abc123';
const PAYLOAD = qrPayload(URL_TEXT, true);
const LOGO_ID = '00000000-0000-4000-8000-000000000001';
const logoSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 95 50 50 95 5 50Z" fill="#72b856"/><path d="M50 25 75 50 50 75 25 50Z" fill="#fff"/></svg>';
const LOGO = { href: `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}` };

async function roundTrip(style: QrStyleInput, opts: { logo?: boolean; width?: number } = {}): Promise<string | null> {
  const parsed = parseStyle(style);
  const { svg } = renderQrSvg({ data: PAYLOAD, style: parsed, logo: opts.logo ? LOGO : null });
  return decodePng(await svgToPng(svg, opts.width ?? 700));
}

describe('qrPayload', () => {
  it('upper-cases URLs so they fit the alphanumeric mode', async () => {
    expect(qrPayload('https://go.example.com/abc-123', true)).toBe('HTTPS://GO.EXAMPLE.COM/ABC-123');
  });
  it('leaves URLs alone when disabled or when characters are outside the alphanumeric set', async () => {
    expect(qrPayload('https://go.example.com/abc', false)).toBe('https://go.example.com/abc');
    expect(qrPayload('https://go.example.com/a?b=c', true)).toBe('https://go.example.com/a?b=c');
  });
  it('produces a smaller symbol than byte mode', async () => {
    const long = 'https://marketing.example.co.uk/spring-launch';
    expect(buildMatrix(qrPayload(long, true), 'Q').size).toBeLessThan(buildMatrix(long, 'Q').size);
  });
});

describe('isFinderModule', () => {
  it('identifies the three 7x7 finder regions', async () => {
    expect(isFinderModule(21, 0, 0)).toBe(true);
    expect(isFinderModule(21, 6, 20)).toBe(true);
    expect(isFinderModule(21, 20, 6)).toBe(true);
    expect(isFinderModule(21, 20, 20)).toBe(false);
    expect(isFinderModule(21, 7, 7)).toBe(false);
  });
});

describe('renderQrSvg scannability', () => {
  it('decodes with the default style', async () => {
    await expect(roundTrip({})).resolves.toBe(PAYLOAD);
  });

  it.each(MODULE_SHAPES)('decodes with %s modules', async (shape) => {
    await expect(roundTrip({ modules: { shape } })).resolves.toBe(PAYLOAD);
  });

  it.each(EYE_OUTER_SHAPES.flatMap((o) => EYE_INNER_SHAPES.map((i) => [o, i] as const)))(
    'decodes with %s eyes and %s pupils',
    async (outerShape, innerShape) => {
      await expect(roundTrip({ eyes: { outerShape, innerShape, outerColor: '#4179a7', innerColor: '#2f6b1f' } })).resolves.toBe(PAYLOAD);
    },
  );

  it.each(FRAME_STYLES)('decodes inside the %s frame', async (style) => {
    await expect(roundTrip({ frame: { style, text: 'SCAN FOR MORE INFO', color: '#72b856' } })).resolves.toBe(PAYLOAD);
  });

  it.each(LOGO_PLATES)('decodes with a centred logo on a %s plate', async (plate) => {
    await expect(roundTrip({ logo: { assetId: LOGO_ID, plate, size: 0.3 } }, { logo: true })).resolves.toBe(PAYLOAD);
  });

  it('decodes with the largest permitted logo', async () => {
    const style = { logo: { assetId: LOGO_ID, size: 0.3, plate: 'square' as const }, modules: { shape: 'rounded' as const } };
    await expect(roundTrip(style, { logo: true })).resolves.toBe(PAYLOAD);
  });

  it('decodes with linear and radial gradients', async () => {
    await expect(roundTrip({ foreground: { type: 'linear', from: '#7c3aed', to: '#1e3a8a', angle: 135 } })).resolves.toBe(PAYLOAD);
    await expect(roundTrip({ foreground: { type: 'radial', from: '#0f172a', to: '#4f46e5' } })).resolves.toBe(PAYLOAD);
  });

  it('decodes the reference design (rounded, blue on white, diamond eyes, logo, CTA pill)', async () => {
    await expect(
      roundTrip(
        {
          modules: { shape: 'rounded' },
          foreground: { type: 'solid', color: '#4179a7' },
          eyes: { outerShape: 'extra-rounded', innerShape: 'diamond', innerColor: '#72b856' },
          logo: { assetId: LOGO_ID, plate: 'none', size: 0.25 },
          frame: { style: 'card-pill', color: '#72b856', text: 'SCAN FOR MORE INFO' },
        },
        { logo: true },
      ),
    ).resolves.toBe(PAYLOAD);
  });

  it('decodes a transparent background when placed on white', async () => {
    await expect(roundTrip({ background: { transparent: true } })).resolves.toBe(PAYLOAD);
  });

  it('decodes at small print sizes', async () => {
    await expect(roundTrip({ modules: { shape: 'dots' } }, { width: 220 })).resolves.toBe(PAYLOAD);
  });

  it('decodes long, mixed-case payloads in byte mode', async () => {
    const data = 'https://example.com/Path?With=Query&and=Things';
    const { svg } = renderQrSvg({ data, style: parseStyle({ modules: { shape: 'classy' } }) });
    await expect(decodePng(await svgToPng(svg, 800))).resolves.toBe(data);
  });
});

describe('renderQrSvg output', () => {
  it('emits physical units for print sizes and keeps the frame aspect ratio', async () => {
    const r = renderQrSvg({ data: PAYLOAD, style: parseStyle({ frame: { style: 'card-pill' } }), width: 50, unit: 'mm' });
    expect(r.svg).toMatch(/width="50mm"/);
    const height = Number(/height="([\d.]+)mm"/.exec(r.svg)![1]);
    expect(height).toBeCloseTo((50 * r.viewBox.height) / r.viewBox.width, 2);
    expect(r.viewBox.height).toBeGreaterThan(r.viewBox.width);
  });

  it('converts frame text to outlines so no fonts are needed', async () => {
    const r = renderQrSvg({ data: PAYLOAD, style: parseStyle({ frame: { style: 'banner-bottom', text: 'Hello & <welcome>' } }) });
    expect(r.svg).not.toContain('<text');
    expect(r.svg).not.toContain('<welcome>');
  });

  it('escapes titles and image hrefs', async () => {
    const r = renderQrSvg({ data: PAYLOAD, style: parseStyle({}), title: '<script>"x"</script>' });
    expect(r.svg).toContain('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });

  it('uses the requested colours', async () => {
    const r = renderQrSvg({
      data: PAYLOAD,
      style: parseStyle({
        foreground: { type: 'solid', color: '#123456' },
        background: { color: '#FAFAFA' },
        eyes: { outerColor: '#aa0000', innerColor: '#00aa00' },
      }),
    });
    expect(r.svg).toContain('fill="#123456"');
    expect(r.svg).toContain('fill="#fafafa"');
    expect(r.svg).toContain('fill="#aa0000"');
    expect(r.svg).toContain('fill="#00aa00"');
  });

  it('omits the background rectangle when transparent', async () => {
    const r = renderQrSvg({ data: PAYLOAD, style: parseStyle({ background: { transparent: true, color: '#abcdef' } }) });
    expect(r.svg).not.toContain('#abcdef');
  });

  it('only draws a logo when one is supplied', async () => {
    const style = parseStyle({ logo: { assetId: LOGO_ID } });
    expect(renderQrSvg({ data: PAYLOAD, style }).svg).not.toContain('<image');
    expect(renderQrSvg({ data: PAYLOAD, style, logo: LOGO }).svg).toContain('<image');
  });

  it('forces high error correction when a logo is used', async () => {
    const plain = renderQrSvg({ data: PAYLOAD, style: parseStyle({ errorCorrection: 'L' }) });
    const withLogo = renderQrSvg({ data: PAYLOAD, style: parseStyle({ errorCorrection: 'L', logo: { assetId: LOGO_ID } }), logo: LOGO });
    expect(withLogo.version).toBeGreaterThan(plain.version);
  });
});

describe('svgToPng', () => {
  it('renders at the requested pixel width', async () => {
    const { svg } = renderQrSvg({ data: PAYLOAD, style: parseStyle({ frame: { style: 'banner-top' } }) });
    const img = PNG.sync.read(await svgToPng(svg, 640));
    expect(img.width).toBe(640);
    expect(img.height).toBeGreaterThan(640);
  });

  it('embeds DPI metadata', async () => {
    const { svg } = renderQrSvg({ data: PAYLOAD, style: parseStyle({}) });
    const png = await svgToPng(svg, 300, 600);
    const idx = png.indexOf('pHYs');
    expect(idx).toBeGreaterThan(0);
    const ppm = png.readUInt32BE(idx + 4);
    expect(Math.round(ppm * 0.0254)).toBe(600);
    // The PNG must still be valid after the chunk is spliced in.
    expect(() => PNG.sync.read(png)).not.toThrow();
  });

  it('replaces an existing pHYs chunk instead of duplicating it', async () => {
    const { svg } = renderQrSvg({ data: PAYLOAD, style: parseStyle({}) });
    const png = withDpi(await svgToPng(svg, 200, 300), 150);
    expect(png.toString('latin1').split('pHYs').length - 1).toBe(1);
  });
});
