import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:bdHhJCfMXL05ekTT@db.mqqluwvemcuokqcchnii.supabase.co:5432/postgres'
});

async function run() {
  await client.connect();
  
  // Update admin username from "vit admin" to "vitadmin"
  const result = await client.query(
    `UPDATE "admins" SET "username" = 'vitadmin' WHERE "username" = 'vit admin'`
  );
  console.log('Updated rows:', result.rowCount);
  
  // Verify
  const { rows } = await client.query(`SELECT * FROM "admins"`);
  console.log('Admins:', rows);
  
  await client.end();
}

run().catch(err => { console.error(err); process.exit(1); });
