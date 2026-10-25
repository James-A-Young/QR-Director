import type { FastifyInstance, FastifyReply } from 'fastify';
import { CODE_PATTERN, normaliseCode } from '../services/codes.js';
import { buildHit, resolveDestination } from '../services/tracking.js';
import { errorPage } from '../pages.js';
import type { UtmParams } from '../db/schema.js';

/** Recording a hit must never hold a visitor up for long or stop the redirect. */
const HIT_WRITE_TIMEOUT_MS = 1500;

export async function redirectRoutes(app: FastifyInstance) {
  const { db, config, geo } = app.ctx;

  const notFound = (reply: FastifyReply, title: string, message: string) => {
    if (config.NOT_FOUND_REDIRECT_URL) return reply.redirect(config.NOT_FOUND_REDIRECT_URL, 302);
    return reply.code(404).type('text/html').header('cache-control', 'no-store').send(errorPage(title, message));
  };

  app.get('/', async (_req, reply) => reply.redirect(config.ROOT_REDIRECT_URL ?? '/app', 302));

  app.get('/:code', async (req, reply) => {
    const code = normaliseCode((req.params as { code: string }).code);
    if (!CODE_PATTERN.test(code)) return notFound(reply, 'Link not found', 'This link does not exist.');

    const link = await db
      .selectFrom('links')
      .innerJoin('campaigns', 'campaigns.id', 'links.campaign_id')
      .select([
        'links.id',
        'links.campaign_id',
        'links.active',
        'links.destination_url',
        'links.utm',
        'campaigns.destination_url as campaign_destination',
      ])
      .where('links.code', '=', code)
      .executeTakeFirst();

    if (!link) return notFound(reply, 'Link not found', 'This link does not exist or has been removed.');
    if (!link.active) return notFound(reply, 'Link unavailable', 'This link is no longer active.');

    const query = req.query as Record<string, unknown>;
    const destination = resolveDestination(link.destination_url ?? link.campaign_destination, link.utm as UtmParams, query);

    // HEAD requests (link previewers, uptime checks) are not counted as visits.
    if (req.method === 'GET') {
      const hit = buildHit(
        { ip: req.ip ?? null, headers: req.headers, query },
        { linkId: link.id, campaignId: link.campaign_id, destinationUrl: destination, secret: config.SESSION_SECRET, geo },
      );
      // Await the write (Cloud Run may throttle CPU after the response) but with a timeout, and
      // never fail the redirect because analytics could not be stored.
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          db.insertInto('hits').values(hit).execute(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('hit write timed out')), HIT_WRITE_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        req.log.error({ err, code }, 'Failed to record hit');
      } finally {
        clearTimeout(timer);
      }
    }

    // 302 (not 301) so browsers never cache the target: destinations can change at any time.
    return reply
      .header('cache-control', 'private, no-store, max-age=0')
      .header('referrer-policy', 'no-referrer-when-downgrade')
      .header('x-robots-tag', 'noindex')
      .redirect(destination, 302);
  });
}
