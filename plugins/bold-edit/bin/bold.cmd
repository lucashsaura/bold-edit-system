@echo off
rem BOLD EDIT SYSTEM - shim Windows da CLI (EXPERIMENTAL).
rem Node: BOLD_NODE_PATH > toolchain gerenciado (%LOCALAPPDATA%\bold\toolchain\node.path, R12) > node do PATH.
setlocal
if defined BOLD_NODE_PATH (set "BOLD_N=%BOLD_NODE_PATH%" & goto run)
if defined BOLD_TOOLCHAIN_DIR (set "BOLD_T=%BOLD_TOOLCHAIN_DIR%") else (set "BOLD_T=%LOCALAPPDATA%\bold\toolchain")
set "BOLD_N="
if exist "%BOLD_T%\node.path" set /p BOLD_N=<"%BOLD_T%\node.path"
if defined BOLD_N if not exist "%BOLD_N%" set "BOLD_N="
if not defined BOLD_N set "BOLD_N=node"
:run
"%BOLD_N%" "%~dp0bold.mjs" %*
exit /b %ERRORLEVEL%
