@echo off
chcp 65001 > NUL
title Image Comparison Service Starter

REM --- 配置区域 ---
SET PYTHON_EXECUTABLE=python
SET BACKEND_SCRIPT=app.py
SET BACKEND_PORT=5000
SET FRONTEND_PORT=5500
SET FRONTEND_URL=http://127.0.0.1:%FRONTEND_PORT%/index.html
REM --------------------

echo.
echo =======================================================
echo     一键启动相似图片对比工具 (双服务模式)
echo =======================================================
echo.

REM 1. 检查 Python 环境
%PYTHON_EXECUTABLE% --version > NUL 2>&1
if errorlevel 1 (
    echo [错误] 找不到 Python 可执行文件。
    echo 请确保 Python 已安装，并且已添加到系统的环境变量 PATH 中。
    pause
    goto :eof
)

REM 2. 启动 Flask 后端 (在新窗口中启动，避免阻塞)
echo [启动] 正在启动 Flask 后端服务 (端口: %BACKEND_PORT%) ...
start "Backend Service (Port %BACKEND_PORT%)" cmd /k "%PYTHON_EXECUTABLE% %BACKEND_SCRIPT%"

REM 3. 启动简易 HTTP 前端服务器 (在新窗口中启动，避免阻塞)
echo [启动] 正在启动简易 HTTP 前端服务 (端口: %FRONTEND_PORT%) ...
start "Frontend Server (Port %FRONTEND_PORT%)" cmd /k "%PYTHON_EXECUTABLE% -m http.server %FRONTEND_PORT%"

REM 等待几秒，确保两个服务都启动
timeout /t 5 /nobreak > NUL

REM 4. 启动前端页面
echo [启动] 正在浏览器中打开前端页面 (%FRONTEND_URL%) ...
start %FRONTEND_URL%

echo.
echo =======================================================
echo     启动完成！请保持两个新窗口运行。
echo =======================================================
echo.

pause