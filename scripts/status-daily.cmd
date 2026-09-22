@echo off
rem Daily judging-week check of the Pangu devnet demo. Appends one run to logs\status.log
rem and rewrites logs\status-latest.txt so a glance shows the last result.
cd /d D:\Projects\Meteora\packages\scripts
set LOG=D:\Projects\Meteora\logs\status.log
echo ==== %DATE% %TIME% ==== >> "%LOG%"
call npm run --silent status > "D:\Projects\Meteora\logs\status-latest.txt" 2>&1
set RC=%ERRORLEVEL%
type "D:\Projects\Meteora\logs\status-latest.txt" >> "%LOG%"
echo exit %RC% >> "%LOG%"
if not "%RC%"=="0" echo FAILED %DATE% %TIME% > "D:\Projects\Meteora\logs\STATUS-FAILED.txt"
if "%RC%"=="0" del "D:\Projects\Meteora\logs\STATUS-FAILED.txt" 2>nul
exit /b %RC%
