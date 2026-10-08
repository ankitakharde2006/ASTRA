@echo off
title Course Recap - localhost:3000
cd /d "%~dp0"
node site/server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
