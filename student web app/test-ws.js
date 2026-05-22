import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

console.log('Testing WebSocket connection to:', process.env.SUPABASE_URL);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('Knocking on Realtime door...');

const channel = supabase
    .channel('test_channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'print_jobs' }, (payload) => {
        console.log('Received payload:', payload);
    })
    .subscribe((status, err) => {
        console.log('WebSocket Status ->', status);
        if (err) console.error('WebSocket Error ->', err);

        if (status === 'SUBSCRIBED') {
            console.log('✅ Connection successful!');
            process.exit(0);
        }
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            console.log('❌ Connection failed.');
            process.exit(1);
        }
    });

// Timeout after 10 seconds
setTimeout(() => {
    console.log('❌ Timeout: WebSocket connection hung indefinitely.');
    process.exit(1);
}, 10000);
