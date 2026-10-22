/**
 * Vercel / GitHub Pages / 로컬 개발 환경 호스트 판별 유틸
 */
export const getApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return '';
  if (window.location.hostname.includes('github.io')) {
    return 'https://lbwtest.vercel.app';
  }
  return '';
};
