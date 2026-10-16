// Vercel Serverless Function: Google Drive Unified API (Edge Runtime)
export const config = {
  runtime: 'edge', // Edge Runtime for global low-latency streaming
};

interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'document';
  folderId?: string;
  size?: string;
  updatedAt: string;
  viewUrl: string;
  downloadUrl: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';
  const folderId = url.searchParams.get('folderId') || url.searchParams.get('id') || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
  const fileId = url.searchParams.get('fileId') || url.searchParams.get('id');
  const fileName = url.searchParams.get('fileName') || '수업자료.pdf';
  const apiKey = url.searchParams.get('apiKey') || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // =========================================================================
  // 1. [핵심] 완전 백엔드 바이트 스트리밍 다운로드 (전자칠판 구글로그인/경고창 100% 원천 차단)
  // =========================================================================
  if (action === 'download' && fileId) {
    try {
      // 1-1. 대용량 바이러스 경고 페이지에서 동적 uuid 및 confirm 값 추출
      const pageUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const checkRes = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const checkHtml = await checkRes.text();

      const uuidMatch = checkHtml.match(/uuid=([^&"']+)/i) || checkHtml.match(/name="uuid" value="([^"]+)"/i);
      const confirmMatch = checkHtml.match(/confirm=([^&"']+)/i) || checkHtml.match(/name="confirm" value="([^"]+)"/i);

      let realDownloadUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
      if (uuidMatch) {
        const uuid = uuidMatch[1];
        const confirm = confirmMatch ? confirmMatch[1] : 't';
        realDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirm}&uuid=${uuid}`;
      }

      // 1-2. 구글 파일 스트림 직접 수신 (브라우저를 구글 도메인으로 리다이렉트하지 않음!)
      const googleStreamRes = await fetch(realDownloadUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!googleStreamRes.ok) {
        throw new Error(`Google stream error: ${googleStreamRes.statusText}`);
      }

      // 1-3. 한글 파일명 및 강제 다운로드 헤더 설정
      const safeFilename = encodeURIComponent(fileName);
      const headers = new Headers({
        ...corsHeaders,
        'Content-Type': googleStreamRes.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
      });

      const contentLength = googleStreamRes.headers.get('content-length');
      if (contentLength) {
        headers.set('Content-Length', contentLength);
      }

      // 1-4. 순수 바이너리 스트림 파이핑 반환 (구글 로그인 창, 바이러스 경고 화면 0%)
      return new Response(googleStreamRes.body, {
        status: 200,
        headers,
      });

    } catch (e: any) {
      console.error('Download streaming error:', e);
      return new Response(JSON.stringify({ error: 'Download stream failed', message: e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // =========================================================================
  // 2. 파일 목록 조회 (공식 Google Drive API v3 우선 -> 직통 뷰어 폴백)
  // =========================================================================
  let items: DriveItem[] = [];
  let source = 'unknown';

  // [방법 A] 공식 Google Drive API v3
  if (apiKey) {
    try {
      const gApiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${apiKey}`;
      const gRes = await fetch(gApiUrl);
      if (gRes.ok) {
        const data = await gRes.json();
        if (data.files && Array.isArray(data.files)) {
          items = data.files.map((file: any) => {
            const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
            const sizeBytes = file.size ? parseInt(file.size, 10) : 0;
            const sizeStr = sizeBytes > 0 
              ? sizeBytes > 1024 * 1024 
                ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` 
                : `${(sizeBytes / 1024).toFixed(0)} KB` 
              : '-';

            const modDate = file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ko-KR') : '-';

            return {
              id: file.id,
              name: file.name,
              type: isFolder ? 'folder' : 'document',
              folderId: isFolder ? file.id : undefined,
              size: isFolder ? '-' : sizeStr,
              updatedAt: modDate,
              viewUrl: isFolder 
                ? `https://drive.google.com/drive/folders/${file.id}?usp=sharing` 
                : `https://drive.google.com/file/d/${file.id}/view?usp=sharing`,
              downloadUrl: `/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`
            };
          });
          source = 'google_api_v3';
        }
      }
    } catch (e) {
      console.warn('Google API v3 fetch failed, falling back:', e);
    }
  }

  // [방법 B] 공식 API 키가 없거나 실패한 경우: 구글 직통 임베드 수집
  if (items.length === 0) {
    try {
      const targetUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (res.ok) {
        const html = await res.text();
        const regex = /class="flip-entry" id="entry-([^"]+)"[\s\S]*?href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]+)<\/div>[\s\S]*?class="flip-entry-last-modified">\s*<div>([^<]+)<\/div>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          const id = match[1];
          const href = match[2];
          const name = match[3].trim();
          const rawDate = match[4].trim();
          const isFolder = href.includes('/drive/folders/');

          items.push({
            id,
            name,
            type: isFolder ? 'folder' : 'document',
            folderId: isFolder ? id : undefined,
            size: '-',
            updatedAt: rawDate,
            viewUrl: isFolder 
              ? `https://drive.google.com/drive/folders/${id}?usp=sharing` 
              : `https://drive.google.com/file/d/${id}/view?usp=sharing`,
            downloadUrl: `/api/drive?action=download&fileId=${id}&fileName=${encodeURIComponent(name)}`
          });
        }
        source = 'google_direct_embedded';
      }
    } catch (e: any) {
      console.warn('Direct embedded fetch failed:', e);
    }
  }

  return new Response(JSON.stringify({ 
    success: true, 
    source, 
    folderId,
    itemCount: items.length, 
    items 
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 's-maxage=30, stale-while-revalidate=120',
    }
  });
}
