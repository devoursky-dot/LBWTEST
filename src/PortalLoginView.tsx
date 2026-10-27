import React, { useState, useEffect, useRef } from 'react';
import {
  type UserRole,
  type UserSession,
  verifyWhiteboardPassword,
  verifyAdminPassword,
  verifyStudentLogin,
  changeStudentPassword,
  verifyTeacherLogin,
  changeTeacherPassword,
  setWhiteboardPermanentAuth,
  parseStudentId,
  setCurrentSession,
  getStoredStudentName,
  saveStoredStudentName,
  fetchStudentNameFromCloud
} from './lib/auth';
import { saveSavedStudentInfo } from './lib/studentSessionManager';
import { bindDirectTouchScroll, ensureInputVisible } from './lib/scrollModule';
import { QrScannerModal, useQrScannerAction } from './modules/qrScanner';
import { PwaInstallButton } from './modules/pwa';

interface PortalLoginViewProps {
  driveTeacherFolders: string[]; // 구글 드라이브에서 가져온 선생님 폴더 목록
  onLoginSuccess: (session: UserSession) => void;
}

export function PortalLoginView({ driveTeacherFolders, onLoginSuccess }: PortalLoginViewProps) {
  // 기본 로그인 화면을 학생(student) 위주로 설정
  const [activeTab, setActiveTab] = useState<UserRole>('student');
  const [isStaffMenuOpen, setIsStaffMenuOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 📷 카메라 QR코드 스캐너 모달 상태
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const { handleScannedResult } = useQrScannerAction();

  // 태블릿/스마트폰 터치 제스처 스크롤 및 휠 스크롤 100% 보장
  useEffect(() => {
    if (scrollContainerRef.current) {
      const cleanup = bindDirectTouchScroll(scrollContainerRef.current, { direction: 'y' });
      return cleanup;
    }
  }, []);

  // 🎨 실시간 디자인 테마 ('vercel' 딥 다크 모노크롬 vs 'linear' 슬레이트 글래스)
  const [designTheme, setDesignThemeState] = useState<'vercel' | 'linear'>(() => {
    try {
      return (localStorage.getItem('lbw_portal_theme') as any) || 'vercel';
    } catch {
      return 'vercel';
    }
  });
  const setDesignTheme = (t: 'vercel' | 'linear') => {
    setDesignThemeState(t);
    try {
      localStorage.setItem('lbw_portal_theme', t);
    } catch {}
  };
  const isVercel = designTheme === 'vercel';

  const themeStyles = isVercel ? {
    bg: '#000000',
    cardBg: '#0a0a0a',
    cardBorder: '1px solid #222222',
    cardShadow: '0 24px 60px rgba(0, 0, 0, 0.95), 0 0 0 1px #1a1a1a',
    tabContainerBg: '#111111',
    tabContainerBorder: '1px solid #222222',
    tabActiveBg: '#ffffff',
    tabActiveColor: '#000000',
    tabActiveShadow: '0 2px 8px rgba(255, 255, 255, 0.2)',
    tabInactiveColor: '#777777',
    inputBg: '#111111',
    inputBorder: '1px solid #262626',
    buttonBg: '#ffffff',
    buttonColor: '#000000',
    buttonShadow: '0 4px 14px rgba(255, 255, 255, 0.2)',
    noticeBg: 'rgba(255, 255, 255, 0.04)',
    noticeBorder: '1px solid #222222',
    noticeColor: '#d4d4d4',
    badgeBg: '#ffffff',
    badgeColor: '#000000'
  } : {
    bg: 'radial-gradient(ellipse at 50% 25%, #172554 0%, #0f172a 50%, #030712 100%)',
    cardBg: 'rgba(30, 41, 59, 0.72)',
    cardBorder: '1px solid rgba(56, 189, 248, 0.28)',
    cardShadow: '0 24px 64px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 40px rgba(37, 99, 235, 0.2)',
    tabContainerBg: 'rgba(15, 23, 42, 0.75)',
    tabContainerBorder: '1px solid rgba(255, 255, 255, 0.12)',
    tabActiveBg: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    tabActiveColor: '#ffffff',
    tabActiveShadow: '0 4px 14px rgba(59, 130, 246, 0.45)',
    tabInactiveColor: '#94a3b8',
    inputBg: 'rgba(15, 23, 42, 0.7)',
    inputBorder: '1px solid rgba(59, 130, 246, 0.3)',
    buttonBg: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    buttonColor: '#ffffff',
    buttonShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 8px 24px rgba(59, 130, 246, 0.45)',
    noticeBg: 'rgba(59, 130, 246, 0.12)',
    noticeBorder: '1px solid rgba(59, 130, 246, 0.3)',
    noticeColor: '#93c5fd',
    badgeBg: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    badgeColor: '#ffffff'
  };

  // 전자칠판 폼 상태
  const [wbPassword, setWbPassword] = useState('');
  const [wbRemember, setWbRemember] = useState(true);

  // 선생님 폼 상태
  const [teacherName, setTeacherName] = useState('');
  const [teacherPw, setTeacherPw] = useState('');
  const [isChangingTeacherPw, setIsChangingTeacherPw] = useState(false);
  const [newTeacherPw, setNewTeacherPw] = useState('');
  const [confirmTeacherPw, setConfirmTeacherPw] = useState('');

  // 학생 폼 상태
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentPw, setStudentPw] = useState('');
  const [isChangingStudentPw, setIsChangingStudentPw] = useState(false);
  const [newStudentPw, setNewStudentPw] = useState('');
  const [confirmStudentPw, setConfirmStudentPw] = useState('');

  // 관리자 폼 상태
  const [adminId, setAdminId] = useState('');
  const [adminPw, setAdminPw] = useState('');

  // 공통 로딩 / 오류 / 성공 메시지
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 4자리 학번 입력 시 기존에 저장된 학생 이름 자동 완성 (1회 입력 시 영구 유지)
  useEffect(() => {
    const parsed = parseStudentId(studentId);
    if (parsed.valid) {
      const localName = getStoredStudentName(studentId.trim());
      if (localName) {
        setStudentName(localName);
      } else {
        fetchStudentNameFromCloud(studentId.trim()).then(name => {
          if (name) setStudentName(name);
        });
      }
    }
  }, [studentId]);

  // 1. 전자칠판 로그인 핸들러 (미입력 시 초기 비밀번호 tch1234로 원클릭 즉시 접속)
  const handleWhiteboardLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const targetPw = wbPassword.trim() || 'tch1234';

    setIsLoading(true);
    try {
      const isCorrect = await verifyWhiteboardPassword(targetPw);
      if (!isCorrect) {
        setErrorMsg('❌ 전자칠판 비밀번호가 일치하지 않습니다. (초기 비밀번호: tch1234)');
        return;
      }

      if (wbRemember) {
        setWhiteboardPermanentAuth(true);
      }

      const session: UserSession = {
        role: 'whiteboard',
        id: 'whiteboard',
        name: '전자칠판 (기본모드)'
      };
      setCurrentSession(session);
      onLoginSuccess(session);
    } catch {
      setErrorMsg('인증 처리 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. 선생님 로그인 핸들러
  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const cleanName = teacherName.trim();
    if (!cleanName) {
      setErrorMsg('⚠️ 선생님 이름을 입력하거나 선택해 주세요.');
      return;
    }
    if (!teacherPw.trim()) {
      setErrorMsg('⚠️ 비밀번호를 입력해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const isCorrect = await verifyTeacherLogin(cleanName, teacherPw.trim());
      if (!isCorrect) {
        setErrorMsg('❌ 비밀번호가 올바르지 않습니다. (초기 비밀번호: 1234)');
        return;
      }

      // 비밀번호 변경 요청이 있는 경우
      if (isChangingTeacherPw) {
        if (!newTeacherPw.trim() || newTeacherPw.trim().length < 4) {
          setErrorMsg('⚠️ 새 비밀번호는 최소 4자리 이상이어야 합니다.');
          return;
        }
        if (newTeacherPw.trim() !== confirmTeacherPw.trim()) {
          setErrorMsg('⚠️ 새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
          return;
        }
        await changeTeacherPassword(cleanName, newTeacherPw.trim());
        setSuccessMsg('🎉 비밀번호가 안전하게 변경되었습니다!');
      }

      const session: UserSession = {
        role: 'teacher',
        id: `tch_${cleanName}`,
        name: `${cleanName} 선생님`
      };
      setCurrentSession(session);
      onLoginSuccess(session);
    } catch {
      setErrorMsg('인증 처리 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. 학생 로그인 핸들러 (1101 ~ 3830)
  const studentParsed = parseStudentId(studentId);

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!studentParsed.valid) {
      setErrorMsg('⚠️ 올바른 4자리 학번을 입력하세요 (예: 1101 ~ 3830, 1학년 1반 1번 = 1101)');
      return;
    }
    if (!studentPw.trim()) {
      setErrorMsg('⚠️ 비밀번호를 입력해 주세요. (초기 비밀번호: 1234)');
      return;
    }

    setIsLoading(true);
    try {
      const loginRes = await verifyStudentLogin(studentId.trim(), studentPw.trim());
      if (!loginRes.success) {
        setErrorMsg(loginRes.message || '❌ 비밀번호가 일치하지 않습니다. 비밀번호를 잊어버린 경우 관리자 선생님께 1234 초기화를 요청하세요.');
        return;
      }

      const cleanName = studentName.trim() || `${studentParsed.grade}-${studentParsed.classNum} ${studentParsed.studentNum}번`;

      // 비밀번호 변경 요청이 있는 경우
      if (isChangingStudentPw) {
        if (!newStudentPw.trim() || newStudentPw.trim().length < 4) {
          setErrorMsg('⚠️ 새 비밀번호는 최소 4자리 이상이어야 합니다.');
          return;
        }
        if (newStudentPw.trim() !== confirmStudentPw.trim()) {
          setErrorMsg('⚠️ 새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
          return;
        }
        const changeRes = await changeStudentPassword(studentId.trim(), newStudentPw.trim(), cleanName);
        if (!changeRes.success) {
          setErrorMsg(changeRes.message || '비밀번호 변경 실패');
          return;
        }
        setSuccessMsg('🎉 비밀번호가 성공적으로 변경되었습니다!');
      }

      // 학생 이름 로컬 및 클라우드 영구 저장 (차후 자동 완성)
      saveStoredStudentName(studentId.trim(), cleanName);

      // 학생 브라우저 로컬 스토리지에 정보 영구 저장 (차후 자동 완성)
      saveSavedStudentInfo({
        grade: studentParsed.grade,
        classNum: studentParsed.classNum,
        studentNum: studentParsed.studentNum,
        name: cleanName
      });

      const session: UserSession = {
        role: 'student',
        id: studentId.trim(),
        name: cleanName,
        grade: studentParsed.grade,
        classNum: studentParsed.classNum,
        studentNum: studentParsed.studentNum
      };
      setCurrentSession(session);
      onLoginSuccess(session);
    } catch {
      setErrorMsg('인증 검증 중 통신 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. 관리자 로그인 핸들러
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (adminId.trim() !== 'admin') {
      setErrorMsg('❌ 관리자 아이디가 일치하지 않습니다.');
      return;
    }
    if (!adminPw.trim()) {
      setErrorMsg('⚠️ 관리자 비밀번호를 입력해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const isCorrect = await verifyAdminPassword(adminPw.trim());
      if (!isCorrect) {
        setErrorMsg('❌ 관리자 비밀번호가 일치하지 않습니다.');
        return;
      }

      const session: UserSession = {
        role: 'admin',
        id: 'admin',
        name: '시스템 최고 관리자'
      };
      setCurrentSession(session);
      onLoginSuccess(session);
    } catch {
      setErrorMsg('인증 검증 중 통신 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        background: themeStyles.bg,
        padding: '76px 16px 80px 16px',
        fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        color: '#ffffff',
        transition: 'background 0.3s ease',
        boxSizing: 'border-box',
        zIndex: 10
      }}
    >
      {/* 🌟 실시간 디자인 스킬 체험 스위처 (실제 코드 동작 확인용) */}
      <div style={{
        position: 'fixed',
        top: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(20, 20, 20, 0.88)',
        backdropFilter: 'blur(16px)',
        padding: '5px 8px',
        borderRadius: '30px',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
        zIndex: 1000
      }}>
        <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, paddingLeft: '8px', paddingRight: '4px' }}>
          🎨 실시간 디자인 체험:
        </span>
        <button
          id="btn-theme-vercel"
          type="button"
          onClick={() => setDesignTheme('vercel')}
          style={{
            padding: '5px 12px',
            borderRadius: '20px',
            fontSize: '11.5px',
            fontWeight: 700,
            background: isVercel ? '#ffffff' : 'transparent',
            color: isVercel ? '#000000' : '#888888',
            border: isVercel ? '1px solid #ffffff' : '1px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <span>🖤</span>
          <span>1. 버셀 가이스트 (딥 다크)</span>
        </button>
        <button
          id="btn-theme-linear"
          type="button"
          onClick={() => setDesignTheme('linear')}
          style={{
            padding: '5px 12px',
            borderRadius: '20px',
            fontSize: '11.5px',
            fontWeight: 700,
            background: !isVercel ? '#3b82f6' : 'transparent',
            color: !isVercel ? '#ffffff' : '#888888',
            border: !isVercel ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <span>💎</span>
          <span>2. 리니어 (슬레이트 글래스)</span>
        </button>

        {/* PWA 앱 설치 버튼 (설치 완료 시 자동 숨김) */}
        <PwaInstallButton style={{ marginLeft: '4px' }} />
      </div>

      <div
        className="modal-box"
        data-scrollable-modal="true"
        style={{
          width: '100%',
          maxWidth: '480px',
          margin: 'auto 0',
          background: themeStyles.cardBg,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: themeStyles.cardBorder,
          borderRadius: '24px',
          padding: '36px 32px 32px 32px',
          boxShadow: themeStyles.cardShadow,
          position: 'relative',
          overflow: 'visible',
          transition: 'all 0.3s ease',
          boxSizing: 'border-box'
        }}
      >
        {/* 상단 장식 빛 */}
        <div style={{
          position: 'absolute',
          top: '-60px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '260px',
          height: '120px',
          background: isVercel 
            ? 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.1), transparent 70%)'
            : 'radial-gradient(ellipse at center, rgba(59, 130, 246, 0.35), transparent 70%)',
          pointerEvents: 'none'
        }} />

        {/* 우측 상단: 삼선(≡ 햄버거 메뉴) 교직원/관리자 숨김 메뉴 버튼 */}
        <div style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 100 }}>
          <button
            type="button"
            onClick={() => setIsStaffMenuOpen(!isStaffMenuOpen)}
            title="교직원 및 관리자 메뉴 (선생님/전자칠판/최고관리자)"
            style={{
              background: isStaffMenuOpen ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: isStaffMenuOpen ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isStaffMenuOpen ? '#60a5fa' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            {/* 삼선(≡) 대표 아이콘 */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          {/* 삼선 숨김 메뉴 팝오버 */}
          {isStaffMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '48px',
                right: 0,
                background: 'rgba(18, 22, 30, 0.98)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                borderRadius: '14px',
                padding: '8px',
                boxShadow: '0 16px 36px rgba(0, 0, 0, 0.8)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                minWidth: '180px',
                zIndex: 200
              }}
            >
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, padding: '4px 8px' }}>
                교직원 및 관리자 모드
              </div>
              <button
                type="button"
                onClick={() => { setActiveTab('teacher'); setIsStaffMenuOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: activeTab === 'teacher' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  border: 'none',
                  color: activeTab === 'teacher' ? '#60a5fa' : '#ffffff',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                title="선생님 로그인: 내 수업 자료 관리 및 QR수업 개설"
              >
                <span>👨‍🏫</span> 선생님 로그인
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('whiteboard'); setIsStaffMenuOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: activeTab === 'whiteboard' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  border: 'none',
                  color: activeTab === 'whiteboard' ? '#60a5fa' : '#ffffff',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                title="전자칠판 로그인: 교실 실시간 대시보드"
              >
                <span>🖥️</span> 전자칠판 모드
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('admin'); setIsStaffMenuOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: activeTab === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  border: 'none',
                  color: activeTab === 'admin' ? '#60a5fa' : '#ffffff',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                title="최고관리자: API 설정 및 회원 관리"
              >
                <span>🛡️</span> 최고관리자
              </button>
              {activeTab !== 'student' && (
                <>
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                  <button
                    type="button"
                    onClick={() => { setActiveTab('student'); setIsStaffMenuOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'rgba(34, 197, 94, 0.15)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      color: '#4ade80',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    title="기본 학생 필기 로그인 화면으로 복귀"
                  >
                    <span>🧑‍🎓</span> 학생 모드로 복귀
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 서비스 타이틀 */}
        <div style={{ textAlign: 'center', marginBottom: '28px', position: 'relative' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: themeStyles.badgeBg,
            color: themeStyles.badgeColor,
            boxShadow: isVercel ? '0 4px 16px rgba(255, 255, 255, 0.15)' : '0 8px 24px rgba(59, 130, 246, 0.4)',
            fontSize: '28px',
            marginBottom: '14px',
            transition: 'all 0.3s ease'
          }}>
            {activeTab === 'student' ? '🧑‍🎓' : activeTab === 'teacher' ? '👨‍🏫' : activeTab === 'whiteboard' ? '🖥️' : '🛡️'}
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 6px 0', letterSpacing: '-0.02em', color: '#ffffff' }}>
            {activeTab === 'student' ? '스마트 학생 필기 포털' : activeTab === 'teacher' ? '선생님 수업 관리' : activeTab === 'whiteboard' ? '스마트 전자칠판' : '시스템 최고 관리자'}
          </h1>
          <p style={{ fontSize: '13px', color: isVercel ? '#888888' : '#94a3b8', margin: 0 }}>
            {activeTab === 'student'
              ? '학번과 비밀번호를 입력하고 나만의 스마트 필기 공책을 시작하세요'
              : '인증 비밀번호를 입력하여 관리 모드로 로그인하세요'}
          </p>
        </div>

        {/* 교직원/관리자 모드 활성화 시 학생 모드 복귀 버튼 배너 */}
        {activeTab !== 'student' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(59, 130, 246, 0.12)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '12px',
            padding: '8px 14px',
            marginBottom: '20px'
          }}>
            <span style={{ fontSize: '12.5px', color: '#93c5fd', fontWeight: 600 }}>
              {activeTab === 'teacher' ? '👨‍🏫 선생님 모드' : activeTab === 'whiteboard' ? '🖥️ 전자칠판 모드' : '🛡️ 최고관리자 모드'}
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('student')}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: '#ffffff',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              title="기본 학생 필기 모드로 돌아갑니다"
            >
              🧑‍🎓 학생 모드로 복귀
            </button>
          </div>
        )}

        {/* 에러 / 성공 메시지 표시 */}
        {errorMsg && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '12.5px',
            marginBottom: '18px',
            textAlign: 'center',
            lineHeight: 1.5
          }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            color: '#86efac',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '12.5px',
            marginBottom: '18px',
            textAlign: 'center',
            lineHeight: 1.5
          }}>
            {successMsg}
          </div>
        )}

        {/* 탭 1: 전자칠판 로그인 */}
        {activeTab === 'whiteboard' && (
          <form onSubmit={handleWhiteboardLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '12px 14px', borderRadius: '12px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              💡 <strong>전자칠판 모드:</strong> 교실 칠판 전용 간편 접속입니다. 한 번 비밀번호를 입력하면 영구 유지되어 수업 시 매번 다시 묻지 않습니다.
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                  전자칠판 접속 비밀번호
                </label>
                <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 500 }}>
                  초기값: tch1234 (미입력 시 1클릭 즉시 접속)
                </span>
              </div>
              <input
                type="password"
                value={wbPassword}
                onChange={(e) => setWbPassword(e.target.value)}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="비밀번호 입력 (비워두고 시작하기를 누르면 자동 접속)"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#94a3b8', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={wbRemember}
                onChange={(e) => setWbRemember(e.target.checked)}
                style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }}
              />
              이 전자칠판 브라우저에서 영구 로그인 유지
            </label>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                marginTop: '8px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: isLoading ? '#475569' : themeStyles.buttonBg,
                color: themeStyles.buttonColor,
                fontSize: '14px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                boxShadow: themeStyles.buttonShadow,
                transition: 'all 0.15s ease'
              }}
            >
              {isLoading ? '인증 확인 중...' : '🖥️ 전자칠판 시작하기'}
            </button>
          </form>
        )}

        {/* 탭 2: 선생님 로그인 */}
        {activeTab === 'teacher' && (
          <form onSubmit={handleTeacherLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              📂 <strong>선생님 계정:</strong> 구글 드라이브의 선생님 폴더 이름으로 자동 계정이 연결됩니다. (초기 비밀번호: <code>1234</code>)
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                선생님 이름 (구글 드라이브 폴더명)
              </label>
              {driveTeacherFolders && driveTeacherFolders.length > 0 ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '12px 14px',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none'
                    }}
                  >
                    <option value="">선생님 폴더 선택 (또는 직접 입력)</option>
                    {driveTeacherFolders.map(folder => (
                      <option key={folder} value={folder} style={{ background: '#1e293b' }}>
                        📁 {folder} 선생님
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder="직접 입력"
                    style={{
                      width: '120px',
                      padding: '12px 10px',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none'
                    }}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                  placeholder="예: 홍길동 (드라이브 폴더 이름)"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  autoFocus
                />
              )}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                  비밀번호
                </label>
                <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 500 }}>
                  초기값: 1234
                </span>
              </div>
              <input
                type="password"
                value={teacherPw}
                onChange={(e) => setTeacherPw(e.target.value)}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="비밀번호 입력 (초기: 1234)"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* 비밀번호 변경 토글 */}
            <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '10px' }}>
              <button
                type="button"
                onClick={() => setIsChangingTeacherPw(!isChangingTeacherPw)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>{isChangingTeacherPw ? '▲ 비밀번호 변경 취소' : '🔑 비밀번호 변경하기'}</span>
              </button>

              {isChangingTeacherPw && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="password"
                    value={newTeacherPw}
                    onChange={(e) => setNewTeacherPw(e.target.value)}
                    placeholder="새 비밀번호 입력 (4자리 이상)"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <input
                    type="password"
                    value={confirmTeacherPw}
                    onChange={(e) => setConfirmTeacherPw(e.target.value)}
                    placeholder="새 비밀번호 확인"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                marginTop: '6px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: isLoading ? '#475569' : themeStyles.buttonBg,
                color: themeStyles.buttonColor,
                fontSize: '14px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                boxShadow: themeStyles.buttonShadow,
                transition: 'all 0.15s ease'
              }}
            >
              {isLoading ? '로그인 처리 중...' : '👨‍🏫 선생님 로그인'}
            </button>
          </form>
        )}

        {/* 탭 3: 학생 로그인 (1101 ~ 3830, 초기 비번: 1234) */}
        {activeTab === 'student' && (
          <form onSubmit={handleStudentLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* 📷 원터치 전자칠판 QR코드 스캔 즉시 입장 버튼 */}
            <button
              type="button"
              onClick={() => setIsQrScannerOpen(true)}
              style={{
                width: '100%',
                padding: '13px',
                borderRadius: '14px',
                border: '1.5px solid #a855f7',
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%)',
                color: '#e9d5ff',
                fontSize: '14px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(168, 85, 247, 0.35)',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ fontSize: '18px' }}>📷</span>
              <span>전자칠판 QR코드 찍고 바로 입장하기</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>또는 학번으로 로그인</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
            </div>

            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              🎒 <strong>학생 계정:</strong> 1101(1학년 1반 1번)부터 3830(3학년 8반 30번)까지 4자리 학번을 입력합니다. (초기 비밀번호: <code>1234</code>)
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                  학번 (4자리 숫자)
                </label>
                {studentParsed.valid && (
                  <span style={{ fontSize: '11.5px', color: '#86efac', fontWeight: 600 }}>
                    ✓ {studentParsed.label}
                  </span>
                )}
              </div>
              <input
                type="text"
                maxLength={4}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value.replace(/[^0-9]/g, ''))}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="예: 1101, 2315, 3830"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: studentParsed.valid ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '15px',
                  fontWeight: 600,
                  letterSpacing: '1px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                학생 이름
              </label>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="예: 홍길동"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                비밀번호
              </label>
              <input
                type="password"
                value={studentPw}
                onChange={(e) => setStudentPw(e.target.value)}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="비밀번호 입력"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* 학생 비밀번호 변경 토글 */}
            <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '10px' }}>
              <button
                type="button"
                onClick={() => setIsChangingStudentPw(!isChangingStudentPw)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>{isChangingStudentPw ? '▲ 비밀번호 변경 취소' : '🔑 비밀번호 변경하기'}</span>
              </button>

              {isChangingStudentPw && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="password"
                    value={newStudentPw}
                    onChange={(e) => setNewStudentPw(e.target.value)}
                    placeholder="새 비밀번호 입력 (4자리 이상)"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <input
                    type="password"
                    value={confirmStudentPw}
                    onChange={(e) => setConfirmStudentPw(e.target.value)}
                    placeholder="새 비밀번호 확인 입력"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                marginTop: '6px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: isLoading ? '#475569' : (isVercel ? '#ffffff' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'),
                color: isVercel ? '#000000' : '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                boxShadow: isVercel ? '0 4px 14px rgba(255, 255, 255, 0.25)' : '0 8px 20px rgba(16, 185, 129, 0.4)',
                transition: 'all 0.15s ease'
              }}
            >
              {isLoading ? '학생 인증 중...' : '👨‍🎓 학생 수업 참여하기'}
            </button>
          </form>
        )}

        {/* 탭 4: 관리자 로그인 */}
        {activeTab === 'admin' && (
          <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: '#fde047', lineHeight: 1.5 }}>
              🛡️ <strong>시스템 최고 관리자:</strong> 전자칠판, 선생님, 720개 학생 계정의 비밀번호를 안전하게 관리하고 초기화합니다.
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                관리자 아이디
              </label>
              <input
                type="text"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="관리자 아이디 입력"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                관리자 비밀번호
              </label>
              <input
                type="password"
                value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)}
                onFocus={(e) => ensureInputVisible(e.target as HTMLElement)}
                placeholder="관리자 전용 비밀번호 입력"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                marginTop: '10px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: isLoading ? '#475569' : (isVercel ? '#ffffff' : 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)'),
                color: isVercel ? '#000000' : '#1e293b',
                fontSize: '14px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                boxShadow: isVercel ? '0 4px 14px rgba(255, 255, 255, 0.25)' : '0 8px 20px rgba(234, 179, 8, 0.4)',
                transition: 'all 0.15s ease'
              }}
            >
              {isLoading ? '관리자 권한 확인 중...' : '🛡️ 관리자 대시보드 열기'}
            </button>
          </form>
        )}
      </div>

      {/* 📷 카메라 QR코드 스캐너 모달 */}
      <QrScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanSuccess={handleScannedResult}
      />
    </div>
  );
}
