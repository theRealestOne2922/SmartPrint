import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testUpload() {
  console.log('Testing upload to pdfs bucket with ANON key...');
  
  // Create a dummy file
  const dummyContent = 'Hello World';
  const filePath = 'test-upload.txt';
  
  const { data, error } = await supabase.storage
    .from('pdfs')
    .upload(filePath, dummyContent, {
      contentType: 'text/plain',
      upsert: true
    });
    
  if (error) {
    console.log('❌ Upload failed:', error.message);
  } else {
    console.log('✅ Upload succeeded!', data);
    
    // Test getting public URL
    const { data: publicData } = supabase.storage.from('pdfs').getPublicUrl(filePath);
    console.log('Public URL:', publicData.publicUrl);
  }
}

testUpload().catch(console.error);
