import * as pdfjsLib from 'pdfjs-dist';

// Vite 및 브라우저 호환 워커 설정 (CDN 최신 안정 버전 매핑)
if (typeof window !== 'undefined' && (pdfjsLib as any).GlobalWorkerOptions) {
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${(pdfjsLib as any).version || '2.16.105'}/pdf.worker.min.js`;
}

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  aspectRatio: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PDF 파일을 로드하여 PDFDocumentProxy 인스턴스를 반환합니다.
 * (File, Blob, ArrayBuffer, URL 문자열 모두 지원)
 */
export async function loadPdfDocument(source: File | Blob | ArrayBuffer | string): Promise<any> {
  if (typeof source === 'string') {
    const loadingTask = (pdfjsLib as any).getDocument(source);
    return await loadingTask.promise;
  } else if (source instanceof ArrayBuffer) {
    const loadingTask = (pdfjsLib as any).getDocument({ data: source });
    return await loadingTask.promise;
  } else if (source instanceof Blob) {
    const arrayBuffer = await source.arrayBuffer();
    const loadingTask = (pdfjsLib as any).getDocument({ data: arrayBuffer });
    return await loadingTask.promise;
  }
  throw new Error('지원되지 않는 PDF 데이터 형식입니다.');
}

/**
 * PDF 문서의 모든 페이지 썸네일을 고속 추출합니다.
 */
export async function renderPdfThumbnails(
  pdfDoc: any,
  thumbWidth = 200
): Promise<Array<{ pageNumber: number; dataUrl: string; width: number; height: number }>> {
  const results: Array<{ pageNumber: number; dataUrl: string; width: number; height: number }> = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = thumbWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      results.push({
        pageNumber: pageNum,
        dataUrl: canvas.toDataURL('image/jpeg', 0.75),
        width: Math.round(unscaledViewport.width),
        height: Math.round(unscaledViewport.height)
      });
    }
  }

  return results;
}

/**
 * PDF 문서의 썸네일을 점진적(Progressive/Streaming)으로 초고속 추출합니다.
 * 각 페이지가 렌더링될 때마다 onPageReady 콜백을 즉시 호출하여
 * 사용자가 첫 페이지부터 0.1초 만에 확인하고 바로 삽입할 수 있도록 합니다.
 */
export async function renderPdfThumbnailsProgressive(
  pdfDoc: any,
  onPageReady: (thumb: { pageNumber: number; dataUrl: string; width: number; height: number }) => void,
  thumbWidth = 200,
  isCancelled?: () => boolean
): Promise<void> {
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    if (isCancelled && isCancelled()) break;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const scale = thumbWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (isCancelled && isCancelled()) break;

        onPageReady({
          pageNumber: pageNum,
          dataUrl: canvas.toDataURL('image/jpeg', 0.75),
          width: Math.round(unscaledViewport.width),
          height: Math.round(unscaledViewport.height)
        });
      }
    } catch (err) {
      console.warn(`PDF ${pageNum}페이지 썸네일 생성 경고:`, err);
    }
  }
}

/**
 * PDF 문서의 특정 페이지를 초고화질(High-DPI) Canvas DataURL로 추출합니다.
 */
export async function renderPdfPageToDataUrl(
  pdfDoc: any,
  pageNumber: number,
  maxDimension = 2000
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1.0 });

  const maxOriginal = Math.max(unscaledViewport.width, unscaledViewport.height);
  const scale = Math.min(3.0, Math.max(1.5, maxDimension / maxOriginal));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context 생성 실패');
  }

  // 흰색 배경 기본 채우기 (투명 PDF 방지)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: Math.round(viewport.width),
    height: Math.round(viewport.height)
  };
}

/**
 * 일반 이미지 파일(jpg, png, webp 등)을 DataURL 및 크기로 로드합니다.
 */
export function loadImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        resolve({
          dataUrl,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
        });
      };
      img.onerror = () => reject(new Error('이미지 로드에 실패했습니다.'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('파일 읽기 오류'));
    reader.readAsDataURL(file);
  });
}

/**
 * 원본 이미지의 특정 영역(CropRect)을 잘라내어 새 DataURL로 반환합니다.
 */
export function cropImageDataUrl(
  imageSrc: string,
  cropRect: CropRect
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(10, Math.round(cropRect.width));
      canvas.height = Math.max(10, Math.round(cropRect.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context 생성 실패'));
        return;
      }

      ctx.drawImage(
        img,
        Math.round(cropRect.x),
        Math.round(cropRect.y),
        Math.round(cropRect.width),
        Math.round(cropRect.height),
        0,
        0,
        canvas.width,
        canvas.height
      );

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('크롭 대상 이미지 로드 실패'));
    img.src = imageSrc;
  });
}
