#!/bin/bash

echo ""
echo "========================================"
echo "       MRA 360 - Cabine 360"
echo "========================================"
echo ""

# Verificar Node.js
if ! command -v node &> /dev/null; then
    echo "[ERRO] Node.js não encontrado! Instale em https://nodejs.org"
    exit 1
fi

# Verificar FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "[AVISO] FFmpeg não encontrado! O processamento de vídeo não vai funcionar."
    echo "        Instale com: sudo apt install ffmpeg"
    echo ""
fi

# Instalar dependências
if [ ! -d "node_modules" ]; then
    echo "Instalando dependências..."
    npm install
    echo ""
fi

# Criar .env se necessário
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo "Criando arquivo .env a partir do .env.example..."
    cp .env.example .env
    echo "[AVISO] Configure o arquivo .env com suas credenciais!"
    echo ""
fi

# Criar diretórios
mkdir -p uploads/music uploads/frames uploads/videos output config

echo "Iniciando servidor de desenvolvimento..."
echo ""
echo "Acesse: http://localhost:3000"
echo "Para parar: Ctrl+C"
echo ""

npm run dev
