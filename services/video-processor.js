const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Processa o vídeo: converte WebM→MP4, aplica moldura (overlay) e música (trecho cortado).
 * @param {object} options
 * @param {string} options.videoPath - Caminho do vídeo raw (WebM)
 * @param {string|null} options.framePath - Caminho da moldura PNG (null = sem moldura)
 * @param {string} options.musicPath - Caminho do arquivo de música
 * @param {number} options.musicStart - Tempo de início do trecho (segundos)
 * @param {number} options.musicEnd - Tempo de fim do trecho (segundos)
 * @param {string} options.outputPath - Caminho do arquivo de saída (MP4)
 * @param {function} options.onProgress - Callback de progresso (0-100)
 * @returns {Promise<string>} Caminho do arquivo processado
 */
function processVideo({ videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, onProgress }) {
    return new Promise((resolve, reject) => {
        const musicDuration = musicEnd - musicStart;

        const command = ffmpeg();

        // Input 0: vídeo raw
        command.input(videoPath);

        // Input 1: moldura (se existir)
        if (framePath) {
            command.input(framePath);
        }

        // Input para música (index varia se tem moldura ou não)
        command.input(musicPath)
            .inputOptions([`-ss ${musicStart}`, `-t ${musicDuration}`]);

        // Construir filtro complexo
        const audioInputIndex = framePath ? 2 : 1;
        let filterStr;

        if (framePath) {
            // Com moldura:
            // Usar scale com force_original_aspect_ratio=increase e crop=1080:1920
            // Isso simula o "object-fit: cover", garantindo preenchimento total vertical SEM bordas pretas
            filterStr = [
                '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v_base]',
                '[1:v]scale=1080:1920[frame_scaled]',
                '[v_base][frame_scaled]overlay=0:0:format=auto[v_out]'
            ].join(';');
        } else {
            // Sem moldura
            filterStr = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v_out]';
        }

        command
            .complexFilter(filterStr)
            .outputOptions([
                '-map', '[v_out]',
                '-map', `${audioInputIndex}:a`,
                // Codec de vídeo - Equilibrado (rápido + sem travamento)
                '-c:v', 'libx264',
                '-preset', 'veryfast',      // Rápido mas sem causar travamento
                '-crf', '21',               // Boa qualidade para celular
                '-r', '30',                 // Forçar 30fps constante (corrige VFR do navegador)
                // Codec de áudio
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ar', '44100',
                // Otimizações para web/celular
                '-movflags', '+faststart',
                '-shortest',
                '-pix_fmt', 'yuv420p',
                '-threads', '0'             // Auto-detect: usa todos os cores disponíveis
            ])
            .output(outputPath)
            .on('start', (cmd) => {
                console.log('[FFmpeg] Comando:', cmd);
            })
            .on('progress', (progress) => {
                const percent = progress.percent || 0;
                if (onProgress) onProgress(Math.round(percent));
            })
            .on('error', (err, stdout, stderr) => {
                console.error('[FFmpeg] Erro:', err.message);
                if (stderr) console.error('[FFmpeg] stderr (últimas linhas):', stderr.split('\n').slice(-10).join('\n'));
                reject(err);
            })
            .on('end', () => {
                console.log('[FFmpeg] Processamento concluído:', outputPath);
                resolve(outputPath);
            })
            .run();
    });
}

/**
 * Obtém a duração de um arquivo de áudio/vídeo em segundos.
 * @param {string} filePath 
 * @returns {Promise<number>}
 */
function getMediaDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

module.exports = { processVideo, getMediaDuration };
