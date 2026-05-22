import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres:bdHhJCfMXL05ekTT@db.mqqluwvemcuokqcchnii.supabase.co:5432/postgres'
});

async function run() {
  await client.connect();
  
  console.log('Adding teacherEmpId to print_jobs...');
  await client.query(`ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "teacher_emp_id" text;`);
  
  console.log('Creating teachers table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "teachers" (
      "id" serial PRIMARY KEY,
      "emp_id" varchar(20) NOT NULL UNIQUE,
      "name" text NOT NULL,
      "email" text NOT NULL,
      "department" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  console.log('Creating admins table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "admins" (
      "id" serial PRIMARY KEY,
      "username" varchar(50) NOT NULL UNIQUE,
      "password_hash" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  console.log('Creating system_settings table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "system_settings" (
      "id" serial PRIMARY KEY,
      "key" varchar(50) NOT NULL UNIQUE,
      "value" text NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  console.log('Done migrating schema!');
  
  console.log('Seeding data...');
  // Insert admin (password: admin123)
  await client.query(`
    INSERT INTO "admins" ("username", "password_hash")
    VALUES ('vit admin', 'admin123')
    ON CONFLICT ("username") DO NOTHING;
  `);

  // Insert mock teacher
  await client.query(`
    INSERT INTO "teachers" ("emp_id", "name", "email", "department")
    VALUES ('1001', 'Teacher Name', 'realme11421@gmail.com', 'CS')
    ON CONFLICT ("emp_id") DO UPDATE SET email = 'realme11421@gmail.com';
  `);

  // Insert default settings
  await client.query(`
    INSERT INTO "system_settings" ("key", "value")
    VALUES 
      ('jobExpirationHours', '24'),
      ('maxFilesLimit', '5')
    ON CONFLICT ("key") DO NOTHING;
  `);

  console.log('Seeding done.');
  await client.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
