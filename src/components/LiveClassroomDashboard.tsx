import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from '../lib/supabase';
import { classroomRealtime, type StudentPresenceInfo, type RealtimeSignalPayload } from '../lib/classroomRealtime';
import { generateClassSubmissionPdf } from '../lib/pdfGenerator';

export interface LiveClassroomDashboardProps {
  lesson: {
    id: string;
    folderId?: string;
    name: string;
    teacherPin?: string;
  };
  onExit: () => void;
  onOpenFolder?: (folderId: string, folderName: string) => void;
  executeDriveAction: (payload: any) => Promise<any>;
  showToast: (msg: string) => void;
}

export const LiveClassroomDashboard: React.FC<LiveClassroomDashboardProps> = ({
  lesson,
  onExit,
  onOpenFolder,
  executeDriveAction,
  showToast
}) => {
  const currentLessonId = lesson.folderId || lesson.id;
  const cleanLessonTitle = lesson.name.replace('[QR수업]', '').trim();

  // QR 코드 상태
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [studentUrl, setStudentUrl] = useState<string>('');

  // 실시간 학생 접속 및 제출 목록 상태
  const [studentPresences, setStudentPresences] = useState<Map<string, StudentPresenceInfo>>(new Map());
  const [studentSubmissions, setStudentSubmissions] = useState<ClassNoteRecord[]>([]);
  const [selectedStudentNote, setSelectedStudentNote] = useState<ClassNoteRecord | null>(null);
  const [selectedStudentPageIdx, setSelectedStudentPageIdx] = useState<number>(0);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [viewerPaperTheme, setViewerPaperTheme] = useState<'white' | 'dark'>('white');
  const selectedStudentKeyRef = useRef<string | null>(null);

  // PDF 일괄 컴파일 상태
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  // 사이드바 접힘 상태
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  // 1. 학생 참여 QR 코드 생성
  useEffect(() => {
    const baseOrigin = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? window.location.origin
      : 'https://lbwtest.vercel.app';
    const generatedUrl = `${baseOrigin}/?lessonId=${currentLessonId}&title=${encodeURIComponent(cleanLessonTitle)}`;
    setStudentUrl(generatedUrl);

    QRCode.toDataURL(generatedUrl, {
      width: 400,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' }
    }).then(setQrCodeDataUrl).catch((err) => {
      console.error('QR 생성 실패:', err);
    });
  }, [currentLessonId, cleanLessonTitle]);

  // 2. 초기 DB 제출 목록 조회 (strokes_data 포함하여 온디맨드 즉시 렌더링 지원)
  const fetchSubmissionsFromDb = async () => {
    if (!supabase || !isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from('class_notes')
        .select('*')
        .eq('lesson_id', currentLessonId)
        .order('updated_at', { ascending: false });

      if (!error && data) {
        setStudentSubmissions(data as ClassNoteRecord[]);
      }
    } catch (e) {
      console.warn('초기 제출 목록 로드 오류:', e);
    }
  };

  useEffect(() => {
    fetchSubmissionsFromDb();
  }, [currentLessonId]);

  // 3. 실시간 신호 채널 구독 (학생 접속, 이탈, 제출, 응답)
  useEffect(() => {
    classroomRealtime.joinLesson(currentLessonId);

    const unsubscribe = classroomRealtime.subscribe((signal: RealtimeSignalPayload) => {
      if (signal.lessonId !== currentLessonId) return;

      // [1] 학생 접속 / 이탈 상태 알림
      if (signal.type === 'STUDENT_PRESENCE' && signal.student) {
        const key = `${signal.student.grade}_${signal.student.classNum}_${signal.student.studentNum}`;
        const newStatus = signal.status || 'connected';

        setStudentPresences((prev) => {
          const next = new Map(prev);
          next.set(key, {
            ...signal.student!,
            status: newStatus,
            lastActive: signal.timestamp
          });
          return next;
        });

        if (newStatus === 'connected') {
          showToast(`🟢 ${signal.student.grade}-${signal.student.classNum} ${signal.student.name} 학생이 출석했습니다.`);
        } else if (newStatus === 'away') {
          showToast(`🚨 ${signal.student.grade}-${signal.student.classNum} ${signal.student.name} 학생이 다른 앱으로 이탈했습니다!`);
        }
      }

      // [2] 학생 필기 등록 / 제출
      if (signal.type === 'STUDENT_SUBMIT' && signal.noteRecord) {
        const record = signal.noteRecord;
        const recKey = `${record.student_grade}_${record.student_class}_${record.student_num}`;
        setStudentSubmissions((prev) => {
          const filtered = prev.filter(p => !(
            p.student_grade === record.student_grade &&
            p.student_class === record.student_class &&
            p.student_num === record.student_num
          ));
          return [record, ...filtered];
        });
        if (selectedStudentKeyRef.current === recKey) {
          setSelectedStudentNote(record);
          setIsLoadingDetail(false);
        }
        showToast(`📝 ${record.student_grade}-${record.student_class} ${record.student_name} 학생이 필기를 제출했습니다!`);
      }

      // [3] 온디맨드 필기 응답 수신 (stale closure 방지: selectedStudentKeyRef 활용)
      if (signal.type === 'RESPONSE_STUDENT_NOTE' && signal.noteRecord) {
        const record = signal.noteRecord;
        const recKey = `${record.student_grade}_${record.student_class}_${record.student_num}`;
        if (selectedStudentKeyRef.current === recKey) {
          setSelectedStudentNote(record);
          if (record.strokes_data?.paperTheme) {
            setViewerPaperTheme(record.strokes_data.paperTheme);
          }
          setIsLoadingDetail(false);
          showToast(`⚡ ${record.student_name} 학생의 최신 필기가 동기화되었습니다.`);
        }
        setStudentSubmissions((prev) => {
          const filtered = prev.filter(p => !(
            p.student_grade === record.student_grade &&
            p.student_class === record.student_class &&
            p.student_num === record.student_num
          ));
          return [record, ...filtered];
        });
      }
    });

    return () => {
      unsubscribe();
      classroomRealtime.leaveLesson();
    };
  }, [currentLessonId]);

  // 4. 통합 학생 목록 생성 (접속 정보 + 제출 정보 병합 후 [학번순] 정렬)
  const sortedStudentRoster = useMemo(() => {
    const studentMap = new Map<string, {
      key: string;
      grade: string;
      classNum: string;
      studentNum: string;
      name: string;
      status: 'connected' | 'away' | 'offline';
      submission?: ClassNoteRecord;
    }>();

    // 1) 제출 기록이 있는 학생 추가
    for (const sub of studentSubmissions) {
      const key = `${sub.student_grade}_${sub.student_class}_${sub.student_num}`;
      studentMap.set(key, {
        key,
        grade: sub.student_grade,
        classNum: sub.student_class,
        studentNum: sub.student_num,
        name: sub.student_name,
        status: 'offline',
        submission: sub
      });
    }

    // 2) 실시간 접속자 상태 병합
    for (const [key, presence] of studentPresences.entries()) {
      if (presence.status === 'left') {
        const existing = studentMap.get(key);
        if (existing) existing.status = 'offline';
        continue;
      }

      const existing = studentMap.get(key);
      if (existing) {
        existing.status = presence.status;
        existing.name = presence.name;
      } else {
        studentMap.set(key, {
          key,
          grade: presence.grade,
          classNum: presence.classNum,
          studentNum: presence.studentNum,
          name: presence.name,
          status: presence.status
        });
      }
    }

    // 3) 학번순 엄격 자연 정렬 (학년 -> 반 -> 번호 오름차순)
    const list = Array.from(studentMap.values());
    list.sort((a, b) => {
      const gradeA = parseInt(a.grade || '0', 10);
      const gradeB = parseInt(b.grade || '0', 10);
      if (gradeA !== gradeB) return gradeA - gradeB;

      const classA = parseInt(a.classNum || '0', 10);
      const classB = parseInt(b.classNum || '0', 10);
      if (classA !== classB) return classA - classB;

      const numA = parseInt(a.studentNum || '0', 10);
      const numB = parseInt(b.studentNum || '0', 10);
      if (numA !== numB) return numA - numB;

      return a.name.localeCompare(b.name, 'ko-KR');
    });

    return list;
  }, [studentSubmissions, studentPresences]);

  // 실시간 출석 카운트
  const activeCount = sortedStudentRoster.filter(s => s.status === 'connected').length;
  const awayCount = sortedStudentRoster.filter(s => s.status === 'away').length;

  // 5. 학생 타일 클릭 시 온디맨드 필기 상세 열람
  const handleSelectStudent = async (studentItem: typeof sortedStudentRoster[0]) => {
    setIsLoadingDetail(true);
    setSelectedStudentPageIdx(0);
    selectedStudentKeyRef.current = studentItem.key;

    // A. 학생 공책 테마 동기화 (기본: 학생이 선택한 테마, 미지정 시 white)
    const initialTheme = studentItem.submission?.strokes_data?.paperTheme || 'white';
    setViewerPaperTheme(initialTheme);

    // B. 만약 이미 메모리에 strokes_data가 있는 경우 즉시 표시 및 첫 비어있지 않은 쪽으로 포커스
    if (studentItem.submission?.strokes_data?.pages || studentItem.submission?.strokes_data?.strokes) {
      setSelectedStudentNote(studentItem.submission);
      const pages = (Array.isArray(studentItem.submission.strokes_data.pages) && studentItem.submission.strokes_data.pages.length > 0)
        ? studentItem.submission.strokes_data.pages
        : [{ strokes: studentItem.submission.strokes_data.strokes || [], textItems: studentItem.submission.strokes_data.textItems || [] }];
      const firstNonEmpty = pages.findIndex((p: any) => (p.strokes?.length || 0) > 0 || (p.textItems?.length || 0) > 0 || p.fullPageBackground);
      setSelectedStudentPageIdx(firstNonEmpty >= 0 ? firstNonEmpty : 0);
      setIsLoadingDetail(false);
    } else {
      // 임시 placeholder 설정
      setSelectedStudentNote({
        lesson_id: currentLessonId,
        student_grade: studentItem.grade,
        student_class: studentItem.classNum,
        student_num: studentItem.studentNum,
        student_name: studentItem.name,
        strokes_data: { pages: [] }
      });
    }

    // C. 학생이 실시간 연결(online) 상태인 경우 원격 온디맨드 동기화 요청 신호 전송
    if (studentItem.status === 'connected') {
      await classroomRealtime.sendSignal({
        type: 'REQUEST_STUDENT_NOTE',
        lessonId: currentLessonId,
        targetStudentKey: studentItem.key
      });
    }

    // D. Supabase DB에서 최신 데이터 조회 (학번 기준 단건 조회)
    if (supabase && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('class_notes')
          .select('*')
          .eq('lesson_id', currentLessonId)
          .eq('student_grade', studentItem.grade)
          .eq('student_class', studentItem.classNum)
          .eq('student_num', studentItem.studentNum)
          .order('updated_at', { ascending: false })
          .maybeSingle();

        if (!error && data) {
          setSelectedStudentNote(data);
          if (data.strokes_data?.paperTheme) {
            setViewerPaperTheme(data.strokes_data.paperTheme);
          }
          const pages = (Array.isArray(data.strokes_data?.pages) && data.strokes_data.pages.length > 0)
            ? data.strokes_data.pages
            : [{ strokes: data.strokes_data?.strokes || [], textItems: data.strokes_data?.textItems || [] }];
          const firstNonEmpty = pages.findIndex((p: any) => (p.strokes?.length || 0) > 0 || (p.textItems?.length || 0) > 0 || p.fullPageBackground);
          setSelectedStudentPageIdx(firstNonEmpty >= 0 ? firstNonEmpty : 0);

          setStudentSubmissions((prev) => {
            const filtered = prev.filter(p => !(
              p.student_grade === data.student_grade &&
              p.student_class === data.student_class &&
              p.student_num === data.student_num
            ));
            return [data, ...filtered];
          });
        }
      } catch (err) {
        console.warn('학생 상세 필기 조회 오류:', err);
      } finally {
        setIsLoadingDetail(false);
      }
    } else {
      setTimeout(() => setIsLoadingDetail(false), 300);
    }
  };

  // 6. 전체 학생 필기 모음집 학번순 PDF 생성 및 구글 드라이브 업로드
  const handleCompileAndSavePdf = async () => {
    if (sortedStudentRoster.length === 0) {
      showToast('⚠️ 모음집으로 저장할 학생이 없습니다.');
      return;
    }

    setIsGeneratingPdf(true);
    setPdfProgress({ current: 0, total: sortedStudentRoster.length, name: '학생 전체 동기화 신호 전송 중...' });

    try {
      // 1) 전체 학생 태블릿에 최신 필기 일괄 동기화 신호 브로드캐스트 (병렬 1.5초)
      await classroomRealtime.sendSignal({
        type: 'REQUEST_ALL_SYNC',
        lessonId: currentLessonId
      });

      // 학생 장치들이 백그라운드 압축 및 저장을 마칠 수 있도록 1.5초 대기
      await new Promise(res => setTimeout(res, 1500));

      // 2) 최신 필기 데이터 일괄 보충 조회
      let notesToCompile: ClassNoteRecord[] = [];
      if (supabase && isSupabaseConfigured) {
        const { data: fullNotes } = await supabase
          .from('class_notes')
          .select('*')
          .eq('lesson_id', currentLessonId);

        if (fullNotes && fullNotes.length > 0) {
          notesToCompile = fullNotes;
        }
      }

      if (notesToCompile.length === 0) {
        // DB 조회가 비어있으면 현재 로컬 캐시 사용
        notesToCompile = sortedStudentRoster
          .map(s => s.submission)
          .filter(Boolean) as ClassNoteRecord[];
      }

      if (notesToCompile.length === 0) {
        showToast('⚠️ 제출된 필기 데이터가 없습니다.');
        setIsGeneratingPdf(false);
        setPdfProgress(null);
        return;
      }

      // 3) 학번순 고화질 통합 PDF 생성
      const result = await generateClassSubmissionPdf({
        lessonTitle: cleanLessonTitle,
        notes: notesToCompile,
        onProgress: (current, total, name) => {
          setPdfProgress({ current, total, name });
        }
      });

      // 4) 내 컴퓨터 즉시 다운로드 백업
      const url = URL.createObjectURL(result.pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);

      // 5) 구글 드라이브 해당 수업 폴더로 1회 업로드
      showToast(`☁️ 구글 드라이브에 '${result.fileName}' 업로드 중...`);
      await executeDriveAction({
        action: 'upload',
        folderId: currentLessonId,
        name: result.fileName,
        mimeType: 'application/pdf',
        base64: result.pdfBase64
      });

      showToast(`🎉 '${result.fileName}' (${result.totalStudents}명) 학번순 PDF가 드라이브에 저장되었습니다!`);
    } catch (err: any) {
      console.error('PDF 생성 및 업로드 실패:', err);
      showToast(`❌ PDF 생성 실패: ${err.message || '오류 발생'}`);
    } finally {
      setIsGeneratingPdf(false);
      setPdfProgress(null);
    }
  };

  return (
    <div
      id="live-classroom-dashboard"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0d1117',
        color: '#f0f6fc',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif',
        userSelect: 'none'
      }}
    >
      {/* 1. 상단 글로벌 네비게이션 헤더 */}
      <header
        style={{
          height: '64px',
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)'
            }}
          >
            🏫
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                {cleanLessonTitle}
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(37, 99, 235, 0.2)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.4)'
                }}
              >
                대화형 라이브 수업 세션
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '2px' }}>
              전자칠판 실시간 관제 및 학생 필기 모니터링
            </div>
          </div>
        </div>

        {/* 출석 카운터 뱃지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#21262d',
              padding: '6px 14px',
              borderRadius: '20px',
              border: '1px solid #30363d',
              fontSize: '12.5px'
            }}
          >
            <span style={{ color: '#3fb950', fontWeight: 700 }}>● 참여 중: {activeCount}명</span>
            {awayCount > 0 && (
              <span style={{ color: '#f85149', fontWeight: 700, marginLeft: '6px' }}>
                🚨 이탈: {awayCount}명
              </span>
            )}
            <span style={{ color: '#8b949e', marginLeft: '6px' }}>
              / 총 {sortedStudentRoster.length}명
            </span>
          </div>

          {/* 학번순 PDF 저장 버튼 */}
          <button
            type="button"
            className="g-btn g-btn-primary"
            style={{
              fontSize: '13px',
              fontWeight: 700,
              padding: '8px 18px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              border: '1px solid #3b82f6',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
            }}
            disabled={isGeneratingPdf}
            onClick={handleCompileAndSavePdf}
            title="현재까지 참여한 모든 학생의 필기를 학번순으로 자동 정렬하여 단일 A4 PDF 파일로 만들어 구글드라이브에 저장합니다."
          >
            {isGeneratingPdf ? '⏳ PDF 모음집 생성 중...' : '📑 학생 필기 모음집 PDF로 저장'}
          </button>

          {onOpenFolder && (
            <button
              type="button"
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#c9d1d9',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              onClick={() => onOpenFolder(currentLessonId, lesson.name)}
              title="구글 드라이브 해당 수업 폴더를 엽니다."
            >
              📁 드라이브 폴더
            </button>
          )}

          {/* 수업 나가기 버튼 */}
          <button
            type="button"
            style={{
              background: 'transparent',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onClick={onExit}
            title="라이브 수업 화면을 종료하고 스마트 드라이브 포털로 돌아갑니다."
          >
            <span>✕ 수업 나가기</span>
          </button>
        </div>
      </header>

      {/* 2. PDF 생성 진행 바 */}
      {isGeneratingPdf && pdfProgress && (
        <div
          style={{
            background: 'rgba(37, 99, 235, 0.15)',
            borderBottom: '1px solid #3b82f6',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            color: '#93c5fd'
          }}
        >
          <span>🔄 <strong>{pdfProgress.name}</strong> 학생 필기 고해상도 합성 및 PDF 병합 중...</span>
          <span style={{ fontWeight: 700 }}>{pdfProgress.current} / {pdfProgress.total}</span>
        </div>
      )}

      {/* 3. 대시보드 본문 (좌측: QR패널 / 우측: 전체 학생 타일 그리드) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 좌측 패널 (대형 QR코드 및 접속 안내) */}
        {!sidebarCollapsed && (
          <aside
            style={{
              width: '320px',
              background: '#161b22',
              borderRight: '1px solid #30363d',
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flexShrink: 0,
              overflowY: 'auto'
            }}
          >
            <h2 style={{ fontSize: '15px', color: '#58a6ff', marginBottom: '14px', fontWeight: 700, textAlign: 'center' }}>
              📷 학생 참여 초대형 QR코드
            </h2>

            {qrCodeDataUrl ? (
              <div
                style={{
                  background: '#ffffff',
                  padding: '14px',
                  borderRadius: '16px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                }}
              >
                <img
                  src={qrCodeDataUrl}
                  alt="Student QR Code"
                  style={{ width: '230px', height: '230px', display: 'block' }}
                />
              </div>
            ) : (
              <div style={{ width: '230px', height: '230px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
                QR코드 생성 중...
              </div>
            )}

            <p style={{ fontSize: '13px', color: '#8b949e', textAlign: 'center', marginTop: '16px', lineHeight: 1.6 }}>
              태블릿 카메라로 QR을 스캔한 뒤<br />
              <strong>[📡 전자칠판 연결]</strong>을 누르면<br />
              우측에 실시간 출석으로 표시됩니다.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', width: '100%' }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  navigator.clipboard.writeText(studentUrl);
                  showToast('✅ 학생 접속 URL이 복사되었습니다.');
                }}
              >
                🔗 주소 복사
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: '#1f6feb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                onClick={() => window.open(studentUrl, '_blank')}
              >
                🚀 학생 창 열기
              </button>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '20px', width: '100%', borderTop: '1px solid #30363d', textAlign: 'center' }}>
              <button
                type="button"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8b949e',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
                onClick={() => setSidebarCollapsed(true)}
              >
                ◀ QR 패널 접기 (학생 타일 넓게 보기)
              </button>
            </div>
          </aside>
        )}

        {/* 사이드바 접혔을 때 펼치기 토글 버튼 */}
        {sidebarCollapsed && (
          <button
            type="button"
            style={{
              width: '32px',
              background: '#161b22',
              border: 'none',
              borderRight: '1px solid #30363d',
              color: '#8b949e',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              writingMode: 'vertical-rl'
            }}
            onClick={() => setSidebarCollapsed(false)}
            title="QR 패널 펼치기"
          >
            ▶ QR 패널 열기
          </button>
        )}

        {/* 우측 메인 영역: 30~40명 전체 학생 타일 그리드 */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '24px 32px',
            overflowY: 'auto'
          }}
        >
          {/* 타이틀 및 정렬 안내 바 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '18px',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                👥 전체 학생 실시간 출석 및 필기 모니터링
              </h2>
              <span style={{ fontSize: '12.5px', color: '#8b949e', marginTop: '4px', display: 'block' }}>
                학번순(1번~35번) 자동 정렬 • 타일을 클릭하면 0.3초 만에 학생의 필기 원본을 즉시 열람합니다.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#c9d1d9',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onClick={fetchSubmissionsFromDb}
              >
                <span>🔄</span> 새로고침
              </button>
            </div>
          </div>

          {/* 전체 학생 바둑판 타일 그리드 */}
          {sortedStudentRoster.length === 0 ? (
            <div
              style={{
                flex: 1,
                border: '2px dashed #30363d',
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8b949e',
                padding: '40px'
              }}
            >
              <span style={{ fontSize: '48px', marginBottom: '14px' }}>📱</span>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', marginBottom: '8px' }}>
                아직 접속한 학생이 없습니다.
              </h3>
              <p style={{ fontSize: '14px', textAlign: 'center', lineHeight: 1.6 }}>
                좌측 QR코드를 학생들이 태블릿으로 스캔하고 <strong>[📡 전자칠판 연결]</strong>을 터치하면<br />
                이곳에 학생별 출석 카드와 필기 현황이 실시간으로 나타납니다.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '14px'
              }}
            >
              {sortedStudentRoster.map((studentItem) => {
                const isOnline = studentItem.status === 'connected';
                const isAway = studentItem.status === 'away';
                const hasNote = Boolean(studentItem.submission);

                let badgeBg = '#484f58';
                let badgeLabel = '미접속';
                let borderColor = '#30363d';
                let cardBg = '#161b22';

                if (isOnline) {
                  badgeBg = '#238636';
                  badgeLabel = '🟢 참여 중';
                  borderColor = '#388bfd';
                  cardBg = 'rgba(56, 139, 253, 0.1)';
                } else if (isAway) {
                  badgeBg = '#da3633';
                  badgeLabel = '🚨 이탈 감지';
                  borderColor = '#f85149';
                  cardBg = 'rgba(248, 81, 73, 0.12)';
                } else if (hasNote) {
                  badgeBg = '#1f6feb';
                  badgeLabel = '제출 완료';
                }

                return (
                  <div
                    key={studentItem.key}
                    onClick={() => handleSelectStudent(studentItem)}
                    style={{
                      background: cardBg,
                      border: `1.5px solid ${borderColor}`,
                      borderRadius: '12px',
                      padding: '14px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                      boxShadow: isOnline ? '0 4px 16px rgba(56, 139, 253, 0.15)' : 'none'
                    }}
                    title="클릭하여 실시간 필기 원본 확인"
                  >
                    {/* 우측 상단 상태 닷 */}
                    <span
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: isOnline ? '#3fb950' : (isAway ? '#f85149' : '#8b949e')
                      }}
                    />

                    <span style={{ fontSize: '28px', marginBottom: '6px' }}>
                      {isAway ? '🚨' : '👨‍🎓'}
                    </span>

                    {/* 학번 및 이름 */}
                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff', textAlign: 'center' }}>
                      {studentItem.grade}-{studentItem.classNum} {studentItem.studentNum}번
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3', marginTop: '2px' }}>
                      {studentItem.name}
                    </span>

                    {/* 상태 라벨 뱃지 */}
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        color: '#ffffff',
                        background: badgeBg,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        marginTop: '8px'
                      }}
                    >
                      {badgeLabel}
                    </span>

                    {hasNote && (
                      <span style={{ fontSize: '11px', color: '#58a6ff', marginTop: '4px', fontWeight: 600 }}>
                        📝 필기 있음
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* 4. 학생 필기 상세 조회 팝업 모달 (검정색 칠판 테마 #131314 및 반응형 고화질 SVG 렌더러) */}
      {selectedStudentNote && (() => {
        const studentPages = (Array.isArray(selectedStudentNote.strokes_data?.pages) && selectedStudentNote.strokes_data.pages.length > 0)
          ? selectedStudentNote.strokes_data.pages
          : [{
              strokes: selectedStudentNote.strokes_data?.strokes || [],
              textItems: selectedStudentNote.strokes_data?.textItems || [],
              fullPageBackground: selectedStudentNote.strokes_data?.fullPageBackground || null,
              images: selectedStudentNote.strokes_data?.images || []
            }];
        const validPageIdx = Math.min(Math.max(0, selectedStudentPageIdx), studentPages.length - 1);
        const currentPageData = studentPages[validPageIdx] || { strokes: [], textItems: [], images: [] };
        const orientation = selectedStudentNote.strokes_data?.orientation || 'landscape';
        const isPortrait = orientation === 'portrait';
        const docWidth = isPortrait ? 1130 : 1600;
        const docHeight = isPortrait ? 1600 : 1130;

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              background: 'rgba(0, 0, 0, 0.85)',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
            onClick={() => {
              setSelectedStudentNote(null);
              selectedStudentKeyRef.current = null;
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: isPortrait ? '680px' : '1080px',
                maxHeight: '94vh',
                background: '#161b22',
                borderRadius: '16px',
                border: '1px solid #30363d',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid #30363d',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#1a202c',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '20px' }}>👨‍🎓</span>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                    {selectedStudentNote.student_grade}학년 {selectedStudentNote.student_class}반 {selectedStudentNote.student_num}번 {selectedStudentNote.student_name} 학생의 필기
                  </h3>
                  <span
                    style={{
                      fontSize: '11px',
                      background: 'rgba(59, 130, 246, 0.2)',
                      color: '#93c5fd',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      fontWeight: 600
                    }}
                  >
                    {isPortrait ? '📱 A4 세로' : '💻 A4 가로'}
                  </span>
                  {studentPages.length > 1 && (
                    <span
                      style={{
                        fontSize: '11px',
                        background: 'rgba(168, 85, 247, 0.2)',
                        color: '#d8b4fe',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                        fontWeight: 600
                      }}
                    >
                      총 {studentPages.length}쪽
                    </span>
                  )}
                  {isLoadingDetail && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#facc15',
                        background: 'rgba(250, 204, 21, 0.15)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid rgba(250, 204, 21, 0.3)'
                      }}
                    >
                      ⚡ 최신 필기 동기화 중...
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* 종이 배경 테마 토글 버튼 (흰색 종이 vs 칠판 다크모드) */}
                  <button
                    type="button"
                    style={{
                      background: viewerPaperTheme === 'white' ? '#ffffff' : '#21262d',
                      color: viewerPaperTheme === 'white' ? '#0f172a' : '#f0f6fc',
                      border: '1px solid #30363d',
                      borderRadius: '6px',
                      padding: '3px 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                    }}
                    onClick={() => setViewerPaperTheme(prev => prev === 'white' ? 'dark' : 'white')}
                    title="공책 배경을 흰색 종이 또는 검정 칠판 모드로 전환합니다."
                  >
                    <span>{viewerPaperTheme === 'white' ? '📄 흰색 종이' : '🌙 칠판 모드'}</span>
                  </button>

                  {/* 페이지 넘김 컨트롤 */}
                  {studentPages.length > 1 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#21262d',
                        padding: '3px 10px',
                        borderRadius: '8px',
                        border: '1px solid #30363d'
                      }}
                    >
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: validPageIdx === 0 ? '#484f58' : '#ffffff',
                          cursor: validPageIdx === 0 ? 'default' : 'pointer',
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: '2px 6px'
                        }}
                        disabled={validPageIdx === 0}
                        onClick={() => setSelectedStudentPageIdx(prev => Math.max(0, prev - 1))}
                      >
                        ◀ 이전 쪽
                      </button>
                      <span style={{ fontSize: '12.5px', color: '#58a6ff', fontWeight: 700 }}>
                        {validPageIdx + 1} / {studentPages.length} 쪽
                      </span>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: validPageIdx >= studentPages.length - 1 ? '#484f58' : '#ffffff',
                          cursor: validPageIdx >= studentPages.length - 1 ? 'default' : 'pointer',
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: '2px 6px'
                        }}
                        disabled={validPageIdx >= studentPages.length - 1}
                        onClick={() => setSelectedStudentPageIdx(prev => Math.min(studentPages.length - 1, prev + 1))}
                      >
                        다음 쪽 ▶
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#8b949e',
                      fontSize: '20px',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      lineHeight: 1
                    }}
                    onClick={() => {
                      setSelectedStudentNote(null);
                      selectedStudentKeyRef.current = null;
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* 필기 종이 뷰어 본문 (완벽한 A4 비율 고정 및 배경-필기 1:1 완벽 일체화) */}
              <div
                style={{
                  flex: 1,
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'auto',
                  background: '#0a0d12'
                }}
              >
                {/* A4 용지 실제 시트 (수학적으로 왜곡 없는 A4 가로/세로 비율 보장) */}
                <div
                  style={{
                    position: 'relative',
                    width: isPortrait
                      ? 'min(100%, calc(72vh * 1130 / 1600))'
                      : 'min(100%, calc(72vh * 1600 / 1130))',
                    aspectRatio: `${docWidth} / ${docHeight}`,
                    maxHeight: '72vh',
                    background: viewerPaperTheme === 'white' ? '#ffffff' : '#131314',
                    border: viewerPaperTheme === 'white' ? '1px solid #cbd5e1' : '1px solid #30363d',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    boxShadow: viewerPaperTheme === 'white'
                      ? '0 12px 36px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06)'
                      : 'inset 0 0 24px rgba(0,0,0,0.8), 0 8px 30px rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {/* 로딩 스피너 오버레이 */}
                  {isLoadingDetail && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(19, 19, 20, 0.75)',
                        zIndex: 10
                      }}
                    >
                      <span style={{ fontSize: '32px', display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span>
                      <span style={{ marginTop: '10px', fontSize: '13px', color: '#93c5fd', fontWeight: 600 }}>
                        학생 필기 데이터를 불러오는 중...
                      </span>
                    </div>
                  )}

                  {/* 💥 통합 고화질 SVG 렌더러 (배경 이미지와 스트로크가 동일한 1600x1130 좌표계에 1:1 완벽 일체화) */}
                  <svg
                    viewBox={`0 0 ${docWidth} ${docHeight}`}
                    preserveAspectRatio="none"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      pointerEvents: 'none'
                    }}
                  >
                    {/* 1. 용지 바탕색 */}
                    <rect
                      x="0"
                      y="0"
                      width={docWidth}
                      height={docHeight}
                      fill={viewerPaperTheme === 'white' ? '#ffffff' : '#131314'}
                    />

                    {/* 2. 모눈종이 패턴 그리드 (배경 이미지가 없거나 칠판 모드일 때) */}
                    {!currentPageData.fullPageBackground && (
                      <g>
                        <defs>
                          <pattern
                            id={`grid-${docWidth}-${docHeight}`}
                            width="32"
                            height="32"
                            patternUnits="userSpaceOnUse"
                          >
                            <path
                              d="M 32 0 L 0 0 0 32"
                              fill="none"
                              stroke={viewerPaperTheme === 'white' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}
                              strokeWidth="1"
                            />
                          </pattern>
                        </defs>
                        <rect width={docWidth} height={docHeight} fill={`url(#grid-${docWidth}-${docHeight})`} />
                      </g>
                    )}

                    {/* 3. A4 전체 배경 이미지 (PDF 또는 학습지) - viewBox 안에서 xMidYMid meet로 동일하게 맞춤 */}
                    {currentPageData.fullPageBackground && (
                      <image
                        href={currentPageData.fullPageBackground}
                        x="0"
                        y="0"
                        width={docWidth}
                        height={docHeight}
                        preserveAspectRatio="xMidYMid meet"
                      />
                    )}

                    {/* 4. 임베디드 문제/스티커 이미지들 */}
                    {(currentPageData.images || []).map((img: any, idx: number) => {
                      const src = img.src || img.dataUrl;
                      if (!src) return null;
                      return (
                        <image
                          key={img.id || idx}
                          href={src}
                          x={img.x}
                          y={img.y}
                          width={img.width}
                          height={img.height}
                          preserveAspectRatio="none"
                        />
                      );
                    })}

                    {/* 5. 벡터 스트로크 (학생 손글씨 필기) - 배경과 동일한 좌표계에 1:1 완벽 렌더링 */}
                    {(currentPageData.strokes || []).map((stroke: any, idx: number) => {
                      if (!stroke.points || stroke.points.length === 0 || stroke.tool === 'eraser') return null;
                      let pathData = `M ${stroke.points[0].x} ${stroke.points[0].y}`;
                      for (let i = 1; i < stroke.points.length; i++) {
                        pathData += ` L ${stroke.points[i].x} ${stroke.points[i].y}`;
                      }
                      let strokeColor = stroke.color;
                      if (viewerPaperTheme === 'white' && (strokeColor === '#ffffff' || strokeColor === '#f8fafc')) {
                        strokeColor = '#0f172a';
                      } else if (viewerPaperTheme === 'dark' && (strokeColor === '#000000' || strokeColor === '#0f172a')) {
                        strokeColor = '#f8fafc';
                      }
                      return (
                        <path
                          key={stroke.id || idx}
                          d={pathData}
                          fill="none"
                          stroke={strokeColor || (viewerPaperTheme === 'white' ? '#0f172a' : '#ffffff')}
                          strokeWidth={stroke.size || 3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={stroke.tool === 'highlighter' ? 0.4 : 1.0}
                        />
                      );
                    })}

                    {/* 6. 텍스트 아이템들 */}
                    {(currentPageData.textItems || []).map((item: any, idx: number) => {
                      let textColor = item.color;
                      if (viewerPaperTheme === 'white' && textColor === '#ffffff') textColor = '#0f172a';
                      if (viewerPaperTheme === 'dark' && textColor === '#000000') textColor = '#f8fafc';
                      return (
                        <text
                          key={item.id || idx}
                          x={item.x}
                          y={(item.y || 0) + (item.fontSize || 16)}
                          fill={textColor || (viewerPaperTheme === 'white' ? '#0f172a' : '#ffffff')}
                          fontSize={item.fontSize || 16}
                          fontWeight="600"
                          fontFamily="sans-serif"
                        >
                          {item.text}
                        </text>
                      );
                    })}
                  </svg>

                  {/* 빈 페이지 안내 메시지 */}
                  {(currentPageData.strokes?.length || 0) === 0 &&
                   (currentPageData.textItems?.length || 0) === 0 &&
                   !currentPageData.fullPageBackground &&
                   (!currentPageData.images || currentPageData.images.length === 0) &&
                   !isLoadingDetail && (
                    <div
                      style={{
                        color: viewerPaperTheme === 'white' ? '#64748b' : '#8b949e',
                        fontSize: '13px',
                        zIndex: 5,
                        textAlign: 'center'
                      }}
                    >
                      ✏️ 이 페이지에 작성된 필기나 학습지가 없습니다.
                    </div>
                  )}
                </div>
              </div>

              {/* 모달 푸터 */}
              <div
                style={{
                  padding: '12px 20px',
                  borderTop: '1px solid #30363d',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#161b22',
                  flexShrink: 0
                }}
              >
                <span style={{ fontSize: '12px', color: '#8b949e' }}>
                  💡 학생이 태블릿에서 추가로 필기하거나 페이지를 넘기면 실시간으로 자동 반영됩니다.
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    style={{
                      background: 'rgba(56, 139, 253, 0.15)',
                      border: '1px solid #388bfd',
                      color: '#58a6ff',
                      borderRadius: '6px',
                      padding: '6px 14px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      showToast(`🌟 ${selectedStudentNote.student_name} 학생에게 '참 잘했어요!' 피드백을 전달했습니다.`);
                      setSelectedStudentNote(null);
                      selectedStudentKeyRef.current = null;
                    }}
                  >
                    🌟 참 잘했어요!
                  </button>
                  <button
                    type="button"
                    style={{
                      background: '#21262d',
                      border: '1px solid #30363d',
                      color: '#c9d1d9',
                      borderRadius: '6px',
                      padding: '6px 14px',
                      fontSize: '12.5px',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      setSelectedStudentNote(null);
                      selectedStudentKeyRef.current = null;
                    }}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
