const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Processa o vídeo: converte WebM→MP4, aplica moldura (overlay) e música (trecho cortado).
 * Suporta 3 modos: normal, speedramp, boomerang (vira e volta).
 * @param {object} options
 * @param {string} options.videoPath - Caminho do vídeo raw (WebM)
 * @param {string|null} options.framePath - Caminho da moldura PNG (null = sem moldura)
 * @param {string} options.musicPath - Caminho do arquivo de música
 * @param {number} options.musicStart - Tempo de início do trecho (segundos)
 * @param {number} options.musicEnd - Tempo de fim do trecho (segundos)
 * @param {string} options.outputPath - Caminho do arquivo de saída (MP4)
 * @param {string} options.mode - Modo de vídeo: 'normal', 'speedramp', 'boomerang'
 * @param {function} options.onProgress - Callback de progresso (0-100)
 * @returns {Promise<string>} Caminho do arquivo processado
 */
function processVideo({ videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, mode, onProgress }) {
    mode = mode || 'normal';
    console.log(`[FFmpeg] Modo de processamento: ${mode}`);

    if (mode === 'boomerang') {
        return processBoomerang({ videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, onProgress });
    }

    return processNormalOrSpeedRamp({ videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, mode, onProgress });
}

/**
 * Processa os modos Normal e Speed Ramp.
 * Speed Ramp: usa setpts para acelerar gradualmente o vídeo.
 */
function processNormalOrSpeedRamp({ videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, mode, onProgress }) {
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

        if (mode === 'speedramp') {
            // Speed Ramp: acelera gradualmente de 1x até ~3x
            // setpts comprime 15s para ~7s com aceleração gradual
            // A fórmula PTS-STARTPTS cria uma rampa onde o início é lento e o final é rápido
            const speedFilter = "setpts='PTS-STARTPTS, setpts=PTS/(1+2*T/TB/15)'";

            if (framePath) {
                filterStr = [
                    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts='PTS/(1+2*(T/15))'[v_base]`,
                    '[1:v]scale=1080:1920[frame_scaled]',
                    '[v_base][frame_scaled]overlay=0:0:format=auto[v_out]'
                ].join(';');
            } else {
                filterStr = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts='PTS/(1+2*(T/15))'[v_out]`;
            }
        } else {
            // Normal
            if (framePath) {
                filterStr = [
                    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v_base]',
                    '[1:v]scale=1080:1920[frame_scaled]',
                    '[v_base][frame_scaled]overlay=0:0:format=auto[v_out]'
                ].join(';');
            } else {
                filterStr = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v_out]';
            }
        }

        command
            .complexFilter(filterStr)
            .outputOptions([
                '-map', '[v_out]',
                '-map', `${audioInputIndex}:a`,
                // Codec de vídeo - Equilibrado (rápido + sem travamento)
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '21',
                '-r', '30',
                // Codec de áudio - Música continua normal
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ar', '44100',
                // Otimizações para web/celular
                '-movflags', '+faststart',
                '-shortest',
                '-pix_fmt', 'yuv420p',
                '-threads', '0'
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
 * Processa o modo Vira e Volta (Boomerang).
 * Grava 10s, primeira metade acelera gradualmente, segunda metade é o reverso desacelerando.
 * Processo em 2 etapas:
 *   1. Gerar vídeo processado (scale+crop) 
 *   2. Dividir em 2 metades: primeira acelera, segunda reverte + desacelera, concatenar
 */
function processBoomerang({ videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, onProgress }) {
    return new Promise((resolve, reject) => {
        const musicDuration = musicEnd - musicStart;
        const tempDir = path.dirname(outputPath);
        const jobId = path.basename(outputPath, '.mp4');
        const tempBase = path.join(tempDir, `${jobId}_base.mp4`);

        // Etapa 1: Criar vídeo base (scale + crop + moldura) sem áudio
        const step1 = ffmpeg();
        step1.input(videoPath);
        if (framePath) {
            step1.input(framePath);
        }

        let baseFilter;
        if (framePath) {
            baseFilter = [
                '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v_base]',
                '[1:v]scale=1080:1920[frame_scaled]',
                '[v_base][frame_scaled]overlay=0:0:format=auto[v_out]'
            ].join(';');
        } else {
            baseFilter = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v_out]';
        }

        step1
            .complexFilter(baseFilter)
            .outputOptions([
                '-map', '[v_out]',
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '21',
                '-r', '30',
                '-pix_fmt', 'yuv420p',
                '-an',
                '-threads', '0'
            ])
            .output(tempBase)
            .on('start', (cmd) => {
                console.log('[FFmpeg] Etapa 1 (base):', cmd);
            })
            .on('progress', (progress) => {
                const percent = progress.percent || 0;
                if (onProgress) onProgress(Math.round(percent * 0.4)); // 0-40%
            })
            .on('error', (err, stdout, stderr) => {
                console.error('[FFmpeg] Etapa 1 Erro:', err.message);
                if (stderr) console.error('[FFmpeg] stderr:', stderr.split('\n').slice(-10).join('\n'));
                cleanupTemp(tempBase);
                reject(err);
            })
            .on('end', () => {
                console.log('[FFmpeg] Etapa 1 concluída. Iniciando Etapa 2 (boomerang)...');
                if (onProgress) onProgress(40);

                // Etapa 2: Boomerang - primeira metade acelera, segunda metade reverte e desacelera
                const step2 = ffmpeg();
                step2.input(tempBase);
                step2.input(tempBase);
                step2.input(musicPath)
                    .inputOptions([`-ss ${musicStart}`, `-t ${musicDuration}`]);

                // Filtro boomerang:
                // [0:v] = primeira metade com aceleração gradual  
                // [1:v] = segunda metade reversa com desaceleração gradual
                const boomerangFilter = [
                    // Primeira metade: primeiros 5s, acelera gradualmente (1x → 2x)
                    `[0:v]trim=start=0:end=5,setpts='PTS/(1+1*(T/5))',setpts=PTS-STARTPTS[v_first]`,
                    // Segunda metade: pegar os mesmos 5s, reverter, desacelerar (2x → 1x)
                    `[1:v]trim=start=0:end=5,setpts=PTS-STARTPTS,reverse,setpts='PTS/(1+1*((5-T)/5))',setpts=PTS-STARTPTS[v_second]`,
                    // Concatenar as duas partes
                    '[v_first][v_second]concat=n=2:v=1:a=0[v_out]'
                ].join(';');

                step2
                    .complexFilter(boomerangFilter)
                    .outputOptions([
                        '-map', '[v_out]',
                        '-map', '2:a',
                        '-c:v', 'libx264',
                        '-preset', 'veryfast',
                        '-crf', '21',
                        '-r', '30',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        '-ar', '44100',
                        '-movflags', '+faststart',
                        '-shortest',
                        '-pix_fmt', 'yuv420p',
                        '-threads', '0'
                    ])
                    .output(outputPath)
                    .on('start', (cmd) => {
                        console.log('[FFmpeg] Etapa 2 (boomerang):', cmd);
                    })
                    .on('progress', (progress) => {
                        const percent = progress.percent || 0;
                        if (onProgress) onProgress(40 + Math.round(percent * 0.6)); // 40-100%
                    })
                    .on('error', (err, stdout, stderr) => {
                        console.error('[FFmpeg] Etapa 2 Erro:', err.message);
                        if (stderr) console.error('[FFmpeg] stderr:', stderr.split('\n').slice(-10).join('\n'));
                        cleanupTemp(tempBase);
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('[FFmpeg] Boomerang concluído:', outputPath);
                        cleanupTemp(tempBase);
                        resolve(outputPath);
                    })
                    .run();
            })
            .run();
    });
}

function cleanupTemp(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.warn('[FFmpeg] Erro ao limpar temp:', e.message);
    }
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
