@echo off
setlocal enabledelayedexpansion

REM ===========================================================================
REM  demo.cmd - run the Recovery Agent demo from Windows CMD.
REM
REM  Double-click it, or:  demo.cmd
REM
REM  WHY chcp 65001 IS THE FIRST LINE THAT MATTERS
REM  Every money figure in this project is in rupees. CMD starts on code page
REM  437 (or 850), neither of which contains the rupee sign, so the output
REM  renders as garbage - on camera, during the demo. Switching the console to
REM  UTF-8 first is the difference between Rs.2,32,868 and mojibake.
REM
REM  If the symbols still look wrong after this, the console FONT is the cause,
REM  not the code page: right-click the title bar - Properties - Font - pick
REM  Consolas or Cascadia Mono. The default raster font has no rupee glyph.
REM ===========================================================================

chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Recovery Agent - demo

:check
cls
echo.
echo   RECOVERY AGENT  -  Razorpay AI Buildathon, Track 03
echo   ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not on your PATH.
  echo.
  echo   Install Node 20 or newer from https://nodejs.org
  echo   then close this window and run demo.cmd again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if !NODEMAJOR! LSS 20 (
  echo   Node !NODEMAJOR! found. This project needs Node 20 or newer
  echo   ^(it uses --env-file and modern ESM^).
  echo.
  echo   Update from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   First run - installing dependencies. This takes a minute.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  cls
)

:menu
cls
echo.
echo   RECOVERY AGENT  -  Razorpay AI Buildathon, Track 03
echo   ============================================================
echo   Node !NODEMAJOR!  .  no API keys needed for anything below
echo.
echo     [1]  Pre-flight check        18/18 - run this BEFORE recording
echo.
echo     [2]  THE SUBMISSION          clips 1, 2, 3, 5, 6
echo     [3]  Calibration             clip 4
echo     [4]  Tests  ^(42 properties^)  clip 7
echo.
echo     [5]  Start the server        console + meeting room on :8787
echo     [6]  Everything, in order    full verification pass
echo.
echo     [7]  Live Razorpay call      needs test keys in .env
echo.
echo     [Q]  Quit
echo.
set "PICK="
set /p "PICK=  Choose: "

if /i "!PICK!"=="1" goto preflight
if /i "!PICK!"=="2" goto recover
if /i "!PICK!"=="3" goto calib
if /i "!PICK!"=="4" goto tests
if /i "!PICK!"=="5" goto server
if /i "!PICK!"=="6" goto everything
if /i "!PICK!"=="7" goto live
if /i "!PICK!"=="q" exit /b 0
goto menu

:preflight
cls
echo.
echo   PRE-FLIGHT - the whole runbook with every env var deleted.
echo   Expect 18/18. If anything fails, do not record.
echo.
call node tools\demo-check.mjs
echo.
pause
goto menu

:recover
cls
call node razorpay\recover.mjs
echo.
echo   ------------------------------------------------------------
echo   Scroll UP to the MEASURE table before you start recording.
echo   Nobody should watch it compute.
echo.
pause
goto menu

:calib
cls
call node razorpay\calibration.mjs
echo.
pause
goto menu

:tests
cls
echo.
echo   42 safety properties - 25 on the action ledger, 17 on the pacer.
echo.
call node razorpay\policy.test.mjs
call node razorpay\pacer.test.mjs
echo.
pause
goto menu

:server
cls
echo.
echo   Starting on http://localhost:8787
echo     console  http://localhost:8787/
echo     meeting  http://localhost:8787/meeting
echo     web mcp  http://localhost:8787/mcp
echo.
echo   Press Ctrl+C to stop and come back to this menu.
echo   If port 8787 is busy the server will say so and tell you what to do.
echo.
call node server\mcp.mjs
echo.
pause
goto menu

:everything
cls
echo.
echo   FULL VERIFICATION - every gate, in order.
echo.
echo   --- 1/6  dependency graph -----------------------------------
call node tools\graph.mjs check
echo   --- 2/6  encoding -------------------------------------------
call node tools\encoding-sweep.mjs
echo   --- 3/6  safety properties ----------------------------------
call node razorpay\policy.test.mjs
call node razorpay\pacer.test.mjs
echo   --- 4/6  the incrementality thesis --------------------------
call node razorpay\bench.mjs
echo   --- 5/6  calibration ----------------------------------------
call node razorpay\calibration.mjs
echo   --- 6/6  the submission -------------------------------------
call node razorpay\recover.mjs
echo.
echo   ============================================================
echo   If every section above is clean, you are ready to record.
echo.
pause
goto menu

:live
cls
echo.
if not exist ".env" (
  echo   No .env file found.
  echo.
  echo   Copy .env.example to .env and put test keys in it:
  echo     dashboard.razorpay.com  -  Settings  -  API Keys  -  Generate Test Key
  echo.
  echo   Both halves are shown ONCE. Copy the secret immediately.
  echo   Everything else in this menu works without any of this.
  echo.
  pause
  goto menu
)
echo   Calling api.razorpay.com. If the keys do not authenticate it aborts
echo   cleanly and tells you why - it will not half-send anything.
echo.
call node --env-file=.env razorpay\recover.mjs --live
echo.
echo   ------------------------------------------------------------
echo   Only claim live payment links if you saw three OK lines above.
echo.
pause
goto menu
