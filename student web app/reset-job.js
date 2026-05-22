import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  await client.connect();
  // Reset the stuck job so the user can test immediately
  const res = await client.query("UPDATE print_jobs SET status='payment_confirmed' WHERE job_id='188308'");
  console.log('Reset job 188308 to payment_confirmed:', res.rowCount, 'rows updated');
  await client.end();
}

run();
