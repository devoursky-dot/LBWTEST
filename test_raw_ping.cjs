const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pfaxpqkmnrpocuamtnot.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qbInPtEifr7EmUgn8NjhRw_F1jBdsNm';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const lessonId = '1ahFzV_rejQaenpWnLy2RUvEsIm8LHPjZ';
const channelName = `classroom_lesson_${lessonId}`;

const channel = supabase.channel(channelName, {
  config: { broadcast: { self: true } }
});

channel.on('broadcast', { event: 'classroom_signal' }, ({ payload }) => {
  console.log('[RAW PAYLOAD]:', JSON.stringify(payload, null, 2));
});

channel.subscribe((status) => {
  console.log('Subscribed:', status);
});

setTimeout(() => {
  process.exit(0);
}, 15000);
