import pg from 'pg';

const client = new pg.Client({ connectionString: 'postgresql://postgres.mqqluwvemcuokqcchnii:bdHhJCfMXL05ekTT@aws-0-ap-south-1.pooler.supabase.com:6543/postgres' });
async function run() {
  await client.connect();
  console.log('Connected to smartprintvit DB.');
  
  try {
    await client.query('ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_job_id_key;');
    console.log('Dropped print_jobs_job_id_key constraint.');
  } catch (e) {
    console.log('Error dropping print_jobs_job_id_key:', e.message);
  }
  
  try {
    await client.query('ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_job_id_unique;');
    console.log('Dropped print_jobs_job_id_unique constraint.');
  } catch (e) {
    console.log('Error dropping print_jobs_job_id_unique:', e.message);
  }
  
  try {
    const res = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'print_jobs'::regclass AND contype = 'u';
    `);
    console.log('Remaining unique constraints on print_jobs:', res.rows.map(r => r.conname));
  } catch (e) {
    console.log('Error listing constraints', e.message);
  }

  await client.end();
}
run();
