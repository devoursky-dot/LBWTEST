/**
 * lassoFocusConfig.ts
 * ============================================================================
 * 올가미 집중 풀이 모듈 (Lasso Focus Module) 환경 설정 및 플러그인 토글
 * 
 * - 언제든 꼈다 뺐다 할 수 있는 완전 독립 플러그인 아키텍처
 * - enabled: false 로 설정 시 앱 전체에서 올가미 기능이 100% 무해하게 비활성화됩니다.
 * ============================================================================
 */

export interface LassoFocusConfig {
  /** 플러그인 활성화 여부 (원클릭 토글) */
  enabled: boolean;
  /** 시작점 자석 스냅 거리 (px) */
  snapRadius: number;
  /** 유효한 선택으로 인정하는 최소 둘레/가로세로 크기 (px) */
  minDimension: number;
  /** 상단 재배치 시 상단 여백 (px) */
  topMargin: number;
  /** 상단 재배치 시 허용되는 최대 너비 비율 (캔버스 너비 대비) */
  maxWidthRatio: number;
  /** 상단 재배치 시 허용되는 최대 높이 비율 (캔버스 높이 대비) */
  maxHeightRatio: number;
  /** 기본 배경색 폴백 */
  defaultBgColor: string;
  /** 문제 하단 풀이 안내선(디바이더) 표시 여부 */
  showDividerBadge: boolean;
}

export const defaultLassoFocusConfig: LassoFocusConfig = {
  enabled: true,
  snapRadius: 36,
  minDimension: 35,
  topMargin: 46,
  maxWidthRatio: 0.90,
  maxHeightRatio: 0.40,
  defaultBgColor: '#ffffff',
  showDividerBadge: true
};
