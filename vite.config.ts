import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 로컬 개발 환경용 Vercel API 모의 미들웨어 플러그인
function localDriveApiPlugin(): Plugin {
  return {
    name: 'local-drive-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/drive')) {
          const urlObj = new URL(req.url, 'http://localhost:5173');
          const folderId = urlObj.searchParams.get('folderId') || urlObj.searchParams.get('id') || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
          const apiKey = urlObj.searchParams.get('apiKey') || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY;

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');

          let items: any[] = [];
          let source = 'unknown';

          // 1. 구글 공식 API v3 시도 (API 키 존재 시)
          if (apiKey) {
            try {
              const gApiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${apiKey}`;
              const gRes = await fetch(gApiUrl);
              if (gRes.ok) {
                const data: any = await gRes.json();
                if (data.files && Array.isArray(data.files)) {
                  items = data.files.map((file: any) => {
                    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                    const sizeBytes = file.size ? parseInt(file.size, 10) : 0;
                    const sizeStr = sizeBytes > 0 
                      ? sizeBytes > 1024 * 1024 
                        ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` 
                        : `${(sizeBytes / 1024).toFixed(0)} KB` 
                      : '-';

                    return {
                      id: file.id,
                      name: file.name,
                      type: isFolder ? 'folder' : 'document',
                      folderId: isFolder ? file.id : undefined,
                      size: isFolder ? '-' : sizeStr,
                      updatedAt: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ko-KR') : '-',
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
              console.warn('[Vite Dev] Google API v3 failed:', e);
            }
          }

          // 2. 구글 직통 임베드 뷰어 수집 (API 키 미설정 시 안전 폴백)
          if (items.length === 0) {
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
                    downloadUrl: isFolder 
                      ? `https://drive.google.com/drive/folders/${id}?usp=sharing` 
                      : `https://drive.google.com/uc?export=download&confirm=t&id=${id}`
                  });
                }
                source = 'google_direct_embedded';
              }
            } catch (e) {
              console.warn('[Vite Dev] Direct embedded fetch failed:', e);
            }
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
    // 전자칠판 내장 브라우저(구형 안드로이드 WebView/Chrome) 호환성 설정
    target: ['es2015', 'chrome60', 'safari11', 'edge18'],
    cssTarget: 'chrome60'
  }
});
