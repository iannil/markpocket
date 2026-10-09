import { cleanupImports } from '../src/server/imports/airtable/importer';

async function main() {
  try {
    const count = await cleanupImports();
    console.log(`Recovered ${count} Airtable import journals.`);
  } catch {
    console.error(
      'Import recovery failed. Journals were retained where recovery could not be confirmed. Check database access, journal permissions and local storage, then retry.',
    );
    process.exitCode = 1;
  } finally {
    const { sql } = await import('../src/server/db');
    await sql.end();
  }
}
void main();
