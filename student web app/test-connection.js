import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log('✅ DB CONNECTED!');
  const res = await client.query('SELECT count(*) FROM print_jobs');
  console.log('✅ print_jobs table exists, row count:', res.rows[0].count);
  await client.end();
} catch (err) {
  console.error('❌ Connection failed:', err.message);
}
