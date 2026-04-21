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
            await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // Pedir permissão primeiro
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
     * @param {string} [deviceId] Opcional. ID específico do dispositivo.
     */
    async initCamera(deviceId) {
        try {
            // Se já tiver stream, desliga
            if (this.stream) {
                this.stream.getTracks().forEach(t => t.stop());
                this.stream = null;
            }

            // Construir constraints - SEMPRE em landscape (width > height)
            // O sensor físico é landscape; o browser rotaciona automaticamente.
            let videoConstraints = {};

            if (deviceId) {
                videoConstraints.deviceId = { exact: deviceId };
            } else {
                videoConstraints.facingMode = 'environment';
            }

            // Pedir resolução máxima sem forçar orientação
            // Isso permite que o sensor entregue sua melhor resolução nativa
            videoConstraints.width = { ideal: 1920 };
            videoConstraints.height = { ideal: 1080 };

            this.stream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: false
            });

            // Logar a resolução real obtida
            const track = this.stream.getVideoTracks()[0];
            const settings = track.getSettings();
            console.log(`[Recorder] Câmera ativa: ${track.label}`);
            console.log(`[Recorder] Resolução real: ${settings.width}x${settings.height}`);
            console.log(`[Recorder] FacingMode: ${settings.facingMode || 'desconhecido'}`);

            this.previewVideo.srcObject = this.stream;
            await this.previewVideo.play();

            // Esconder placeholder
            const placeholder = document.getElementById('camera-placeholder');
            if (placeholder) placeholder.classList.add('hidden');

            return true;
        } catch (err) {
            console.error('[Recorder] Erro ao acessar câmera:', err);
            
            // Fallback: pedir qualquer câmera sem constraints rígidas
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({
                    video: deviceId ? { deviceId: { exact: deviceId } } : true,
                    audio: false
                });

                const track = this.stream.getVideoTracks()[0];
                const settings = track.getSettings();
                console.log(`[Recorder] Fallback câmera: ${track.label}`);
                console.log(`[Recorder] Fallback resolução: ${settings.width}x${settings.height}`);

                this.previewVideo.srcObject = this.stream;
                this.previewVideo.style.objectFit = 'cover';
                await this.previewVideo.play();
                
                const placeholder = document.getElementById('camera-placeholder');
                if (placeholder) placeholder.classList.add('hidden');
                
                return true;
            } catch (err2) {
                console.error('[Recorder] Fallback falhou:', err2);
                return false;
            }
        }
    }

    /**
     * Inicia a gravação por `durationSeconds` segundos.
     * @param {number} durationSeconds
     * @returns {Promise<Blob>} Blob do vídeo gravado
     */
    startRecording(durationSeconds) {
        return new Promise((resolve, reject) => {
            if (!this.stream) {
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
                const blob = new Blob(this.chunks, { type: mimeType });
                console.log(`[Recorder] Gravação concluída. Tamanho: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
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
