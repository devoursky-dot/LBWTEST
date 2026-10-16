// Vercel Serverless Function: Google Drive Unified API
export const config = {
  runtime: 'edge', // Edge Runtime for ultra-low latency & global CDN caching
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
  // 1. 다운로드 스마트 바이패스 프록시 (전자칠판 안전 다운로드)
  // =========================================================================
  if (action === 'download' && fileId) {
    try {
      // 1-1. 바이러스 검사 경고 페이지 토큰 검사
      const checkUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const pageRes = await fetch(checkUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'follow',
      });

      const pageHtml = await pageRes.text();
      const uuidMatch = pageHtml.match(/uuid=([^&"']+)/i) || pageHtml.match(/name="uuid" value="([^"]+)"/i);
      const confirmMatch = pageHtml.match(/confirm=([^&"']+)/i) || pageHtml.match(/name="confirm" value="([^"]+)"/i);

      let targetDownloadUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
      if (uuidMatch) {
        const uuid = uuidMatch[1];
        const confirm = confirmMatch ? confirmMatch[1] : 't';
        targetDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirm}&uuid=${uuid}`;
      }

      // 1-2. 클라이언트로 직접 리다이렉트 또는 다운로드 헤더 반환
      return Response.redirect(targetDownloadUrl, 302);
    } catch (e: any) {
      return new Response(JSON.stringify({ error: 'Download failed', message: e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // =========================================================================
  // 2. 파일 목록 조회 (공식 Google Drive API v3 우선 -> 폴백 지원)
  // =========================================================================
  let items: DriveItem[] = [];
  let source = 'unknown';

  // [방법 A] 공식 Google Drive API v3 (API Key가 유효할 때)
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
              downloadUrl: isFolder 
                ? `https://drive.google.com/drive/folders/${file.id}?usp=sharing` 
                : `https://drive.google.com/uc?export=download&confirm=t&id=${file.id}`
            };
          });
          source = 'google_api_v3';
        }
      }
    } catch (e) {
      console.warn('Google API v3 fetch failed, falling back to proxy:', e);
    }
  }

  // [방법 B] 공식 API 키가 없거나 실패한 경우: 구글 직통 임베드 프록시 (외부 불안정 프록시 제거)
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
            downloadUrl: isFolder 
              ? `https://drive.google.com/drive/folders/${id}?usp=sharing` 
              : `https://drive.google.com/uc?export=download&confirm=t&id=${id}`
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
      'Cache-Control': 's-maxage=30, stale-while-revalidate=120', // Edge CDN Caching
    }
  });
}
