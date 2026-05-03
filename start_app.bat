@echo off
cd /d "%~dp0"

start "WFM Backend" cmd /k "node --env-file=.env server/server.cjs"

timeout /t 4 /nobreak >nul

start "WFM Frontend" cmd /k "npm run dev"

timeout /t 2 /nobreak >nul

start "" "http://localhost:5173"
