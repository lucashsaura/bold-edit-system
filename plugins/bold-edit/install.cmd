@echo off
rem BOLD EDIT SYSTEM - installer Windows (EXPERIMENTAL). Ver INSTALL.md. Nao instala Node; nao altera PATH.
where node >nul 2>nul || (echo install: Node.js ^>= 20 e pre-requisito & exit /b 5)
node "%~dp0install\installer.mjs" %*
exit /b %ERRORLEVEL%
