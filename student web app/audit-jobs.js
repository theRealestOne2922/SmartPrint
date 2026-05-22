import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT id, job_id, status, created_at FROM print_jobs WHERE created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at DESC;");
  console.log('JOBS FROM LAST HOUR:');
  console.table(res.rows);
  await client.end();
}

run();
