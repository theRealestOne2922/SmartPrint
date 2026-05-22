import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: 'D:/SmartPrint_final/student web app/.env' });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  console.log('Connected to old DB.');
  try {
    await client.query('ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_job_id_unique;');
    console.log('Constraint print_jobs_job_id_unique dropped successfully.');
  } catch (e) {
    console.log('Error dropping constraint:', e.message);
  }
  
  try {
    const res = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'print_jobs'::regclass AND contype = 'u';
    `);
    console.log('Remaining unique constraints on print_jobs:', res.rows.map(r => r.conname));
  } catch (e) {}

  await client.end();
}
run();
