@echo off
chcp 65001 > nul
echo ============================================================
echo   🏫 스마트 전자칠판 드라이브 웹앱 로컬 서버를 실행합니다...
echo ============================================================
echo.
echo   접속 주소:
echo   - 내 컴퓨터 접속: http://localhost:5173/
echo.

start "" "http://localhost:5173/"
npm run dev
pause
