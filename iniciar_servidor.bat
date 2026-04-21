@echo off
title MRA 360 - Cabine 360
color 0D

echo.
echo ========================================
echo        MRA 360 - Cabine 360
echo ========================================
echo.

:: Verificar se Node.js esta no PATH do sistema
node --version >nul 2>&1
if %errorlevel% equ 0 goto :node_ok

:: Tentar caminhos comuns caso nao esteja no PATH
if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
    goto :node_ok
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
    goto :node_ok
)
if exist "%APPDATA%\nvm\nodejs\node.exe" (
    set "PATH=%APPDATA%\nvm\nodejs;%PATH%"
    goto :node_ok
)

echo [ERRO] Node.js nao encontrado no PATH.
echo       Feche este terminal, abra um novo e tente novamente.
echo       Se o problema persistir, instale em https://nodejs.org
pause
exit /b 1

:node_ok
echo [OK] Node.js encontrado:
node --version
echo.

:: Verificar FFmpeg
ffmpeg -version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] FFmpeg encontrado.
) else (
    echo [AVISO] FFmpeg nao encontrado. Processamento de video pode falhar.
    echo         Instale com: winget install Gyan.FFmpeg
)
echo.

:: Instalar dependencias se necessario
if not exist "node_modules" (
    echo Instalando dependencias npm...
    call npm install
    echo.
)

:: Criar .env se nao existir
if not exist ".env" (
    if exist ".env.example" (
        echo Criando arquivo .env...
        copy .env.example .env >nul
        echo [AVISO] Configure o arquivo .env com suas credenciais!
        echo.
    )
)

:: Criar diretorios necessarios
if not exist "uploads\music" mkdir uploads\music
if not exist "uploads\frames" mkdir uploads\frames
if not exist "uploads\videos" mkdir uploads\videos
if not exist "output" mkdir output
if not exist "config" mkdir config

echo.
echo Iniciando servidor MRA 360...
echo.
echo  Desktop:  http://localhost:3000
echo  Celular:  Veja o IP na saida do servidor
echo.
echo Para parar: Ctrl+C
echo.

node server.js

pause
