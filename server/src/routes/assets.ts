import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound, parse, uuidParam } from '../http.js';

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

type AllowedMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

/** Identify the real type from the bytes rather than trusting the client. */
export function sniffMime(data: Buffer): AllowedMime | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const head = data.subarray(0, 1024).toString('utf8').trimStart().replace(/^\uFEFF/, '');
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * Reject SVG features that could execute script or pull in external/local resources when the logo is
 * rasterised. Logos are simple artwork, so a strict allow-list is acceptable.
 */
export function svgProblem(svg: string): string | null {
  if (/<script[\s/>]/i.test(svg)) return 'SVG logos may not contain scripts';
  if (/<foreignObject[\s/>]/i.test(svg)) return 'SVG logos may not contain foreignObject';
  if (/<!ENTITY/i.test(svg)) return 'SVG logos may not declare entities';
  if (/\son[a-z]+\s*=/i.test(svg)) return 'SVG logos may not contain event handlers';
  const hrefs = svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi);
  for (const [, , value] of hrefs) {
    if (value && !value.startsWith('#') && !value.startsWith('data:image/')) {
      return 'SVG logos may only reference embedded images';
    }
  }
  if (/url\(\s*['"]?(?!#)/i.test(svg)) return 'SVG logos may only reference internal url(#id) values';
  return null;
}

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  /** Base64 file contents, optionally as a data: URL. */
  data: z.string().min(1).max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 200),
});

export async function assetRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  app.post('/api/assets', async (req, reply) => {
    const body = parse(uploadSchema, req.body);
    const base64 = body.data.replace(/^data:[^;,]+;base64,/, '');
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0) throw new HttpError(400, 'invalid_file', 'The file is empty');
    if (data.length > MAX_ASSET_BYTES) throw new HttpError(413, 'file_too_large', 'Logos must be 2 MB or smaller');
    const mime = sniffMime(data);
    if (!mime) throw new HttpError(415, 'unsupported_type', 'Logos must be PNG, JPEG, WebP or SVG');
    if (mime === 'image/svg+xml') {
      const problem = svgProblem(data.toString('utf8'));
      if (problem) throw new HttpError(422, 'unsafe_svg', problem);
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    const existing = await db.selectFrom('assets').select(['id', 'filename', 'mime', 'byte_size']).where('sha256', '=', sha256).executeTakeFirst();
    const asset =
      existing ??
      (await db
        .insertInto('assets')
        .values({ filename: body.filename, mime, byte_size: data.length, sha256, data, created_by: req.user!.uid })
        .returning(['id', 'filename', 'mime', 'byte_size'])
        .executeTakeFirstOrThrow());
    return reply.code(existing ? 200 : 201).send({ id: asset.id, filename: asset.filename, mime: asset.mime, size: asset.byte_size });
  });

  app.get('/api/assets/:id', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const asset = await db.selectFrom('assets').select(['mime', 'data']).where('id', '=', id).executeTakeFirst();
    if (!asset) throw notFound('Asset');
    return reply
      .type(asset.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      // Even a hostile SVG opened directly cannot run script on our origin.
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      .header('x-content-type-options', 'nosniff')
      .send(asset.data);
  });
}
