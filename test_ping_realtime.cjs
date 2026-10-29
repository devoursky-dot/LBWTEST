const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pfaxpqkmnrpocuamtnot.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qbInPtEifr7EmUgn8NjhRw_F1jBdsNm';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const lessonId = '1ahFzV_rejQaenpWnLy2RUvEsIm8LHPjZ';
const channelName = `classroom_lesson_${lessonId}`;

console.log(`[핑 모니터] 채널 '${channelName}' 구독 시작...`);

const channel = supabase.channel(channelName, {
  config: { broadcast: { self: true } }
});

channel.on('broadcast', { event: 'classroom_signal' }, ({ payload }) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n[${time} 신호 수신] Type: ${payload?.type}`);
  if (payload?.student) {
    console.log(`  - 학생: ${payload.student.grade}-${payload.student.classNum} ${payload.student.studentNum}번 ${payload.student.name}`);
    console.log(`  - isAway: ${payload.student.isAway}`);
  }
  if (payload?.targetStudentKey) {
    console.log(`  - 대상: ${payload.targetStudentKey}`);
  }
});

channel.subscribe((status) => {
  console.log('[핑 모니터] 상태:', status);
});

// 25초 동안 대기
setTimeout(() => {
  console.log('\n[핑 모니터] 25초 모니터링 종료');
  process.exit(0);
}, 25000);
