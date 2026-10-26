/**
 * useQrScannerAction.ts
 * ============================================================================
 * 스캔된 QR 코드 텍스트 분석 및 자동 수업 입장 처리 훅
 * ============================================================================
 */

import { useCallback } from 'react';

export function useQrScannerAction(options?: {
  onEnterLesson?: (lessonId: string, title?: string, pdfId?: string) => void;
}) {
  const handleScannedResult = useCallback((scannedText: string) => {
    if (!scannedText) return;

    try {
      // 1. URL 형태인 경우 파라미터 파싱
      let url: URL;
      if (scannedText.startsWith('http://') || scannedText.startsWith('https://')) {
        url = new URL(scannedText);
      } else {
        // 상대 경로인 경우 가상 base 붙여 파싱
        url = new URL(scannedText, window.location.origin);
      }

      const lessonId = url.searchParams.get('lessonId');
      const title = url.searchParams.get('title') || 'QR 참여 수업';
      const pdfId = url.searchParams.get('pdfId') || undefined;

      if (lessonId) {
        if (options?.onEnterLesson) {
          options.onEnterLesson(lessonId, title, pdfId);
        } else {
          // 직접 URL 파라미터를 갱신하여 진입
          window.location.href = url.toString();
        }
        return;
      }
    } catch {
      // URL 파싱 실패 시 단순 텍스트 검사
    }

    // 2. 만약 순수 lessonId 텍스트인 경우
    if (scannedText.trim().length > 3) {
      if (options?.onEnterLesson) {
        options.onEnterLesson(scannedText.trim(), 'QR 참여 수업');
      } else {
        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.set('lessonId', scannedText.trim());
        window.location.href = targetUrl.toString();
      }
      return;
    }

    alert('유효한 수업 QR코드가 아닙니다:\n' + scannedText);
  }, [options]);

  return { handleScannedResult };
}
