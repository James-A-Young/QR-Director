import { Kysely, PostgresDialect } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';
import type { Database } from './schema.js';
import * as m001 from './migrations/001_initial.js';

// Return bigint identity columns (hit ids, counts) as JS numbers; they comfortably fit.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export type DB = Kysely<Database>;

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
  ssl?: boolean;
}

export function createDatabase(opts: DatabaseOptions): DB {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Migrations are bundled in code (not read from disk) so the compiled output is self-contained. */
const migrations: Record<string, Migration> = {
  '001_initial': m001,
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  }
}

export async function migrateToLatest(db: DB): Promise<string[]> {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();
  const failed = results?.find((r) => r.status === 'Error');
  if (error || failed) {
    throw new Error(`Database migration failed${failed ? ` at ${failed.migrationName}` : ''}: ${String(error)}`);
  }
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
