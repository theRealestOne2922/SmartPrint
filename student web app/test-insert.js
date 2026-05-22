import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testInsert() {
  console.log('Testing insert with ANON key (this is what the web app uses)...');
  
  const { data, error } = await supabase
    .from('print_jobs')
    .insert({
      job_id: '123456',
      file_name: 'test.pdf',
      file_path: 'https://example.com/test.pdf',
      page_count: 1,
      color_mode: 'bw',
      copies: 1,
      price: 2
    })
    .select();
    
  if (error) {
    console.log('❌ Insert failed:', error.message);
  } else {
    console.log('✅ Insert succeeded!', data);
  }
}

testInsert().catch(console.error);
