/**
 * MRA 360 — Video Recorder
 * Controla acesso à câmera e gravação via MediaRecorder API.
 */
class VideoRecorder {
    constructor() {
        this.previewVideo = document.getElementById('camera-preview');
        this.recordingVideo = document.getElementById('recording-video');
        this.timerText = document.getElementById('timer-text');
        this.timerProgress = document.getElementById('timer-progress');

        this.stream = null;
        this.mediaRecorder = null;
        this.chunks = [];
        this.isRecording = false;
        this.timerInterval = null;
        this.remainingTime = 0;
        this.totalTime = 0;

        // Circunferência do timer SVG (r=45, C=2πr≈283)
        this.circumference = 2 * Math.PI * 45;
        this.timerProgress.style.strokeDasharray = this.circumference;
    }

    /**
     * Retorna a lista de dispositivos de vídeo.
     * @returns {Promise<MediaDeviceInfo[]>}
     */
    async getCameras() {
        try {
            // Pedir permissão primeiro (sem ela os labels vêm vazios). O stream é
            // fechado em seguida: no celular só uma câmera pode ficar aberta, e um
            // stream esquecido aqui deixa a câmera da gravação preta/travada.
            if (!this.stream) {
                const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                permissionStream.getTracks().forEach(t => t.stop());
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'videoinput');
        } catch (err) {
            console.warn('[Recorder] Não foi possível listar câmeras:', err);
            return [];
        }
    }

    /**
     * Inicializa a câmera usando um deviceId específico ou a traseira por padrão.
     * 
     * IMPORTANTE: Sensores de câmera no Android SEMPRE capturam em landscape.
     * Pedir width:1080, height:1920 confunde o browser e causa crop/zoom.
     * Devemos pedir width >= height (landscape) e deixar o CSS rotacionar.
     * 
     * @param {string} [deviceId] ID do dispositivo, 'environment' (traseira) ou 'user' (frontal).
     *                            Vazio = traseira.
     */
    async initCamera(deviceId) {
        // Se já tiver stream, desliga e dá um tempo para o Android liberar a câmera
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Pedir resolução máxima sem forçar orientação (o sensor é landscape;
        // pedir 1080x1920 confunde o browser e causa crop/zoom)
        const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };

        // Valores especiais do seletor: 'environment' (traseira) e 'user' (frontal)
        const facing = (deviceId === 'user' || deviceId === 'environment') ? deviceId : null;
        const specificId = (!deviceId || facing) ? null : deviceId;
        const wantFacing = facing || 'environment';

        // Tentativas em ordem; se uma falhar, tenta a próxima
        const attempts = [];
        if (specificId) {
            attempts.push({ deviceId: { exact: specificId }, ...size });
            attempts.push({ deviceId: { exact: specificId } });
        }
        attempts.push({ facingMode: { exact: wantFacing }, ...size });
        attempts.push({ facingMode: { exact: wantFacing } });
        attempts.push({ facingMode: wantFacing });
        attempts.push(true);

        for (const video of attempts) {
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });

                // Logar a câmera/resolução real obtida
                const track = this.stream.getVideoTracks()[0];
                const settings = track.getSettings();
                console.log(`[Recorder] Câmera ativa: ${track.label}`);
                console.log(`[Recorder] Resolução real: ${settings.width}x${settings.height}`);
                console.log(`[Recorder] FacingMode: ${settings.facingMode || 'desconhecido'}`);

                this.previewVideo.srcObject = this.stream;
                await this.previewVideo.play().catch(() => {});

                // Esconder placeholder
                const placeholder = document.getElementById('camera-placeholder');
                if (placeholder) placeholder.classList.add('hidden');

                return true;
            } catch (err) {
                console.warn('[Recorder] Falha ao abrir câmera com', JSON.stringify(video), '-', err.name, err.message);
                this.lastError = err;
            }
        }

        console.error('[Recorder] Nenhuma câmera pôde ser aberta:', this.lastError);
        return false;
    }

    /**
     * true se a câmera está aberta e entregando imagem.
     */
    isStreamLive() {
        if (!this.stream) return false;
        const track = this.stream.getVideoTracks()[0];
        return !!track && track.readyState === 'live' && track.enabled;
    }

    /**
     * Extensão de arquivo correspondente ao formato gravado.
     */
    getFileExtension() {
        const type = (this.mediaRecorder && this.mediaRecorder.mimeType) || '';
        return type.includes('mp4') ? 'mp4' : 'webm';
    }

    /**
     * Inicia a gravação por `durationSeconds` segundos.
     * @param {number} durationSeconds
     * @returns {Promise<Blob>} Blob do vídeo gravado
     */
    startRecording(durationSeconds) {
        return new Promise((resolve, reject) => {
            if (!this.isStreamLive()) {
                reject(new Error('Câmera não inicializada.'));
                return;
            }

            this.chunks = [];
            this.totalTime = durationSeconds;
            this.remainingTime = durationSeconds;

            // Configurar vídeo de gravação (full screen)
            this.recordingVideo.srcObject = this.stream;
            this.recordingVideo.play();

            // Escolher melhor codec disponível
            let mimeType = 'video/webm;codecs=vp9';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm;codecs=vp8';
            }
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
            }
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/mp4';
            }

            try {
                this.mediaRecorder = new MediaRecorder(this.stream, {
                    mimeType,
                    videoBitsPerSecond: 8000000 // 8 Mbps para alta qualidade
                });
            } catch (e) {
                this.mediaRecorder = new MediaRecorder(this.stream);
            }

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.isRecording = false;
                clearInterval(this.timerInterval);
                // Usa o formato que o navegador realmente gravou (iPhone grava MP4)
                const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || mimeType });
                console.log(`[Recorder] Gravação concluída. Tamanho: ${(blob.size / 1024 / 1024).toFixed(2)}MB (${blob.type})`);
                if (blob.size < 10 * 1024) {
                    reject(new Error('A câmera não gravou imagem (vídeo vazio). Toque na câmera para reativá-la e grave novamente.'));
                    return;
                }
                resolve(blob);
            };

            this.mediaRecorder.onerror = (e) => {
                this.isRecording = false;
                clearInterval(this.timerInterval);
                reject(e.error || new Error('Erro na gravação'));
            };

            // Iniciar gravação
            this.mediaRecorder.start(1000); // Chunk a cada 1 segundo
            this.isRecording = true;

            // Timer visual
            this.timerText.textContent = durationSeconds;
            this.timerProgress.style.strokeDashoffset = 0;

            this.timerInterval = setInterval(() => {
                this.remainingTime--;
                this.timerText.textContent = Math.max(0, this.remainingTime);

                // Atualizar progresso circular
                const progress = 1 - (this.remainingTime / this.totalTime);
                this.timerProgress.style.strokeDashoffset = this.circumference * progress;

                if (this.remainingTime <= 0) {
                    this.stopRecording();
                }
            }, 1000);
        });
    }

    /**
     * Para a gravação manualmente.
     */
    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    }

    /**
     * Libera os recursos da câmera.
     */
    destroy() {
        this.stopRecording();
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.previewVideo.srcObject = null;
        this.recordingVideo.srcObject = null;
    }
}

// Exportar globalmente
window.VideoRecorder = VideoRecorder;
