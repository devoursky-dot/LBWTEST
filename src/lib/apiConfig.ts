/**
 * Vercel / GitHub Pages / 로컬 개발 환경 호스트 판별 유틸
 */
export const getApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return '';
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (window.location.hostname.includes('github.io')) {
    return 'https://lbwtest.vercel.app';
  }
  return '';
};
