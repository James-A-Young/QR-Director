import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound, parse, uuidParam } from '../http.js';
import { qrPayload } from '../qr/matrix.js';
import { MAX_PNG_DIMENSION, MAX_PNG_PIXELS, svgToPng } from '../qr/png.js';
import { renderQrSvg } from '../qr/render.js';
import { parseStyle, qrStyleSchema, styleWarnings, type QrStyle } from '../qr/style.js';
import { loadLogoHref, shortUrl } from '../services/repo.js';

const exportQuery = z.object({
  format: z.enum(['svg', 'png']).default('png'),
  width: z.coerce.number().positive().max(MAX_PNG_DIMENSION).default(1024),
  unit: z.enum(['px', 'mm', 'in']).default('px'),
  dpi: z.coerce.number().int().min(72).max(1200).default(300),
  download: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
});

/** Convert a physical width to pixels for raster output. */
export function widthInPixels(width: number, unit: 'px' | 'mm' | 'in', dpi: number): number {
  if (unit === 'px') return width;
  const inches = unit === 'mm' ? width / 25.4 : width;
  return inches * dpi;
}

export async function qrRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;

  async function render(data: string, style: QrStyle, opts: { width: number; unit: 'px' | 'mm' | 'in'; title?: string }) {
    const logoHref = await loadLogoHref(db, style.logo.assetId);
    if (style.logo.assetId && !logoHref) throw new HttpError(422, 'logo_missing', 'The logo for this design no longer exists');
    return renderQrSvg({
      data: qrPayload(data, config.QR_UPPERCASE_URLS),
      style,
      logo: logoHref ? { href: logoHref } : null,
      width: opts.width,
      unit: opts.unit,
      title: opts.title,
    });
  }

  /** Live preview for the designer. Returns SVG markup plus scannability warnings. */
  app.post('/api/qr/preview', async (req) => {
    const body = parse(
      z.object({ style: qrStyleSchema, linkId: z.string().uuid().optional(), code: z.string().max(64).optional() }),
      req.body,
    );
    let code = body.code ?? 'preview';
    if (body.linkId) {
      const link = await db.selectFrom('links').select('code').where('id', '=', body.linkId).executeTakeFirst();
      if (!link) throw notFound('Link');
      code = link.code;
    }
    const result = await render(shortUrl(config, code), body.style, { width: 512, unit: 'px' });
    return {
      svg: result.svg,
      width: result.viewBox.width,
      height: result.viewBox.height,
      version: result.version,
      modules: result.modules,
      warnings: styleWarnings(body.style),
    };
  });

  app.get('/api/links/:id/qr', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const q = parse(exportQuery, req.query);
    const link = await db.selectFrom('links').select(['code', 'qr_style', 'source_label']).where('id', '=', id).executeTakeFirst();
    if (!link) throw notFound('Link');
    const style = parseStyle(link.qr_style);
    const url = shortUrl(config, link.code);
    const filename = `qr-${link.code}`;
    const disposition = (ext: string) => `${q.download ? 'attachment' : 'inline'}; filename="${filename}.${ext}"`;

    if (q.format === 'svg') {
      const result = await render(url, style, { width: q.width, unit: q.unit, title: url });
      return reply.type('image/svg+xml').header('content-disposition', disposition('svg')).header('cache-control', 'no-store').send(result.svg);
    }
    const px = widthInPixels(q.width, q.unit, q.dpi);
    if (px > MAX_PNG_DIMENSION) throw new HttpError(400, 'too_large', `PNG output is limited to ${MAX_PNG_DIMENSION}px wide`);
    const result = await render(url, style, { width: px, unit: 'px', title: url });
    const pixels = px * ((px * result.viewBox.height) / result.viewBox.width);
    if (pixels > MAX_PNG_PIXELS) {
      throw new HttpError(400, 'too_large', `PNG output is limited to ${MAX_PNG_PIXELS / 1e6} megapixels; use SVG for larger prints`);
    }
    const png = await svgToPng(result.svg, px, q.dpi);
    return reply.type('image/png').header('content-disposition', disposition('png')).header('cache-control', 'no-store').send(png);
  });
}
