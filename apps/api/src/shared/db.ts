// Shared Neon pool. null when NEON_DATABASE_URL is unset; callers fall back to data/seed/.
import pg from 'pg';

const url = process.env.NEON_DATABASE_URL?.replace(/^"|"$/g, '');

export const db = url ? new pg.Pool({ connectionString: url, max: 5 }) : null;
db?.on('error', (err) => console.error('[db] idle client error', err.message)); // a dropped idle connection must not crash the server
