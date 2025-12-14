@echo off
REM Script to configure Claude Code to use local MCP server
REM Run this script to add the mcmodding-mcp server to Claude Code

SET CONFIG_PATH=%APPDATA%\Claude\claude_desktop_config.json
SET PROJECT_PATH=%~dp0

echo Configuring Claude Code to use mcmodding-mcp...
echo.
echo Config file location: %CONFIG_PATH%
echo Project path: %PROJECT_PATH%
echo.

REM Check if config file exists
if not exist "%CONFIG_PATH%" (
    echo Creating new config file...
    echo { "mcpServers": {} } > "%CONFIG_PATH%"
)

echo.
echo Please manually add this to your Claude Code config at:
echo %CONFIG_PATH%
echo.
echo Add this configuration:
echo {
echo   "mcpServers": {
echo     "mcmodding-local": {
echo       "command": "node",
echo       "args": ["%PROJECT_PATH%dist\\index.js"]
echo     }
echo   }
echo }
echo.
echo After updating the config, restart Claude Code.
echo.

REM Open the config file in notepad
echo Opening config file in notepad...
start notepad "%CONFIG_PATH%"

echo.
echo IMPORTANT: Make sure you have built the project first!
echo Run: npm run build
echo.
pause
