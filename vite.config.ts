import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 로컬 개발 환경용 Vercel API 모의 미들웨어 플러그인 (다운로드 완전 바이트 스트리밍 포함)
function localDriveApiPlugin(): Plugin {
  return {
    name: 'local-drive-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/drive')) {
          const urlObj = new URL(req.url, 'http://localhost:5173');
          const action = urlObj.searchParams.get('action') || 'list';
          const fileId = urlObj.searchParams.get('fileId') || urlObj.searchParams.get('id');
          const fileName = urlObj.searchParams.get('fileName') || '수업자료.pdf';
          const folderId = urlObj.searchParams.get('folderId') || urlObj.searchParams.get('id') || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';

          // ===================================================================
          // 1. [로컬] 다운로드 완전 바이트 스트리밍
          // ===================================================================
          if (action === 'download' && fileId) {
            try {
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

              const streamRes = await fetch(realDownloadUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
              });

              const safeFilename = encodeURIComponent(fileName);
              res.writeHead(200, {
                'Content-Type': streamRes.headers.get('content-type') || 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
                'Content-Length': streamRes.headers.get('content-length') || '',
                'Access-Control-Allow-Origin': '*'
              });

              const reader = streamRes.body?.getReader();
              if (reader) {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(Buffer.from(value));
                }
              }
              res.end();
              return;
            } catch (err: any) {
              console.error('[Vite Dev] Download stream error:', err);
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Download Error: ' + err.message);
              return;
            }
          }

          // ===================================================================
          // 2. [로컬] 파일 목록 조회
          // ===================================================================
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');

          let items: any[] = [];
          let source = 'unknown';

          // 구글 직통 임베드 수집
          try {
            const targetUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
            const gRes = await fetch(targetUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            if (gRes.ok) {
              const html = await gRes.text();
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
          } catch (e) {
            console.warn('[Vite Dev] Direct embedded fetch failed:', e);
          }

          res.end(JSON.stringify({
            success: true,
            source,
            folderId,
            itemCount: items.length,
            items
          }));
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), localDriveApiPlugin()],
  base: './',
  build: {
    target: ['es2015', 'chrome60', 'safari11', 'edge18'],
    cssTarget: 'chrome60'
  }
});
