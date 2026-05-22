import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to new Supabase database via PostgreSQL.');

        console.log('1. Setting up Realtime publication for print_jobs...');
        try {
            await client.query(`
        begin;
        drop publication if exists supabase_realtime;
        create publication supabase_realtime;
        commit;
        alter publication supabase_realtime add table print_jobs;
        `);
            console.log('✅ Realtime configured successfully.');
        } catch (e) {
            console.error('❌ Failed to setup realtime:', e.message);
        }

        console.log('2. Creating storage bucket print_jobs...');
        try {
            await client.query(`
        INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit) 
        VALUES ('print_jobs', 'print_jobs', false, ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[], 52428800) 
        ON CONFLICT (id) DO NOTHING;
        `);
            console.log('✅ Storage bucket created.');
        } catch (e) {
            console.error('❌ Failed to create bucket:', e.message);
        }

        console.log('3. Setting up storage RLS policies...');
        try {
            await client.query(`
        CREATE POLICY "Allow public uploads" ON storage.objects
        FOR INSERT TO public WITH CHECK (bucket_id = 'print_jobs');

        CREATE POLICY "Allow service role full access" ON storage.objects
        FOR ALL TO service_role USING (bucket_id = 'print_jobs');

        CREATE POLICY "Allow public select" ON storage.objects
        FOR SELECT TO public USING (bucket_id = 'print_jobs');
        `);
            console.log('✅ Storage RLS policies created.');
        } catch (e) {
            console.log('  Note on policies:', e.message); // Will error if exist, which is fine
        }

        console.log('All custom Supabase configurations complete!');
    } catch (err) {
        console.error('Fatal error:', err);
    } finally {
        await client.end();
    }
}

run();
