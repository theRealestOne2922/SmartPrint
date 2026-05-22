import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });

async function run() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is missing in .env');
        process.exit(1);
    }

    // Create postgres connection
    const sql = postgres(process.env.DATABASE_URL);

    try {
        console.log('Adding duplex column to print_jobs...');
        await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS duplex BOOLEAN DEFAULT false;`;

        console.log('Adding page_range column to print_jobs...');
        await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS page_range TEXT DEFAULT 'all';`;

        console.log('Successfully added advanced print option columns!');
    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        await sql.end();
    }
}

run();
