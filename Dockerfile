FROM node:20-slim

# Instalar FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Diretório de trabalho
WORKDIR /app

# Copiar package files e instalar dependências
COPY package*.json ./
RUN npm install --omit=dev

# Copiar código da aplicação
COPY . .

# Criar diretórios necessários
RUN mkdir -p uploads/videos uploads/music uploads/frames output config

# Expor porta
EXPOSE 3000

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000

# Iniciar
CMD ["node", "server.js"]
