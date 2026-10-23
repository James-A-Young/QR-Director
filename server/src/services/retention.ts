import { sql } from 'kysely';
import type { DB } from '../db/database.js';

export interface RetentionResult {
  ipsCleared: number;
  hitsDeleted: number;
}

/** Blank raw IPs and/or drop whole hit rows older than the configured windows. 0 disables a rule. */
export async function applyRetention(db: DB, opts: { rawIpDays: number; hitDays: number }): Promise<RetentionResult> {
  let ipsCleared = 0;
  let hitsDeleted = 0;
  if (opts.hitDays > 0) {
    const res = await db
      .deleteFrom('hits')
      .where('occurred_at', '<', sql<Date>`now() - make_interval(days => ${opts.hitDays})`)
      .executeTakeFirst();
    hitsDeleted = Number(res.numDeletedRows);
  }
  if (opts.rawIpDays > 0) {
    const res = await db
      .updateTable('hits')
      .set({ ip: null })
      .where('ip', 'is not', null)
      .where('occurred_at', '<', sql<Date>`now() - make_interval(days => ${opts.rawIpDays})`)
      .executeTakeFirst();
    ipsCleared = Number(res.numUpdatedRows);
  }
  return { ipsCleared, hitsDeleted };
}
