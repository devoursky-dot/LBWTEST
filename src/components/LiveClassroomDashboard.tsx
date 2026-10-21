import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from '../lib/supabase';
import { classroomRealtime, type StudentPresenceInfo, type RealtimeSignalPayload } from '../lib/classroomRealtime';
import { generateClassSubmissionPdf } from '../lib/pdfGenerator';
import { StudentNoteFullscreenViewer } from './StudentNoteFullscreenViewer';

export interface LiveClassroomDashboardProps {
  lesson: {
    id: string;
    folderId?: string;
    name: string;
    teacherPin?: string;
  };
  initialClear?: boolean;
  onExit: () => void;
  onOpenFolder?: (folderId: string, folderName: string) => void;
  executeDriveAction: (payload: any) => Promise<any>;
  showToast: (msg: string) => void;
}

export const LiveClassroomDashboard: React.FC<LiveClassroomDashboardProps> = ({
  lesson,
  initialClear = false,
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
  const selectedStudentKeyRef = useRef<string | null>(null);

  // PDF 일괄 컴파일 상태
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  // 사이드바 접힘 상태 및 25명 한화면 자동배치 보기 모드 ('auto' | 'scroll')
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'auto' | 'scroll'>('auto');

  // 1. 학생 참여 QR 코드 및 전용 접속 URL 생성
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

  // 세션 전체 초기화 함수 (새로운 반 또는 새 수업 시작 시)
  const handleResetSession = async () => {
    if (!window.confirm('정말 현재 수업의 모든 학생 출석 및 필기 기록을 초기화하시겠습니까?\n새로운 반 학생들의 등록을 깨끗하게 새로 받습니다.')) {
      return;
    }
    try {
      if (supabase && isSupabaseConfigured) {
        await supabase.from('class_notes').delete().eq('lesson_id', currentLessonId);
      }
      setStudentSubmissions([]);
      setStudentPresences(new Map());
      setSelectedStudentNote(null);
      selectedStudentKeyRef.current = null;

      // 연결되어 있던 학생 기기들에 세션 리셋 신호 전파
      classroomRealtime.sendSignal({
        type: 'RESET_SESSION',
        lessonId: currentLessonId
      });

      showToast('✨ 수업 세션 및 출석 기록이 깨끗이 초기화되었습니다.');
    } catch (e: any) {
      console.error('초기화 오류:', e);
      showToast('❌ 초기화 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    if (initialClear) {
      setStudentSubmissions([]);
      setStudentPresences(new Map());
      if (supabase && isSupabaseConfigured) {
        supabase.from('class_notes').delete().eq('lesson_id', currentLessonId).then(() => {
          classroomRealtime.sendSignal({
            type: 'RESET_SESSION',
            lessonId: currentLessonId
          });
        });
      }
    } else {
      fetchSubmissionsFromDb();
    }
  }, [currentLessonId, initialClear]);

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
        // [중요 가드]: 제출 기록이 없는 학생은 오직 현재 'connected' 상태이거나 최근 1분 이내의 활동일 때만 명단에 추가
        // 과거 세션에서 남은 유령 이탈자 신호는 새 세션 학생 명단에 뜨지 않도록 원천 차단
        const lastActiveTime = presence.lastActive ? new Date(presence.lastActive).getTime() : 0;
        const isRecent = Date.now() - lastActiveTime < 60000;
        if (presence.status === 'connected' || (presence.status === 'away' && isRecent)) {
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
    }

    // 3) 학번순 엄격 자연 정렬 (학년 -> 반 -> 번호 오름차순, 1번~35번 완벽 보장)
    const list = Array.from(studentMap.values());
    const parseNum = (val?: string) => {
      if (!val) return 999;
      const m = String(val).match(/\d+/);
      return m ? parseInt(m[0], 10) : 999;
    };

    list.sort((a, b) => {
      const gradeA = parseNum(a.grade);
      const gradeB = parseNum(b.grade);
      if (gradeA !== gradeB) return gradeA - gradeB;

      const classA = parseNum(a.classNum);
      const classB = parseNum(b.classNum);
      if (classA !== classB) return classA - classB;

      const numA = parseNum(a.studentNum);
      const numB = parseNum(b.studentNum);
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

    // 만약 이미 메모리에 strokes_data가 있는 경우 즉시 표시 및 첫 비어있지 않은 쪽으로 포커스
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

          {/* 수업 초기화 버튼 (원터치 초기화) */}
          <button
            type="button"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            onClick={handleResetSession}
            title="현재 수업의 모든 학생 등록 및 필기 기록을 초기화합니다."
          >
            🔄 수업 초기화
          </button>

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

            <p style={{ fontSize: '12.5px', color: '#8b949e', textAlign: 'center', marginTop: '12px', lineHeight: 1.5 }}>
              태블릿 카메라로 QR을 스캔한 뒤<br />
              <strong>[📡 전자칠판 연결]</strong>을 누르면<br />
              우측에 실시간 출석으로 표시됩니다.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', width: '100%' }}>
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

            <div style={{ marginTop: 'auto', paddingTop: '16px', width: '100%', borderTop: '1px solid #30363d', textAlign: 'center' }}>
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

        {/* 우측 메인 영역: 25명 한 화면 자동배치 그리드 */}
        {(() => {
          const totalStudents = sortedStudentRoster.length;
          // 25명 기준 최적 자동 배치 그리드 열 및 행 계산 (5열 x 5행 = 25명 완벽 맞춤)
          const autoCols = totalStudents <= 4 ? 4 : totalStudents <= 12 ? 4 : totalStudents <= 20 ? 5 : totalStudents <= 25 ? 5 : totalStudents <= 30 ? 6 : totalStudents <= 40 ? 7 : 8;
          const autoRows = totalStudents <= 4 ? 4 : Math.max(1, Math.ceil(totalStudents / autoCols));

          return (
            <main
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                padding: '16px 24px',
                overflow: viewMode === 'auto' ? 'hidden' : 'auto',
                height: '100%',
                boxSizing: 'border-box'
              }}
            >
              {/* 타이틀 및 정렬 안내 바 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  gap: '12px',
                  flexShrink: 0
                }}
              >
                <div>
                  <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                    👥 전체 학생 실시간 출석 및 필기 모니터링
                  </h2>
                  <span style={{ fontSize: '12px', color: '#8b949e', marginTop: '3px', display: 'block' }}>
                    학번순(1번~35번) 자동 정렬 • 타일을 터치하면 학생 필기를 전체화면으로 즉시 열람합니다.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {/* 보기 모드: 25명 자동배치 vs 큰 타일(스크롤) 토글 */}
                  <div
                    style={{
                      display: 'flex',
                      background: '#21262d',
                      padding: '2px',
                      borderRadius: '8px',
                      border: '1px solid #30363d'
                    }}
                    title="전자칠판 학생 타일 배치 모드 선택"
                  >
                    <button
                      type="button"
                      style={{
                        background: viewMode === 'auto' ? '#388bfd' : 'transparent',
                        color: viewMode === 'auto' ? '#ffffff' : '#8b949e',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      onClick={() => setViewMode('auto')}
                      title="25명 전체 학생을 스크롤 없이 한 화면에 자동 배치"
                    >
                      📱 25명 자동배치 (한 화면)
                    </button>
                    <button
                      type="button"
                      style={{
                        background: viewMode === 'scroll' ? '#388bfd' : 'transparent',
                        color: viewMode === 'scroll' ? '#ffffff' : '#8b949e',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      onClick={() => setViewMode('scroll')}
                      title="타일을 크게 보고 스크롤"
                    >
                      🔍 큰 타일 (스크롤)
                    </button>
                  </div>

                  <button
                    type="button"
                    style={{
                      background: '#21262d',
                      border: '1px solid #30363d',
                      color: '#c9d1d9',
                      borderRadius: '6px',
                      padding: '5px 12px',
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
                    좌측 QR코드로 학생들이 접속하고 <strong>[📡 전자칠판 연결]</strong>을 터치하면<br />
                    이곳에 학생별 출석 카드와 필기 현황이 학번순으로 나타납니다.
                  </p>
                </div>
              ) : (
                <div
                  style={
                    viewMode === 'auto'
                      ? {
                          flex: 1,
                          minHeight: 0,
                          display: 'grid',
                          gridTemplateColumns: `repeat(${autoCols}, minmax(0, 1fr))`,
                          gridTemplateRows: `repeat(${autoRows}, minmax(0, 1fr))`,
                          gap: '8px',
                          height: '100%',
                          overflow: 'hidden'
                        }
                      : {
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                          gap: '12px',
                          overflowY: 'auto',
                          paddingBottom: '20px'
                        }
                  }
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
                      cardBg = 'rgba(56, 139, 253, 0.12)';
                    } else if (isAway) {
                      badgeBg = '#da3633';
                      badgeLabel = '🚨 이탈 감지';
                      borderColor = '#f85149';
                      cardBg = 'rgba(248, 81, 73, 0.14)';
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
                          borderRadius: '10px',
                          padding: viewMode === 'auto' ? '6px 8px' : '14px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          position: 'relative',
                          boxShadow: isOnline ? '0 4px 14px rgba(56, 139, 253, 0.2)' : 'none',
                          minHeight: 0,
                          height: '100%',
                          boxSizing: 'border-box'
                        }}
                        title="클릭하여 학생 필기 원본을 전체화면으로 확인"
                      >
                        {/* 우측 상단 상태 닷 */}
                        <span
                          style={{
                            position: 'absolute',
                            top: '6px',
                            right: '6px',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: isOnline ? '#3fb950' : (isAway ? '#f85149' : '#8b949e')
                          }}
                        />

                        {/* 아이콘 + 학번 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: viewMode === 'auto' ? '18px' : '26px' }}>
                            {isAway ? '🚨' : '👨‍🎓'}
                          </span>
                          <span style={{ fontSize: viewMode === 'auto' ? '12px' : '13.5px', fontWeight: 700, color: '#93c5fd' }}>
                            {studentItem.grade}-{studentItem.classNum} {studentItem.studentNum}번
                          </span>
                        </div>

                        {/* 학생 이름 */}
                        <span
                          style={{
                            fontSize: viewMode === 'auto' ? '14px' : '15px',
                            fontWeight: 800,
                            color: '#ffffff',
                            marginTop: '2px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%'
                          }}
                        >
                          {studentItem.name}
                        </span>

                        {/* 상태 라벨 뱃지 및 필기 여부 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          <span
                            style={{
                              fontSize: viewMode === 'auto' ? '9.5px' : '10.5px',
                              fontWeight: 700,
                              color: '#ffffff',
                              background: badgeBg,
                              padding: '1px 6px',
                              borderRadius: '8px'
                            }}
                          >
                            {badgeLabel}
                          </span>
                          {hasNote && (
                            <span
                              style={{
                                fontSize: viewMode === 'auto' ? '9.5px' : '10.5px',
                                color: '#67e8f9',
                                background: 'rgba(6, 182, 212, 0.15)',
                                border: '1px solid rgba(6, 182, 212, 0.3)',
                                padding: '1px 5px',
                                borderRadius: '8px',
                                fontWeight: 700
                              }}
                            >
                              📝 필기
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </main>
          );
        })()}
      </div>

      {/* 4. 전자칠판 전체화면 학생 필기 뷰어 (나가기 버튼 + 쪽 이동 + 확대축소/팬) */}
      {selectedStudentNote && (
        <StudentNoteFullscreenViewer
          noteRecord={selectedStudentNote}
          initialPageIdx={selectedStudentPageIdx}
          isLoading={isLoadingDetail}
          onClose={() => {
            setSelectedStudentNote(null);
            selectedStudentKeyRef.current = null;
          }}
          onSendFeedback={(studentName) => {
            showToast(`🌟 ${studentName} 학생에게 '참 잘했어요!' 피드백을 전달했습니다.`);
          }}
        />
      )}
    </div>
  );
};
