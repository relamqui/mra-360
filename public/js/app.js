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
        currentScreen: 'setup',
        selectedMode: 'normal'
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
        setupModeSelector();
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

        // Voltando da tela de login do Google?
        handleDriveLoginReturn();
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
                const success = await recorder.initCamera(deviceId);
                if (!success) {
                    showError('Câmera Indisponível', 'Não foi possível abrir esta câmera. Escolha outra na lista.');
                }
            }
        });

        // Opções fixas (funcionam em qualquer celular) + câmeras detectadas
        selectEl.innerHTML = `
            <option value="environment">📷 Câmera traseira</option>
            <option value="user">🤳 Câmera frontal</option>
        `;

        const cameras = await recorder.getCameras();
        cameras.forEach((cam, index) => {
            const opt = document.createElement('option');
            opt.value = cam.deviceId;
            opt.text = cam.label || `Câmera ${index + 1}`;
            selectEl.appendChild(opt);
        });
        selectEl.value = 'environment';
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
    // Seletor de Modo
    // =============================================
    const modeDescriptions = {
        normal: 'Gravação em velocidade normal.',
        speedramp: 'Grava 15s e comprime para ~7s com aceleração gradual.',
        boomerang: 'Grava 10s, acelera e depois reverte em câmera lenta.'
    };

    function setupModeSelector() {
        const modeSelector = document.getElementById('mode-selector');
        const modeDescription = document.getElementById('mode-description');
        const modeBtns = modeSelector.querySelectorAll('.mode-btn');

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                window.appState.selectedMode = mode;

                // Atualizar descrição
                modeDescription.textContent = modeDescriptions[mode] || '';

                // Forçar tempo de gravação para modos especiais
                const timeBtns = document.querySelectorAll('.time-btn');
                if (mode === 'speedramp') {
                    // Forçar 15s
                    timeBtns.forEach(b => b.classList.remove('active'));
                    const btn15 = document.querySelector('.time-btn[data-time="15"]');
                    if (btn15) btn15.classList.add('active');
                    window.appState.recordingTime = 15;
                    musicSelector.updateRecordingTime(15);
                } else if (mode === 'boomerang') {
                    // Forçar 10s
                    timeBtns.forEach(b => b.classList.remove('active'));
                    const btn10 = document.querySelector('.time-btn[data-time="10"]');
                    if (btn10) btn10.classList.add('active');
                    window.appState.recordingTime = 10;
                    musicSelector.updateRecordingTime(10);
                }
                // Normal: manter o tempo que o usuário escolheu
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
        // Garantir que a câmera está ativa (reabre se o stream caiu/travou)
        if (!recorder.isStreamLive()) {
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
        formData.append('video', blob, `recording.${recorder.getFileExtension()}`);
        formData.append('frameId', window.appState.selectedFrame);
        formData.append('musicId', window.appState.musicConfig.musicId);
        formData.append('musicStart', window.appState.musicConfig.musicStart);
        formData.append('musicEnd', window.appState.musicConfig.musicEnd);
        formData.append('mode', window.appState.selectedMode);

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
                        showError('Erro', 'Não foi possível gerar o QR Code. Tente novamente.');
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
    function openSettings() {
        modalSettings.classList.remove('hidden');
        refreshMusicList();
        refreshFrameList();
        loadDriveStatus(true);
    }

    function setupSettingsModal() {
        btnSettings.addEventListener('click', openSettings);

        // Atalho do cabeçalho: abre a seção do Drive (ou vai direto ao login, se desconectado)
        document.getElementById('btn-drive').addEventListener('click', () => {
            if (!driveState.connected) {
                window.location.href = '/auth/google';
                return;
            }
            openSettings();
            document.getElementById('settings-drive').scrollIntoView({ block: 'start' });
        });

        btnCloseSettings.addEventListener('click', () => {
            modalSettings.classList.add('hidden');
        });

        // Fechar ao clicar no backdrop
        modalSettings.querySelector('.modal-backdrop').addEventListener('click', () => {
            modalSettings.classList.add('hidden');
        });

        setupDriveBrowser();
    }

    async function loadSettings() {
        await loadDriveStatus(false);
    }

    // =============================================
    // Google Drive: conta e navegador de pastas
    // =============================================
    const driveState = { connected: false, account: null, folder: null };
    const driveBrowser = {
        path: [{ id: 'root', name: 'Meu Drive' }],
        loadSeq: 0
    };

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    async function driveApi(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 401) loadDriveStatus(false);
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
    }

    /** Lê do servidor se há conta conectada e qual a pasta de destino. */
    async function loadDriveStatus(openBrowser) {
        try {
            const status = await driveApi('/api/drive/status');
            Object.assign(driveState, status);
        } catch (err) {
            console.error('[Drive] Erro ao carregar status:', err);
        }
        renderDriveUI();
        if (openBrowser && driveState.connected) setDriveRoot('root');
    }

    /** Após voltar da tela de login do Google (?drive=connected|error). */
    function handleDriveLoginReturn() {
        const params = new URLSearchParams(window.location.search);
        const result = params.get('drive');
        if (!result) return;
        history.replaceState(null, '', window.location.pathname);

        if (result === 'connected') {
            // Já abre o navegador de pastas para escolher o destino
            openSettings();
            document.getElementById('settings-drive').scrollIntoView({ block: 'start' });
        } else {
            showError('Erro no Login do Google', params.get('msg') || 'Não foi possível conectar a conta.');
        }
    }

    function renderDriveUI() {
        const { connected, account, folder } = driveState;

        // Botão do cabeçalho
        const btn = document.getElementById('btn-drive');
        const label = document.getElementById('btn-drive-label');
        btn.classList.toggle('logged', connected && !!folder);
        btn.classList.toggle('no-folder', connected && !folder);
        if (!connected) {
            label.textContent = 'Entrar no Drive';
        } else if (folder) {
            // Mostra só a última parte do caminho ("Meu Drive / Eventos / Festa" → "Festa")
            label.textContent = folder.name.split(' / ').pop();
        } else {
            label.textContent = 'Escolher pasta';
        }
        btn.title = folder ? `Vídeos vão para: ${folder.name}` : 'Conta Google e pasta dos vídeos';

        // Seção do Drive nas configurações
        document.getElementById('google-auth-unlogged').classList.toggle('hidden', connected);
        document.getElementById('google-auth-logged').classList.toggle('hidden', !connected);
        if (!connected) return;

        const name = (account && account.name) || 'Conta Google';
        document.getElementById('auth-name').textContent = name;
        document.getElementById('auth-email').textContent = (account && account.email) || '';
        document.getElementById('auth-avatar').textContent = name.charAt(0).toUpperCase();

        document.getElementById('drive-selected-folder').textContent = folder
            ? `📁 ${folder.name}`
            : 'Nenhuma pasta selecionada — os vídeos NÃO serão enviados ao Drive';
    }

    function renderBreadcrumb() {
        const el = document.getElementById('drive-breadcrumb');
        el.innerHTML = driveBrowser.path.map((p, i) =>
            (i > 0 ? '<span class="drive-crumb-sep">›</span>' : '') +
            `<button class="drive-crumb" data-index="${i}">${escapeHtml(p.name)}</button>`
        ).join('');
        el.querySelectorAll('.drive-crumb').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index, 10);
                if (index === driveBrowser.path.length - 1) return;
                driveBrowser.path = driveBrowser.path.slice(0, index + 1);
                loadDriveFolder();
            });
        });

        // "Compartilhados comigo" não é uma pasta: não dá para usar nem criar nela
        const current = driveBrowser.path[driveBrowser.path.length - 1];
        const isSharedRoot = current.id === 'shared';
        document.getElementById('btn-use-folder').disabled = isSharedRoot;
        document.getElementById('btn-create-folder').disabled = isSharedRoot;
    }

    async function loadDriveFolder() {
        const listEl = document.getElementById('drive-folder-list');
        const current = driveBrowser.path[driveBrowser.path.length - 1];
        const seq = ++driveBrowser.loadSeq;

        renderBreadcrumb();
        listEl.innerHTML = '<p class="drive-empty">Carregando pastas...</p>';

        try {
            const folders = await driveApi(`/api/drive/folders?parent=${encodeURIComponent(current.id)}`);
            if (seq !== driveBrowser.loadSeq) return; // navegação mais recente em andamento

            if (folders.length === 0) {
                listEl.innerHTML = '<p class="drive-empty">Nenhuma subpasta aqui.</p>';
                return;
            }

            listEl.innerHTML = folders.map(f => `
                <button class="drive-folder-item" data-id="${escapeHtml(f.id)}" data-name="${escapeHtml(f.name)}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="color:#8ab4f8;flex-shrink:0;">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                    <span>${escapeHtml(f.name)}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.5;flex-shrink:0;">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
            `).join('');

            listEl.querySelectorAll('.drive-folder-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    driveBrowser.path.push({ id: btn.dataset.id, name: btn.dataset.name });
                    loadDriveFolder();
                });
            });
        } catch (err) {
            if (seq !== driveBrowser.loadSeq) return;
            console.error('[Drive] Erro ao listar pastas:', err);
            listEl.innerHTML = `<p class="drive-empty">Erro ao carregar pastas: ${escapeHtml(err.message)}</p>`;
        }
    }

    function setDriveRoot(rootId) {
        document.querySelectorAll('.drive-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.root === rootId);
        });
        driveBrowser.path = [{ id: rootId, name: rootId === 'shared' ? 'Compartilhados comigo' : 'Meu Drive' }];
        loadDriveFolder();
    }

    function setupDriveBrowser() {
        document.querySelectorAll('.drive-tab').forEach(tab => {
            tab.addEventListener('click', () => setDriveRoot(tab.dataset.root));
        });

        document.getElementById('btn-google-logout').addEventListener('click', async () => {
            if (!confirm('Desconectar a conta do Google? Os vídeos deixarão de ir para o Drive.')) return;
            try {
                await driveApi('/api/drive/logout', { method: 'POST' });
            } catch (err) {
                showError('Erro', err.message);
            }
            loadDriveStatus(false);
        });

        document.getElementById('btn-use-folder').addEventListener('click', async () => {
            const current = driveBrowser.path[driveBrowser.path.length - 1];
            if (current.id === 'shared') return;
            const fullName = driveBrowser.path.map(p => p.name).join(' / ');
            try {
                const { folder } = await driveApi('/api/drive/folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: current.id, name: fullName })
                });
                driveState.folder = folder;
                renderDriveUI();
            } catch (err) {
                showError('Erro', 'Não foi possível salvar a pasta: ' + err.message);
            }
        });

        document.getElementById('btn-create-folder').addEventListener('click', async () => {
            const current = driveBrowser.path[driveBrowser.path.length - 1];
            if (current.id === 'shared') return;
            const name = prompt('Nome da nova pasta:', 'MRA 360');
            if (!name || !name.trim()) return;
            try {
                const folder = await driveApi('/api/drive/folders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim(), parent: current.id })
                });
                // Entra na pasta criada para o usuário confirmar com "Usar esta pasta"
                driveBrowser.path.push({ id: folder.id, name: folder.name });
                loadDriveFolder();
            } catch (err) {
                showError('Erro ao Criar Pasta', err.message);
            }
        });
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
