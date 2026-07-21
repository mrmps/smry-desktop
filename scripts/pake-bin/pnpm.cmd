@echo off
bun "%~dp0pnpm-shim.ts" %*
exit /b %ERRORLEVEL%
