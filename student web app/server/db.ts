// MongoDB connection — replaces the old Drizzle/pg Pool setup.
// Original Drizzle/pg code backed up in _supabase_backup/
import { connectMongoDB } from './mongodb';

export { connectMongoDB };
