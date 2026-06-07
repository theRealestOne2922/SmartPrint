// ─── MongoDB Migration/Seed Script ───
// Replaces the old Drizzle/PostgreSQL migrate.js.
// Creates indexes and seeds default data (admin, teacher, settings).
// Original version backed up in _supabase_backup/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI must be set in .env');
    process.exit(1);
}

async function run() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // ─── Create Collections (if they don't exist) ───
    const existingCollections = (await db.listCollections().toArray()).map(c => c.name);
    
    for (const name of ['printjobs', 'admins', 'teachers', 'systemsettings']) {
        if (!existingCollections.includes(name)) {
            await db.createCollection(name);
            console.log(`  📦 Created collection: ${name}`);
        }
    }

    // ─── Create Indexes ───
    const printJobs = db.collection('printjobs');
    await printJobs.createIndex({ jobId: 1 }, { unique: true });
    await printJobs.createIndex({ status: 1 });
    await printJobs.createIndex({ createdAt: 1 });
    console.log('  📇 Created indexes on printjobs (jobId, status, createdAt)');

    const admins = db.collection('admins');
    await admins.createIndex({ username: 1 }, { unique: true });
    console.log('  📇 Created index on admins (username)');

    const teachers = db.collection('teachers');
    await teachers.createIndex({ empId: 1 }, { unique: true });
    console.log('  📇 Created index on teachers (empId)');

    const settings = db.collection('systemsettings');
    await settings.createIndex({ key: 1 }, { unique: true });
    console.log('  📇 Created index on systemsettings (key)');

    // ─── Seed Default Data ───
    
    // Admin
    const adminResult = await admins.updateOne(
        { username: 'vit admin' },
        { $setOnInsert: { username: 'vit admin', passwordHash: 'admin123', createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
    );
    if (adminResult.upsertedCount) {
        console.log('  👤 Seeded admin: vit admin / admin123');
    } else {
        console.log('  👤 Admin already exists — skipped');
    }

    // Teacher
    const teacherResult = await teachers.updateOne(
        { empId: '1001' },
        { $setOnInsert: { empId: '1001', name: 'Teacher Name', email: 'realme11421@gmail.com', department: 'CS', createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
    );
    if (teacherResult.upsertedCount) {
        console.log('  🧑‍🏫 Seeded teacher: 1001 / Teacher Name');
    } else {
        console.log('  🧑‍🏫 Teacher already exists — skipped');
    }

    // Settings
    for (const { key, value } of [
        { key: 'jobExpirationHours', value: '24' },
        { key: 'maxFilesLimit', value: '5' },
    ]) {
        const settingResult = await settings.updateOne(
            { key },
            { $setOnInsert: { key, value, createdAt: new Date(), updatedAt: new Date() } },
            { upsert: true }
        );
        if (settingResult.upsertedCount) {
            console.log(`  ⚙️  Seeded setting: ${key} = ${value}`);
        } else {
            console.log(`  ⚙️  Setting ${key} already exists — skipped`);
        }
    }

    console.log('\n✅ Migration complete!');
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
