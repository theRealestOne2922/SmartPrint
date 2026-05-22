import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:bdHhJCfMXL05ekTT@db.mqqluwvemcuokqcchnii.supabase.co:5432/postgres'
});
client.connect()
  .then(() => { console.log('Connected!'); client.end(); })
  .catch(err => { console.error('Connection error:', err.message); client.end(); });
