/**
 * MRA 360 — Music Selector com Waveform
 * Renderiza waveform visual com controles de início/fim touch-friendly.
 * A janela de seleção tem SEMPRE a duração fixa do tempo de gravação.
 * O operador pode arrastar para frente/trás mas não pode mudar o tamanho.
 */
class MusicSelector {
    constructor() {
        this.canvas = document.getElementById('waveform-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById('waveform-container');
        this.selectionEl = document.getElementById('waveform-selection');
        this.handleStartEl = document.getElementById('handle-start');
        this.handleEndEl = document.getElementById('handle-end');
        this.timeStartEl = document.getElementById('time-start');
        this.timeEndEl = document.getElementById('time-end');
        this.durationLabel = document.getElementById('music-duration-label');
        this.btnPreview = document.getElementById('btn-preview-music');
        this.selectEl = document.getElementById('music-select');

        this.audioContext = null;
        this.audioBuffer = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.duration = 0;
        this.startPercent = 0;
        this.endPercent = 1;
        this.selectedMusicId = null;
        this.selectedMusicUrl = null;
        this.rawAudioData = null;

        this.isDragging = null; // 'start' | 'end' | 'selection' | null
        this.canvasRect = null;
        this.dragOffset = 0; // offset do mouse em relação ao handle durante drag

        this._initEvents();
    }

    /**
     * Retorna a duração fixa da seleção como porcentagem da música total.
     */
    _getFixedGap() {
        const videoDuration = window.appState ? window.appState.recordingTime : 15;
        if (this.duration <= 0) return 1;
        return Math.min(videoDuration / this.duration, 1);
    }

    _initEvents() {
        // Music selection change
        this.selectEl.addEventListener('change', (e) => {
            const option = e.target.selectedOptions[0];
            if (option && option.value) {
                this.selectedMusicId = option.value;
                this.selectedMusicUrl = option.dataset.url;
                this.loadAudio(option.dataset.url);
            } else {
                this.selectedMusicId = null;
                this.selectedMusicUrl = null;
                this.container.classList.add('hidden');
                this._notifyChange();
            }
        });

        // Preview button
        this.btnPreview.addEventListener('click', () => {
            if (this.isPlaying) {
                this.stopPreview();
            } else {
                this.playPreview();
            }
        });

        // Drag handles - mouse (ambos os handles movem a seleção inteira)
        this.handleStartEl.addEventListener('mousedown', (e) => { e.preventDefault(); this._startDrag('selection', e); });
        this.handleEndEl.addEventListener('mousedown', (e) => { e.preventDefault(); this._startDrag('selection', e); });
        this.selectionEl.addEventListener('mousedown', (e) => { e.preventDefault(); this._startDrag('selection', e); });
        document.addEventListener('mousemove', (e) => this._onDrag(e));
        document.addEventListener('mouseup', () => this._stopDrag());

        // Drag handles - touch (ambos os handles movem a seleção inteira)
        this.handleStartEl.addEventListener('touchstart', (e) => { e.preventDefault(); this._startDrag('selection', e); }, { passive: false });
        this.handleEndEl.addEventListener('touchstart', (e) => { e.preventDefault(); this._startDrag('selection', e); }, { passive: false });
        this.selectionEl.addEventListener('touchstart', (e) => { e.preventDefault(); this._startDrag('selection', e); }, { passive: false });
        document.addEventListener('touchmove', (e) => this._onDrag(e), { passive: false });
        document.addEventListener('touchend', () => this._stopDrag());

        // Canvas click - mover seleção para o ponto clicado
        this.canvas.addEventListener('click', (e) => {
            if (this.isDragging) return;
            this.canvasRect = this.canvas.getBoundingClientRect();
            const clientX = e.clientX;
            let clickPercent = (clientX - this.canvasRect.left) / this.canvasRect.width;
            clickPercent = Math.max(0, Math.min(1, clickPercent));

            const gap = this._getFixedGap();
            // Centralizar a seleção no ponto clicado
            let newStart = clickPercent - gap / 2;
            newStart = Math.max(0, Math.min(1 - gap, newStart));
            this.startPercent = newStart;
            this.endPercent = newStart + gap;

            this._drawWaveform();
            this._updateHandles();
            this._notifyChange();
        });

        // Canvas resize on window resize
        window.addEventListener('resize', () => {
            if (this.rawAudioData) {
                this._setupCanvas();
                this._drawWaveform();
            }
        });
    }

    /**
     * Carrega e decodifica o áudio para renderizar o waveform.
     */
    async loadAudio(url) {
        this.stopPreview();
        this.container.classList.remove('hidden');

        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.duration = this.audioBuffer.duration;

            // Extrair dados do waveform
            this.rawAudioData = this.audioBuffer.getChannelData(0);

            // Setup do canvas
            this._setupCanvas();

            // Reset selection para a duração fixa do vídeo
            const gap = this._getFixedGap();
            this.startPercent = 0;
            this.endPercent = Math.min(gap, 1);

            this._drawWaveform();
            this._updateHandles();
            this._notifyChange();
        } catch (err) {
            console.error('[MusicSelector] Erro ao carregar áudio:', err);
        }
    }

    _setupCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = (rect.width - 32) * dpr; // Account for padding
        this.canvas.height = 80 * dpr;
        this.canvas.style.width = `${rect.width - 32}px`;
        this.canvas.style.height = '80px';
        this.ctx.scale(dpr, dpr);
    }

    /**
     * Renderiza o waveform com regiões selecionadas.
     */
    _drawWaveform() {
        if (!this.rawAudioData) return;

        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        const data = this.rawAudioData;
        const barCount = Math.floor(w / 3); // Cada barra ocupa ~3px
        const step = Math.floor(data.length / barCount);
        const amp = h / 2;

        this.ctx.clearRect(0, 0, w, h);

        for (let i = 0; i < barCount; i++) {
            // Calcular amplitude média para este bloco
            let sum = 0;
            const start = i * step;
            const end = Math.min(start + step, data.length);
            for (let j = start; j < end; j++) {
                sum += Math.abs(data[j]);
            }
            const avg = sum / (end - start);
            const barH = Math.max(2, avg * h * 0.9);

            const x = i * (w / barCount);
            const barW = Math.max(1, (w / barCount) - 1);
            const percent = i / barCount;

            // Cor: selecionado vs não selecionado
            if (percent >= this.startPercent && percent <= this.endPercent) {
                // Gradiente para seleção
                const gradient = this.ctx.createLinearGradient(x, amp - barH / 2, x, amp + barH / 2);
                gradient.addColorStop(0, '#a855f7');
                gradient.addColorStop(1, '#ec4899');
                this.ctx.fillStyle = gradient;
            } else {
                this.ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
            }

            this.ctx.beginPath();
            this.ctx.roundRect(x, amp - barH / 2, barW, barH, 1);
            this.ctx.fill();
        }
    }

    /**
     * Atualiza posição visual dos handles e da seleção.
     */
    _updateHandles() {
        const containerRect = this.canvas.getBoundingClientRect();
        const w = containerRect.width;

        const startX = this.startPercent * w;
        const endX = this.endPercent * w;

        this.handleStartEl.style.left = `${startX + 16}px`; // 16 = padding
        this.handleEndEl.style.left = `${endX + 16}px`;
        this.selectionEl.style.left = `${startX}px`;
        this.selectionEl.style.width = `${endX - startX}px`;

        // Atualizar labels de tempo
        const startTime = this.startPercent * this.duration;
        const endTime = this.endPercent * this.duration;
        this.timeStartEl.textContent = this._formatTime(startTime);
        this.timeEndEl.textContent = this._formatTime(endTime);

        const clipDuration = endTime - startTime;
        this.durationLabel.textContent = `Trecho: ${this._formatTime(startTime)} - ${this._formatTime(endTime)} (${Math.round(clipDuration)}s)`;
    }

    _startDrag(handle, e) {
        this.isDragging = handle;
        this.canvasRect = this.canvas.getBoundingClientRect();
        // Calcular offset do mouse em relação ao início da seleção
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const currentStartX = this.startPercent * this.canvasRect.width + this.canvasRect.left;
        this.dragOffset = clientX - currentStartX;
    }

    _onDrag(e) {
        if (!this.isDragging || !this.canvasRect) return;
        if (e.cancelable) e.preventDefault();

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const gap = this._getFixedGap();

        // Mover a seleção inteira mantendo a duração fixa
        let newStartPercent = (clientX - this.dragOffset - this.canvasRect.left) / this.canvasRect.width;

        // Clampar para não sair dos limites
        newStartPercent = Math.max(0, Math.min(1 - gap, newStartPercent));

        this.startPercent = newStartPercent;
        this.endPercent = newStartPercent + gap;

        this._drawWaveform();
        this._updateHandles();
    }

    _stopDrag() {
        if (this.isDragging) {
            this.isDragging = null;
            this._notifyChange();
        }
    }

    /**
     * Play preview do trecho selecionado.
     */
    playPreview() {
        if (!this.audioBuffer || !this.audioContext) return;
        this.stopPreview();

        const startTime = this.startPercent * this.duration;
        const endTime = this.endPercent * this.duration;
        const duration = endTime - startTime;

        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.audioContext.destination);
        this.sourceNode.start(0, startTime, duration);
        this.sourceNode.onended = () => {
            this.isPlaying = false;
            this.btnPreview.classList.remove('playing');
            this.btnPreview.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Preview';
        };

        this.isPlaying = true;
        this.btnPreview.classList.add('playing');
        this.btnPreview.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Parar';
    }

    stopPreview() {
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch (e) {}
            this.sourceNode = null;
        }
        this.isPlaying = false;
        this.btnPreview.classList.remove('playing');
        this.btnPreview.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Preview';
    }

    /**
     * Retorna as configurações atuais de música.
     */
    getConfig() {
        if (!this.selectedMusicId || !this.duration) return null;
        return {
            musicId: this.selectedMusicId,
            musicStart: Math.round(this.startPercent * this.duration * 100) / 100,
            musicEnd: Math.round(this.endPercent * this.duration * 100) / 100
        };
    }

    /**
     * Atualiza a seleção quando o tempo de gravação muda.
     * Mantém a posição do início e ajusta o fim para a nova duração.
     */
    updateRecordingTime(seconds) {
        if (this.duration > 0) {
            const gap = Math.min(seconds / this.duration, 1);

            // Manter o início, ajustar o fim
            let newEnd = this.startPercent + gap;
            if (newEnd > 1) {
                // Se ultrapassou o fim, recuar o início
                newEnd = 1;
                this.startPercent = Math.max(0, 1 - gap);
            }
            this.endPercent = newEnd;

            this._drawWaveform();
            this._updateHandles();
            this._notifyChange();
        }
    }

    _notifyChange() {
        const event = new CustomEvent('musicchange', { detail: this.getConfig() });
        document.dispatchEvent(event);
    }

    _formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Carrega a lista de músicas do servidor.
     */
    async loadMusicList() {
        try {
            const response = await fetch('/api/music');
            const musicList = await response.json();

            // Limpar opções existentes (manter o placeholder)
            while (this.selectEl.options.length > 1) {
                this.selectEl.remove(1);
            }

            musicList.forEach(music => {
                const option = document.createElement('option');
                option.value = music.id;
                option.textContent = music.name;
                option.dataset.url = music.url;
                option.dataset.duration = music.duration;
                this.selectEl.appendChild(option);
            });
        } catch (err) {
            console.error('[MusicSelector] Erro ao carregar músicas:', err);
        }
    }
}

// Exportar globalmente
window.MusicSelector = MusicSelector;
