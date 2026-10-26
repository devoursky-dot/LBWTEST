/**
 * qrDecoder.ts
 * ============================================================================
 * 하드웨어 가속 BarcodeDetector + jsQR 듀얼 QR 디코딩 엔진
 * ============================================================================
 */

import jsQR from 'jsqr';

export async function decodeQrFromImageData(
  imageData: ImageData,
  videoElement?: HTMLVideoElement
): Promise<string | null> {
  // 1. 최신 브라우저 네이티브 BarcodeDetector 우선 시도 (초고속 하드웨어 가속)
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window && videoElement) {
    try {
      const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await barcodeDetector.detect(videoElement);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        return barcodes[0].rawValue;
      }
    } catch {
      // BarcodeDetector 실패 시 jsQR로 즉시 폴백
    }
  }

  // 2. 크로스플랫폼 순수 JS 디코더 jsQR 실행
  try {
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });
    if (code && code.data) {
      return code.data;
    }
  } catch (err) {
    console.warn('[QRDecoder] 디코딩 예외:', err);
  }

  return null;
}
