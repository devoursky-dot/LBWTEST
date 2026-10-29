const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pfaxpqkmnrpocuamtnot.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qbInPtEifr7EmUgn8NjhRw_F1jBdsNm';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('--- 1. class_notes 최신 10건 조회 ---');
  const { data: notes, error } = await supabase
    .from('class_notes')
    .select('id, lesson_id, student_grade, student_class, student_num, student_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error querying class_notes:', error);
  } else {
    console.log(JSON.stringify(notes, null, 2));
  }

  // 2. 실시간 채널 신호 모니터링
  console.log('\n--- 2. Supabase 실시간 브로드캐스트 채널 모니터링 (15초간 핑 수신 대기) ---');
  const channel = supabase.channel('room_all_debug');

  channel.on('broadcast', { event: 'signal' }, (payload) => {
    console.log('[BROADCAST SIGNAL RECEIVED]:', JSON.stringify(payload, null, 2));
  });

  channel.subscribe((status) => {
    console.log('Channel subscription status:', status);
  });

  setTimeout(() => {
    console.log('15초 모니터링 종료');
    process.exit(0);
  }, 15000);
}

run();
