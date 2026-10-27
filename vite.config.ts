import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// KST 빌드 시간 및 버전 생성 헬퍼
function getBuildInfo() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const buildTime = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
  const version = `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth() + 1)}.${pad(kst.getUTCDate())}.${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}`;
  return { version, buildTime, timestamp: now.getTime() };
}

const sharedBuildInfo = getBuildInfo();

function autoVersionPlugin(): Plugin {
  return {
    name: 'auto-version-plugin',
    buildStart() {
      const versionFile = path.resolve(__dirname, 'public/version.json');
      fs.writeFileSync(versionFile, JSON.stringify(sharedBuildInfo, null, 2));
      console.log(`[Vite AutoVersion] 새 앱 버전 생성 완료: ${sharedBuildInfo.version} (${sharedBuildInfo.buildTime})`);
    }
  };
}

const DEFAULT_API_KEY = 'AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw';

// 로컬 개발 환경용 Vercel API 모의 미들웨어 플러그인 (다운로드 완전 바이트 스트리밍 포함)
function localDriveApiPlugin(): Plugin {
  return {
    name: 'local-drive-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/notes')) {
          const urlObj = new URL(req.url, 'http://localhost:5173');
          const lessonId = urlObj.searchParams.get('lessonId');
          const g = globalThis as any;
          if (!g.__DEV_NOTES__) g.__DEV_NOTES__ = new Map();
          if (!g.__DEV_PRESENCES__) g.__DEV_PRESENCES__ = new Map();

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');

          if (req.method === 'GET') {
            const notesMap = lessonId ? g.__DEV_NOTES__.get(lessonId) : null;
            const notes = notesMap ? Array.from(notesMap.values()) : [];
            const presencesMap = lessonId ? g.__DEV_PRESENCES__.get(lessonId) : null;
            const presences = presencesMap ? Array.from(presencesMap.values()) : [];
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, lessonId, notes, presences }));
            return;
          }

          if (req.method === 'POST') {
            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', () => {
              try {
                const body = JSON.parse(bodyStr || '{}');
                const targetLessonId = body.lessonId;
                if (body.action === 'submit' && body.record) {
                  if (!g.__DEV_NOTES__.has(targetLessonId)) g.__DEV_NOTES__.set(targetLessonId, new Map());
                  const rec = body.record;
                  const key = `${rec.student_grade}_${rec.student_class}_${rec.student_num}`;
                  g.__DEV_NOTES__.get(targetLessonId).set(key, rec);
                } else if (body.action === 'reset') {
                  g.__DEV_NOTES__.delete(targetLessonId);
                  g.__DEV_PRESENCES__.delete(targetLessonId);
                } else if (body.action === 'kick' && body.targetStudentKey) {
                  g.__DEV_NOTES__.get(targetLessonId)?.delete(body.targetStudentKey);
                  g.__DEV_PRESENCES__.get(targetLessonId)?.delete(body.targetStudentKey);
                }
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
              } catch (e: any) {
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
            return;
          }
          return;
        }

        if (req.url && req.url.startsWith('/api/drive')) {
          const urlObj = new URL(req.url, 'http://localhost:5173');
          const action = urlObj.searchParams.get('action') || 'list';
          const fileId = urlObj.searchParams.get('fileId') || urlObj.searchParams.get('id');
          const fileName = urlObj.searchParams.get('fileName') || '수업자료.pdf';
          const folderId = urlObj.searchParams.get('folderId') || urlObj.searchParams.get('id') || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
          const apiKey = urlObj.searchParams.get('apiKey') || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY || DEFAULT_API_KEY;

          // ===================================================================
          // 0. [로컬] POST 요청 (업로드, 새 폴더, 이름 변경, 삭제 중계 프록시)
          // ===================================================================
          if (req.method === 'POST') {
            try {
              let bodyStr = '';
              req.on('data', chunk => { bodyStr += chunk; });
              req.on('end', async () => {
                try {
                  const body = JSON.parse(bodyStr || '{}');
                  const targetGasUrl = body.gasUrl || process.env.VITE_GAS_UPLOAD_URL || 'https://script.google.com/macros/s/AKfycbx_J2hdpXKy8iKFu8cxof4aKGYdhFO4ea93_E3a3KTeTNRbHMaaV4Fo7IkjbeDGUkli/exec';
                  
                  const gasRes = await fetch(targetGasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(body)
                  });
                  const json = await gasRes.json();
                  res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                  });
                  res.end(JSON.stringify(json));
                } catch (subErr: any) {
                  res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ success: false, error: subErr.message || 'GAS 프록시 요청 실패' }));
                }
              });
              return;
            } catch (postErr: any) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: false, error: postErr.message }));
              return;
            }
          }

          // ===================================================================
          // 1. [로컬] 다운로드 완전 바이트 스트리밍
          // ===================================================================
          if (action === 'download' && fileId) {
            try {
              const pageUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
              const checkRes = await fetch(pageUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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
          // 2. [로컬] 파일 목록 조회 (공식 Google Drive API v3 사용)
          // ===================================================================
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

          let items: any[] = [];
          let source = 'unknown';

          if (apiKey) {
            try {
              const gApiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${apiKey}`;
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
                      downloadUrl: `/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`
                    };
                  });
                  source = 'google_official_api_v3';
                }
              }
            } catch (e) {
              console.warn('[Vite Dev] Google API v3 failed:', e);
            }
          }

          // 비상시 안전 폴백 (임베드 뷰어)
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
                    downloadUrl: `/api/drive?action=download&fileId=${id}&fileName=${encodeURIComponent(name)}`
                  });
                }
                source = 'google_direct_embedded_fallback';
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
  plugins: [react(), localDriveApiPlugin(), autoVersionPlugin()],
  base: './',
  define: {
    __APP_BUILD_INFO__: JSON.stringify(sharedBuildInfo)
  },
  build: {
    target: ['es2015', 'chrome60', 'safari11', 'edge18'],
    cssTarget: 'chrome60',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/jspdf')) return 'vendor-jspdf';
          if (id.includes('node_modules/pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('node_modules/fabric')) return 'vendor-fabric';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
        }
      }
    }
  }
});
