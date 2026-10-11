@echo off
REM ============================================================
REM  Clarity Ledger - install into an Obsidian vault (Windows)
REM
REM  Double-click. It asks where your vault is.
REM  (Tip: you can drag the vault folder onto this file.)
REM
REM  NOTE: file encoding matters. .bat is read as the system ANSI
REM  code page, so a UTF-8 file with Chinese characters turns into
REM  mojibake. Everything here is deliberately ASCII.
REM
REM  This bit me for real. A line said "walk through KKU.md" -
REM  name (shou-ce-qing-dan.md). Valid UTF-8, but NOT valid on
REM  a cp936 console: it printed as garbage and looked like the
REM  script was broken. The rule above was already written down;
REM  I broke it in one edit. scripts/check-bat.mjs fails the build
REM  if a non-ASCII byte ever appears here again.
REM
REM  SECOND trap, same file: line endings MUST be CRLF.
REM  cmd.exe splits commands on CRLF. With bare LF it mis-splices
REM  adjacent lines and prints dozens of nonsense errors like
REM    'larity' is not recognized as an internal or external command
REM  (that is "REM  Clarity" chopped mid-token) - while the script
REM  text is perfectly correct.
REM  Enforced by .gitattributes: *.bat text eol=crlf
REM ============================================================
setlocal

echo.
echo   Clarity Ledger - Obsidian plugin installer
echo   ------------------------------------------
echo.

REM /D lets you drop a folder onto the bat file
set "VAULT=%~1"
if "%VAULT%"=="" set /p "VAULT=   Vault folder (the one containing .obsidian): "

if "%VAULT%"=="" (
  echo   Nothing entered. Quit.
  pause
  exit /b 1
)

REM strip a trailing backslash so paths concatenate cleanly
if "%VAULT:~-1%"=="\" set "VAULT=%VAULT:~0,-1%"

set "TARGET=%VAULT%\.obsidian\plugins\clarity-ledger"
set "SRC=%~dp0"

if not exist "%VAULT%\.obsidian" (
  echo.
  echo   [X] No .obsidian folder under: %VAULT%
  echo       That does not look like a vault root.
  echo.
  pause
  exit /b 1
)

REM ---------- build first ----------
REM The three artifact files are gitignored, so a fresh clone has none
REM of them. Copying stale artifacts is the worst outcome here: the
REM plugin would load an old build and the user would blame the new
REM source for a bug that was already fixed.
if not exist "%SRC%node_modules" (
  echo.
  echo   [!] node_modules is missing. Running npm install first...
  echo.
  pushd "%SRC%"
  call npm install
  if errorlevel 1 (
    popd
    echo   [X] npm install failed.
    pause
    exit /b 1
  )
  popd
)

echo.
echo   Building (css + typecheck + bundle + self-check)...
  pushd "%SRC%"
  call npm run build
  if errorlevel 1 (
    popd
    echo.
    echo   [X] Build failed. Not installing.
    echo       The self-check in build catches broken artifacts early -
    echo       better to stop here than to push a bad build into the vault.
    echo.
    pause
    exit /b 1
  )
  popd

echo.
echo   Target: %TARGET%
echo.

if not exist "%TARGET%" mkdir "%TARGET%"

REM /Y overwrite. Obsidian may have the files locked while running;
REM the copy error below will say so and tell the user to close it.
copy /Y "%SRC%manifest.json" "%TARGET%\" >nul
copy /Y "%SRC%main.js"       "%TARGET%\" >nul
copy /Y "%SRC%styles.css"    "%TARGET%\" >nul

if errorlevel 1 (
  echo   [X] Copy failed.
  echo       If Obsidian is running, close it and run this again -
  echo       it holds a lock on those files.
  echo.
  pause
  exit /b 1
)

echo   [OK] Copied 3 files.
echo.
echo   Next:
echo     1. Restart Obsidian ^(or press Ctrl+R after Ctrl+Shift+I^)
echo     2. Settings -^> Community plugins -^> turn OFF Safe mode
echo     3. Enable "Clarity Ledger"
echo     4. Click the calendar-check icon on the left ribbon
echo.
echo   Then walk through the manual test checklist in the repo root
echo   ^(sections 3 and 6: external edits to the .md file, and moving
echo   the storage folder^) - those only apply to a real vault install.
echo.
pause
endlocal
