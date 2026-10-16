import { supabase, isSupabaseConfigured, type ClassNoteRecord } from './supabase';

/**
 * 학생 필기 벡터 스트로크 및 타이핑 데이터를 고해상도 이미지(Blob)로 오프스크린 렌더링합니다.
 */
export async function renderStudentNoteToBlob(
  note: ClassNoteRecord,
  width = 1200,
  height = 900
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not supported');
  }

  // 1. 배경 채우기 (깨끗한 흰색 종이)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 2. 모눈종이 격자 그리기 (학습지 느낌)
  ctx.strokeStyle = '#f0f0f2';
  ctx.lineWidth = 1;
  const gridSize = 30;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 3. 헤더 정보 바
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, width, 60);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, 60);

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(
    `[학생 필기 누가기록] ${note.student_grade}학년 ${note.student_class}반 ${note.student_num}번 ${note.student_name}`,
    24,
    38
  );

  const dateStr = note.created_at ? new Date(note.created_at).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR');
  ctx.fillStyle = '#64748b';
  ctx.font = '14px sans-serif';
  ctx.fillText(`작성일시: ${dateStr}`, width - 260, 38);

  // 4. 필기 벡터 스트로크 그리기
  const strokes = note.strokes_data?.strokes || [];
  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;
    ctx.save();
    ctx.strokeStyle = stroke.color || '#000000';
    ctx.lineWidth = stroke.size || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = (stroke.size || 3) * 2.5;
    } else {
      ctx.globalAlpha = 1.0;
    }

    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y + 60, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y + 60);
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i - 1];
        const p2 = stroke.points[i];
        const midX = (p1.x + p2.x) / 2;
        const midY = ((p1.y + p2.y) / 2) + 60;
        ctx.quadraticCurveTo(p1.x, p1.y + 60, midX, midY);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y + 60);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. 텍스트 아이템 그리기
  const textItems = note.strokes_data?.textItems || [];
  for (const item of textItems) {
    ctx.save();
    ctx.fillStyle = item.color || '#000000';
    ctx.font = `600 ${item.fontSize || 16}px sans-serif`;
    ctx.fillText(item.text, item.x, item.y + 60);
    ctx.restore();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas to Blob failed'));
    }, 'image/png');
  });
}

/**
 * GAS 업로드 엔드포인트를 통해 구글 드라이브 폴더에 학생 필기를 업로드합니다.
 */
export async function uploadNoteToGoogleDrive(
  gasUploadUrl: string,
  targetFolderId: string,
  fileName: string,
  blob: Blob
): Promise<{ success: boolean; fileId?: string; error?: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const base64Content = dataUrl.split(',')[1];
        const payload = {
          action: 'upload',
          folderId: targetFolderId,
          fileName: fileName,
          mimeType: 'image/png',
          fileData: base64Content
        };

        const response = await fetch(gasUploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.success || result.status === 'success') {
          resolve({ success: true, fileId: result.fileId || result.id });
        } else {
          resolve({ success: false, error: result.error || 'Upload failed' });
        }
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    };
    reader.onerror = () => resolve({ success: false, error: 'File reading failed' });
    reader.readAsDataURL(blob);
  });
}

/**
 * 이전 수업 또는 특정 날짜 이전의 Supabase 필기들을 구글 드라이브로 아카이빙하고
 * Supabase에서 삭제(purge)하여 무료 데이터베이스 용량을 절약합니다.
 * 구글 드라이브 동시성(최대 30회)을 보호하기 위해 300ms 간격으로 순차 전송 큐를 실행합니다.
 */
export async function archiveOldNotesToGoogleDrive(params: {
  gasUploadUrl: string;
  targetFolderId: string;
  lessonId: string;
  onProgress?: (current: number, total: number, studentName: string) => void;
}): Promise<{ archivedCount: number; errors: string[] }> {
  const { gasUploadUrl, targetFolderId, lessonId, onProgress } = params;

  if (!isSupabaseConfigured || !supabase) {
    return { archivedCount: 0, errors: ['Supabase가 설정되지 않았습니다.'] };
  }

  // 1. 해당 수업의 미아카이브 필기 목록 조회
  const { data: notes, error } = await supabase
    .from('class_notes')
    .select('*')
    .eq('lesson_id', lessonId)
    .order('created_at', { ascending: true });

  if (error || !notes || notes.length === 0) {
    return { archivedCount: 0, errors: error ? [error.message] : [] };
  }

  let archivedCount = 0;
  const errors: string[] = [];

  // 2. 순차 아카이빙 큐 실행 (300ms 인터벌)
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i] as ClassNoteRecord;
    const studentLabel = `${note.student_grade}학년_${note.student_class}반_${note.student_num}번_${note.student_name}`;
    const dateFormatted = (note.created_at || new Date().toISOString()).slice(0, 10);
    const fileName = `[필기누가기록]_${studentLabel}_${dateFormatted}.png`;

    if (onProgress) {
      onProgress(i + 1, notes.length, note.student_name);
    }

    try {
      // 캔버스 이미지 생성
      const blob = await renderStudentNoteToBlob(note);

      // 구글 드라이브 순차 업로드
      const uploadRes = await uploadNoteToGoogleDrive(gasUploadUrl, targetFolderId, fileName, blob);

      if (uploadRes.success) {
        // 성공 시 Supabase에서 삭제(purge)하여 무료 플랜 용량 최적화
        if (note.id) {
          await supabase.from('class_notes').delete().eq('id', note.id);
        }
        archivedCount++;
      } else {
        errors.push(`${studentLabel}: ${uploadRes.error}`);
      }
    } catch (err: any) {
      errors.push(`${studentLabel}: ${err.message}`);
    }

    // Google Apps Script 동시 실행 쿼터 보호 (300ms 딜레이)
    if (i < notes.length - 1) {
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  return { archivedCount, errors };
}
