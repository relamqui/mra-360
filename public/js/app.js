/**
 * MRA 360 — App Principal
 * Orquestra todas as telas e o fluxo da aplicação.
 */
(function () {
    'use strict';

    // =============================================
    // Estado Global
    // =============================================
    window.appState = {
        recordingTime: 15,
        selectedFrame: 'none',
        musicConfig: null,
        currentScreen: 'setup'
    };

    // =============================================
    // Instâncias dos módulos
    // =============================================
    const recorder = new VideoRecorder();
    const musicSelector = new MusicSelector();
    const qrDisplay = new QRCodeDisplay();

    // =============================================
    // Elementos
    // =============================================
    const screens = {
        setup: document.getElementById('screen-setup'),
        recording: document.getElementById('screen-recording'),
        processing: document.getElementById('screen-processing'),
        qrcode: document.getElementById('screen-qrcode')
    };

    const btnRec = document.getElementById('btn-rec');
    const btnSettings = document.getElementById('btn-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const modalSettings = document.getElementById('modal-settings');
    const modalError = document.getElementById('modal-error');
    const btnCloseError = document.getElementById('btn-close-error');
    const btnNewRecording = document.getElementById('btn-new-recording');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const inputDriveFolder = document.getElementById('input-drive-folder');
    const inputMusicUpload = document.getElementById('input-music-upload');
    const musicUploadArea = document.getElementById('music-upload-area');
    const frameSelector = document.getElementById('frame-selector');
    const framePreviewOverlay = document.getElementById('frame-preview-overlay');
    const recordingFrameOverlay = document.getElementById('recording-frame-overlay');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const processingTitle = document.getElementById('processing-title');
    const processingStep = document.getElementById('processing-step');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    // =============================================
    // Navegação entre Telas
    // =============================================
    function showScreen(name) {
        Object.entries(screens).forEach(([key, el]) => {
            el.classList.toggle('active', key === name);
        });
        window.appState.currentScreen = name;
    }

    // =============================================
    // Inicialização
    // =============================================
    async function init() {
        // Carregar configurações
        await loadSettings();

        // Carregar listas
        await Promise.all([
            loadFrames(),
            musicSelector.loadMusicList()
        ]);

        // Configurar eventos
        setupTimeSelector();
        setupFrameSelector();
        setupRecButton();
        setupSettingsModal();
        setupMusicUpload();
        setupFrameUpload();
        setupMusicChange();
        setupNewRecording();
        setupErrorModal();
        setupCameraPlaceholder();
        setupCameraSelector();

        // Atualizar estado do botão REC
        updateRecButton();
    }

    // =============================================
    // Câmera
    // =============================================
    function setupCameraPlaceholder() {
        cameraPlaceholder.addEventListener('click', async () => {
            const selectEl = document.getElementById('camera-select');
            const deviceId = selectEl.value || undefined;
            const success = await recorder.initCamera(deviceId);
            if (!success) {
                showError('Câmera Indisponível', 'Não foi possível acessar a câmera. Verifique as permissões do navegador e se está usando HTTPS.');
            }
        });
    }

    async function setupCameraSelector() {
        const selectEl = document.getElementById('camera-select');
        selectEl.addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            // Se a câmera já estava ativa, reinicializa com a nova
            if (recorder.stream) {
                await recorder.initCamera(deviceId);
            }
        });

        // Tentar obter a lista de câmeras
        const cameras = await recorder.getCameras();
        if (cameras.length > 0) {
            selectEl.innerHTML = ''; // Limpar placeholder
            cameras.forEach((cam, index) => {
                const opt = document.createElement('option');
                opt.value = cam.deviceId;
                opt.text = cam.label || `Câmera ${index + 1}`;
                selectEl.appendChild(opt);
            });
        } else {
            selectEl.innerHTML = '<option value="">Câmera padrão</option>';
        }
    }

    // =============================================
    // Seletor de Tempo
    // =============================================
    function setupTimeSelector() {
        const btns = document.querySelectorAll('.time-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.appState.recordingTime = parseInt(btn.dataset.time);
                musicSelector.updateRecordingTime(window.appState.recordingTime);
            });
        });
    }

    // =============================================
    // Seletor de Moldura
    // =============================================
    async function loadFrames() {
        try {
            const response = await fetch('/api/frames');
            const frames = await response.json();

            frames.forEach(frame => {
                const option = document.createElement('div');
                option.className = 'frame-option';
                option.dataset.frame = frame.id;
                option.innerHTML = `
                    <div class="frame-thumb">
                        <img src="${frame.thumbnail}" alt="${frame.name}" loading="lazy">
                    </div>
                    <span>${frame.name}</span>
                `;
                frameSelector.appendChild(option);
            });

            setupFrameSelector();
        } catch (err) {
            console.error('[App] Erro ao carregar molduras:', err);
        }
    }

    function setupFrameSelector() {
        const options = frameSelector.querySelectorAll('.frame-option');
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                options.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                window.appState.selectedFrame = opt.dataset.frame;

                // Atualizar overlay no preview
                if (opt.dataset.frame === 'none') {
                    framePreviewOverlay.classList.add('hidden');
                } else {
                    const img = opt.querySelector('img');
                    if (img) {
                        framePreviewOverlay.src = img.src;
                        framePreviewOverlay.classList.remove('hidden');
                    }
                }
            });
        });
    }

    // =============================================
    // Música
    // =============================================
    function setupMusicChange() {
        document.addEventListener('musicchange', (e) => {
            window.appState.musicConfig = e.detail;
            updateRecButton();
        });
    }

    // =============================================
    // Botão REC
    // =============================================
    function updateRecButton() {
        const musicReady = window.appState.musicConfig !== null;
        btnRec.disabled = !musicReady;
    }

    function setupRecButton() {
        btnRec.addEventListener('click', startRecordingFlow);
    }

    async function startRecordingFlow() {
        // Garantir que a câmera está ativa
        if (!recorder.stream) {
            const selectEl = document.getElementById('camera-select');
            const deviceId = selectEl ? selectEl.value : undefined;
            const success = await recorder.initCamera(deviceId);
            if (!success) {
                showError('Câmera Indisponível', 'Não foi possível acessar a câmera.');
                return;
            }
        }

        // Parar preview de música
        musicSelector.stopPreview();

        // Configurar moldura no overlay de gravação
        if (window.appState.selectedFrame !== 'none') {
            recordingFrameOverlay.src = framePreviewOverlay.src;
            recordingFrameOverlay.classList.remove('hidden');
        } else {
            recordingFrameOverlay.classList.add('hidden');
        }

        // Mudar para tela de gravação
        showScreen('recording');

        // ==== Contagem regressiva antes de gravar ====
        const preCountdownEl = document.getElementById('pre-recording-countdown');
        const preCountdownText = document.getElementById('pre-countdown-text');
        const timerUI = document.getElementById('recording-timer');
        const recIndicator = document.getElementById('rec-indicator');

        // Esconder UI de gravação durante a contagem preparatória
        timerUI.classList.add('hidden');
        recIndicator.classList.add('hidden');
        preCountdownEl.classList.remove('hidden');

        for (let i = 5; i > 0; i--) {
            preCountdownText.textContent = i;
            // Efeito visual forçando reflow para resetar a animação
            preCountdownText.style.animation = 'none';
            preCountdownText.offsetHeight; 
            preCountdownText.style.animation = null;
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Fim da contagem, esconde o pre-countdown
        preCountdownEl.classList.add('hidden');

        try {
            // Mostrar UI de gravação
            timerUI.classList.remove('hidden');
            recIndicator.classList.remove('hidden');

            // Iniciar gravação realmente
            const videoBlob = await recorder.startRecording(window.appState.recordingTime);

            // Mudar para tela de processamento
            showScreen('processing');
            processingTitle.textContent = 'Enviando vídeo...';
            processingStep.textContent = 'Aguarde enquanto enviamos o vídeo para processamento';
            progressBar.style.width = '0%';
            progressText.textContent = '0%';

            // Upload do vídeo + configurações para o servidor
            const jobId = await uploadVideo(videoBlob);

            // Polling do status
            await pollJobStatus(jobId);

        } catch (err) {
            console.error('[App] Erro no fluxo de gravação:', err);
            showError('Erro na Gravação', err.message || 'Ocorreu um erro durante a gravação.');
            showScreen('setup');
        }
    }

    // =============================================
    // Upload e Polling
    // =============================================
    async function uploadVideo(blob) {
        const formData = new FormData();
        formData.append('video', blob, 'recording.webm');
        formData.append('frameId', window.appState.selectedFrame);
        formData.append('musicId', window.appState.musicConfig.musicId);
        formData.append('musicStart', window.appState.musicConfig.musicStart);
        formData.append('musicEnd', window.appState.musicConfig.musicEnd);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record');

            // Progresso do upload
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressBar.style.width = `${percent}%`;
                    progressText.textContent = `Enviando: ${percent}%`;
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data.jobId);
                } else {
                    try {
                        const err = JSON.parse(xhr.responseText);
                        reject(new Error(err.error || 'Erro no upload'));
                    } catch (e) {
                        reject(new Error(`Erro no upload (${xhr.status})`));
                    }
                }
            };

            xhr.onerror = () => reject(new Error('Erro de conexão'));
            xhr.send(formData);
        });
    }

    async function pollJobStatus(jobId) {
        const POLL_INTERVAL = 2000; // 2 segundos
        const MAX_POLLS = 150; // 5 minutos máximo

        for (let i = 0; i < MAX_POLLS; i++) {
            try {
                const response = await fetch(`/api/record/status/${jobId}`);
                const job = await response.json();

                // Atualizar UI
                processingTitle.textContent = job.step || 'Processando...';
                progressBar.style.width = `${job.progress || 0}%`;
                progressText.textContent = `${job.progress || 0}%`;

                switch (job.step) {
                    case 'Processando vídeo...':
                        processingStep.textContent = 'Aplicando moldura e música ao vídeo';
                        break;
                    case 'Enviando para o Drive...':
                        processingStep.textContent = 'Salvando o vídeo no Google Drive';
                        break;
                    case 'Gerando QR Code...':
                        processingStep.textContent = 'Criando QR Code para download';
                        break;
                    default:
                        processingStep.textContent = '';
                }

                if (job.status === 'done') {
                    if (job.qrCode) {
                        qrDisplay.show(job.qrCode);
                        showScreen('qrcode');
                    } else {
                        showError('Drive Não Configurado', 'O vídeo foi processado, mas o Google Drive não está configurado. Configure nas Configurações.');
                        showScreen('setup');
                    }
                    return;
                }

                if (job.status === 'error') {
                    throw new Error(job.error || 'Erro no processamento');
                }

            } catch (err) {
                console.error('[Poll] Erro:', err);
                if (i === MAX_POLLS - 1 || err.message.includes('Erro no processamento')) {
                    showError('Erro no Processamento', err.message);
                    showScreen('setup');
                    return;
                }
            }

            await new Promise(r => setTimeout(r, POLL_INTERVAL));
        }

        showError('Timeout', 'O processamento demorou demais. Tente novamente.');
        showScreen('setup');
    }

    // =============================================
    // Botão "Gravar Novamente"
    // =============================================
    function setupNewRecording() {
        btnNewRecording.addEventListener('click', () => {
            qrDisplay.clear();
            showScreen('setup');
        });
    }

    // =============================================
    // Modal de Configurações
    // =============================================
    function setupSettingsModal() {
        btnSettings.addEventListener('click', () => {
            modalSettings.classList.remove('hidden');
            refreshMusicList();
            refreshFrameList();
        });

        btnCloseSettings.addEventListener('click', () => {
            modalSettings.classList.add('hidden');
        });

        // Fechar ao clicar no backdrop
        modalSettings.querySelector('.modal-backdrop').addEventListener('click', () => {
            modalSettings.classList.add('hidden');
        });

        btnSaveSettings.addEventListener('click', saveSettingsFromUI);
    }

    async function loadSettings() {
        try {
            const response = await fetch('/api/settings');
            const settings = await response.json();
            inputDriveFolder.value = settings.driveFolderId || '';
        } catch (err) {
            console.error('[Settings] Erro ao carregar:', err);
        }
    }

    async function saveSettingsFromUI() {
        try {
            const settings = {
                driveFolderId: inputDriveFolder.value.trim()
            };
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            // Feedback visual
            btnSaveSettings.textContent = '✓ Salvo!';
            setTimeout(() => {
                btnSaveSettings.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Salvar';
            }, 2000);
        } catch (err) {
            showError('Erro', 'Não foi possível salvar as configurações.');
        }
    }

    // =============================================
    // Upload de Música
    // =============================================
    function setupMusicUpload() {
        inputMusicUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('music', file);

            try {
                const response = await fetch('/api/music/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Erro no upload');
                }

                await musicSelector.loadMusicList();
                await refreshMusicList();
                inputMusicUpload.value = '';
            } catch (err) {
                showError('Erro no Upload', err.message);
            }
        });

        // Drag & drop visual
        musicUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            musicUploadArea.classList.add('dragover');
        });
        musicUploadArea.addEventListener('dragleave', () => musicUploadArea.classList.remove('dragover'));
        musicUploadArea.addEventListener('drop', () => musicUploadArea.classList.remove('dragover'));
    }

    // =============================================
    // Upload de Moldura
    // =============================================
    const inputFrameUpload = document.getElementById('input-frame-upload');
    const frameUploadArea = document.getElementById('frame-upload-area');

    function setupFrameUpload() {
        if (!inputFrameUpload) return;

        inputFrameUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('frame', file);

            try {
                const response = await fetch('/api/frames/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Erro no upload da moldura');
                }

                // Recarregar seletor e lista
                await reloadFrameSelector();
                await refreshFrameList();
                inputFrameUpload.value = '';
            } catch (err) {
                showError('Erro no Upload', err.message);
            }
        });

        frameUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            frameUploadArea.classList.add('dragover');
        });
        frameUploadArea.addEventListener('dragleave', () => frameUploadArea.classList.remove('dragover'));
        frameUploadArea.addEventListener('drop', () => frameUploadArea.classList.remove('dragover'));
    }

    // Recarrega o seletor de molduras na tela principal
    async function reloadFrameSelector() {
        // Remover molduras antigas (manter só o botão "Sem")
        const existingOptions = frameSelector.querySelectorAll('.frame-option:not([data-frame="none"])');
        existingOptions.forEach(el => el.remove());
        await loadFrames();
    }

    async function refreshMusicList() {
        const listEl = document.getElementById('music-list');
        try {
            const response = await fetch('/api/music');
            const musicList = await response.json();

            if (musicList.length === 0) {
                listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Nenhuma música adicionada.</p>';
                return;
            }

            listEl.innerHTML = musicList.map(m => `
                <div class="music-item" data-id="${m.id}">
                    <span class="music-item-name">${m.name}</span>
                    <button class="music-item-delete" data-filename="${m.id}" title="Remover">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `).join('');

            listEl.querySelectorAll('.music-item-delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const filename = btn.dataset.filename;
                    if (confirm(`Remover "${filename}"?`)) {
                        await fetch(`/api/music/${filename}`, { method: 'DELETE' });
                        await musicSelector.loadMusicList();
                        await refreshMusicList();
                    }
                });
            });
        } catch (err) {
            console.error('[Music] Erro ao listar:', err);
        }
    }

    async function refreshFrameList() {
        const listEl = document.getElementById('frame-list');
        if (!listEl) return;
        try {
            const response = await fetch('/api/frames');
            const frameList = await response.json();

            if (frameList.length === 0) {
                listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Nenhuma moldura adicionada.</p>';
                return;
            }

            listEl.innerHTML = frameList.map(f => `
                <div class="music-item" data-id="${f.id}">
                    <img src="${f.thumbnail}" alt="${f.name}"
                        style="width:28px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;">
                    <span class="music-item-name" style="margin-left:8px;">${f.name}</span>
                    <button class="music-item-delete" data-filename="${f.id}" title="Remover">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `).join('');

            listEl.querySelectorAll('.music-item-delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const filename = btn.dataset.filename;
                    if (confirm(`Remover moldura "${filename}"?`)) {
                        await fetch(`/api/frames/${filename}`, { method: 'DELETE' });
                        await reloadFrameSelector();
                        await refreshFrameList();
                    }
                });
            });
        } catch (err) {
            console.error('[Frames] Erro ao listar:', err);
        }
    }

    // =============================================
    // Modal de Erro
    // =============================================
    function setupErrorModal() {
        btnCloseError.addEventListener('click', () => {
            modalError.classList.add('hidden');
        });
        modalError.querySelector('.modal-backdrop').addEventListener('click', () => {
            modalError.classList.add('hidden');
        });
    }

    function showError(title, message) {
        document.getElementById('error-title').textContent = title;
        document.getElementById('error-message').textContent = message;
        modalError.classList.remove('hidden');
    }

    // =============================================
    // Iniciar App
    // =============================================
    document.addEventListener('DOMContentLoaded', init);

})();
