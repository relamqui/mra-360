require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const { processVideo, getMediaDuration } = require('./services/video-processor');
const { initDriveClient, uploadFile, isDriveAvailable } = require('./services/drive-upload');
const { generateQRCode } = require('./services/qrcode-generator');

// =============================================
// Configurações e Diretórios
// =============================================

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
const MUSIC_DIR = path.join(UPLOADS_DIR, 'music');
const FRAMES_DIR = path.join(UPLOADS_DIR, 'frames');
const OUTPUT_DIR = path.join(__dirname, 'output');
const CONFIG_DIR = path.join(__dirname, 'config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

// Garantir que os diretórios existam
[VIDEOS_DIR, MUSIC_DIR, FRAMES_DIR, OUTPUT_DIR, CONFIG_DIR].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
});

// =============================================
// Configurações Persistentes
// =============================================

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.warn('[Settings] Erro ao carregar:', e.message);
    }
    return {
        driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
    };
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// =============================================
// Jobs de Processamento (estado em memória)
// =============================================

const jobs = new Map();

// =============================================
// Multer (upload de arquivos)
// =============================================

const videoUpload = multer({
    storage: multer.diskStorage({
        destination: VIDEOS_DIR,
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || '.webm';
            cb(null, `${uuidv4()}${ext}`);
        }
    }),
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

const musicUpload = multer({
    storage: multer.diskStorage({
        destination: MUSIC_DIR,
        filename: (req, file, cb) => {
            // Manter nome original, sanitizado
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '');
            cb(null, safeName);
        }
    }),
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/mp4'];
        if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|aac|m4a)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de áudio não suportado. Use MP3, WAV, OGG, AAC ou M4A.'));
        }
    },
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

const frameUpload = multer({
    storage: multer.diskStorage({
        destination: FRAMES_DIR,
        filename: (req, file, cb) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '');
            cb(null, safeName);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.originalname.match(/\.(png|jpg|jpeg|webp)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Formato não suportado. Use PNG, JPG ou WEBP.'));
        }
    },
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB max
});

// =============================================
// Inicializar App
// =============================================

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Servir uploads (para preview de músicas e molduras)
app.use('/uploads', express.static(UPLOADS_DIR));

// Inicializar Google Drive
initDriveClient();

// =============================================
// ROTAS: Configurações
// =============================================

app.get('/api/settings', (req, res) => {
    const settings = loadSettings();
    res.json(settings);
});

app.post('/api/settings', (req, res) => {
    const current = loadSettings();
    const updated = { ...current, ...req.body };
    saveSettings(updated);
    res.json({ success: true, settings: updated });
});

// =============================================
// ROTAS: Molduras
// =============================================

app.get('/api/frames', (req, res) => {
    try {
        const files = fs.readdirSync(FRAMES_DIR)
            .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
            .map(f => ({
                id: f,
                name: path.parse(f).name.replace(/[-_]/g, ' '),
                url: `/uploads/frames/${f}`,
                thumbnail: `/uploads/frames/${f}`
            }));
        res.json(files);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/frames/upload', frameUpload.single('frame'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    res.json({
        success: true,
        frame: {
            id: req.file.filename,
            name: path.parse(req.file.filename).name.replace(/[-_]/g, ' '),
            url: `/uploads/frames/${req.file.filename}`,
            thumbnail: `/uploads/frames/${req.file.filename}`
        }
    });
});

app.delete('/api/frames/:filename', (req, res) => {
    const filePath = path.join(FRAMES_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Moldura não encontrada.' });
    }
});

// =============================================
// ROTAS: Músicas
// =============================================

app.get('/api/music', async (req, res) => {
    try {
        const files = fs.readdirSync(MUSIC_DIR)
            .filter(f => /\.(mp3|wav|ogg|aac|m4a)$/i.test(f));

        const musicList = [];
        for (const f of files) {
            const filePath = path.join(MUSIC_DIR, f);
            let duration = 0;
            try {
                duration = await getMediaDuration(filePath);
            } catch (e) {
                console.warn(`[Music] Não foi possível obter duração de ${f}:`, e.message);
            }
            musicList.push({
                id: f,
                name: path.parse(f).name.replace(/[-_]/g, ' '),
                url: `/uploads/music/${f}`,
                duration: Math.round(duration * 100) / 100
            });
        }
        res.json(musicList);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/music/upload', musicUpload.single('music'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    res.json({
        success: true,
        music: {
            id: req.file.filename,
            name: path.parse(req.file.filename).name.replace(/[-_]/g, ' '),
            url: `/uploads/music/${req.file.filename}`
        }
    });
});

app.delete('/api/music/:filename', (req, res) => {
    const filePath = path.join(MUSIC_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Música não encontrada.' });
    }
});

// =============================================
// ROTAS: Gravação e Processamento
// =============================================

/**
 * POST /api/record
 * Recebe o vídeo raw e inicia o processamento em background.
 * Body (multipart):
 *   - video: arquivo de vídeo
 *   - frameId: ID da moldura (ou "none")
 *   - musicId: ID da música
 *   - musicStart: tempo início (segundos)
 *   - musicEnd: tempo fim (segundos)
 * Retorna: { jobId }
 */
app.post('/api/record', videoUpload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum vídeo enviado.' });
        }

        const { frameId, musicId, musicStart, musicEnd, mode } = req.body;

        if (!musicId) {
            return res.status(400).json({ error: 'Música é obrigatória.' });
        }

        const jobId = uuidv4();
        const videoPath = req.file.path;
        const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);

        // Determinar caminhos
        const framePath = (frameId && frameId !== 'none')
            ? path.join(FRAMES_DIR, frameId)
            : null;
        const musicPath = path.join(MUSIC_DIR, musicId);

        // Validar que os arquivos existem
        if (framePath && !fs.existsSync(framePath)) {
            return res.status(400).json({ error: `Moldura não encontrada: ${frameId}` });
        }
        if (!fs.existsSync(musicPath)) {
            return res.status(400).json({ error: `Música não encontrada: ${musicId}` });
        }

        // Criar job
        jobs.set(jobId, {
            status: 'processing',
            progress: 0,
            step: 'Processando vídeo...',
            qrCode: null,
            downloadLink: null,
            error: null,
            outputPath: outputPath,
            createdAt: Date.now()
        });

        // Responder imediatamente com o jobId
        res.json({ jobId });

        // Processar em background
        processJob(jobId, {
            videoPath,
            framePath,
            musicPath,
            musicStart: parseFloat(musicStart) || 0,
            musicEnd: parseFloat(musicEnd) || 30,
            outputPath,
            mode: mode || 'normal'
        });

    } catch (err) {
        console.error('[Record] Erro:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/record/status/:jobId
 * Retorna o status do processamento.
 */
app.get('/api/record/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job não encontrado.' });
    }
    // Não enviar outputPath para o cliente
    const { outputPath, ...safeJob } = job;
    res.json(safeJob);
});

/**
 * GET /api/download/:jobId
 * Serve o vídeo processado diretamente para download.
 * Funciona em Android sem depender do Google Drive renderizar.
 */
app.get('/api/download/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Vídeo não encontrado ou expirado.' });
    }
    if (!job.outputPath || !fs.existsSync(job.outputPath)) {
        return res.status(404).json({ error: 'Arquivo de vídeo não disponível.' });
    }

    const filename = `MRA360_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fs.statSync(job.outputPath).size);

    const stream = fs.createReadStream(job.outputPath);
    stream.pipe(res);
});

/**
 * Processa um job em background: FFmpeg → Drive → QR Code
 */
async function processJob(jobId, { videoPath, framePath, musicPath, musicStart, musicEnd, outputPath, mode }) {
    const job = jobs.get(jobId);

    try {
        // Etapa 1: Processar vídeo com FFmpeg
        job.status = 'processing';
        job.step = 'Processando vídeo...';
        job.progress = 0;

        await processVideo({
            videoPath,
            framePath,
            musicPath,
            musicStart,
            musicEnd,
            outputPath,
            mode,
            onProgress: (percent) => {
                job.progress = Math.round(percent * 0.6); // 0-60%
            }
        });

        // Etapa 2: Upload para Google Drive (backup)
        job.step = 'Enviando para o Drive...';
        job.progress = 60;

        const settings = loadSettings();

        if (isDriveAvailable() && settings.driveFolderId) {
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const fileName = `MRA360_${timestamp}.mp4`;
                await uploadFile(outputPath, settings.driveFolderId, fileName);
                job.progress = 85;
            } catch (driveErr) {
                console.warn('[Job] Erro no upload Drive (continuando):', driveErr.message);
                job.progress = 85;
            }
        } else {
            console.warn('[Job] Drive não configurado. Pulando upload.');
            job.progress = 85;
        }

        // Etapa 3: Gerar QR Code com link de download DIRETO do servidor
        job.step = 'Gerando QR Code...';
        job.progress = 90;

        // Usar o próprio servidor como endpoint de download (funciona instantaneamente no Android)
        const serverDownloadUrl = `${getServerPublicUrl()}/api/download/${jobId}`;
        const qrCode = await generateQRCode(serverDownloadUrl);

        // Concluído
        job.status = 'done';
        job.step = 'Concluído!';
        job.progress = 100;
        job.qrCode = qrCode;
        job.downloadLink = serverDownloadUrl;

        // Limpar apenas o vídeo raw (o output fica para download)
        cleanupFile(videoPath);

        // Agendar limpeza do output após 30 minutos
        setTimeout(() => {
            cleanupFile(outputPath);
            console.log(`[Cleanup] Output do job ${jobId} removido após 30min.`);
        }, 30 * 60 * 1000);

    } catch (err) {
        console.error(`[Job ${jobId}] Erro:`, err);
        job.status = 'error';
        job.step = 'Erro no processamento';
        job.error = err.message;

        // Limpar arquivos temporários mesmo com erro
        cleanupFile(videoPath);
        cleanupFile(outputPath);
    }
}

function cleanupFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('[Cleanup] Removido:', filePath);
        }
    } catch (e) {
        console.warn('[Cleanup] Erro ao remover:', filePath, e.message);
    }
}

/**
 * Retorna a URL pública do servidor.
 * No EasyPanel, usa a variável SERVER_URL ou constrói a partir do hostname.
 */
function getServerPublicUrl() {
    // 1. Variável de ambiente (configurável no EasyPanel)
    if (process.env.SERVER_URL) {
        return process.env.SERVER_URL.replace(/\/$/, '');
    }
    // 2. Fallback: localhost
    return `http://localhost:${PORT}`;
}

// Limpar jobs antigos a cada 30 minutos
setInterval(() => {
    const now = Date.now();
    const MAX_AGE = 60 * 60 * 1000; // 1 hora
    for (const [jobId, job] of jobs) {
        if (now - job.createdAt > MAX_AGE) {
            if (job.outputPath) cleanupFile(job.outputPath);
            jobs.delete(jobId);
        }
    }
}, 30 * 60 * 1000);

// =============================================
// Iniciar Servidor (HTTP + HTTPS opcional)
// =============================================

// Obter IPs locais da máquina
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const iface of Object.values(interfaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                ips.push(addr.address);
            }
        }
    }
    return ips;
}

const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const USE_HTTPS = process.env.HTTPS_DEV !== 'false'; // Ativo por padrão

function startServers() {
    const localIPs = getLocalIPs();

    // Sempre inicia HTTP
    http.createServer(app).listen(PORT, () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════════════╗');
        console.log('║           🎬  MRA 360 — Cabine 360                  ║');
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║  HTTP  → http://localhost:${PORT}                       ║`);

        if (USE_HTTPS) {
            localIPs.forEach(ip => {
                console.log(`║  HTTPS → https://${ip}:${HTTPS_PORT}  (celular)`.padEnd(55) + '║');
            });
        }

        console.log('╠══════════════════════════════════════════════════════╣');
        const driveStatus = isDriveAvailable() ? 'Drive: \u2705 Conectado                              ' : 'Drive: \u274c Nao configurado                     ';
        console.log(`\u2551  ${driveStatus}\u2551`);
        console.log('╚══════════════════════════════════════════════════════╝');
        console.log('');

        if (USE_HTTPS && localIPs.length > 0) {
            console.log('📱 Para acessar pelo celular (Chrome):');
            console.log(`   1. Abra: https://${localIPs[0]}:${HTTPS_PORT}`);
            console.log('   2. Toque em "Avançado" → "Prosseguir" (certificado auto-assinado)');
            console.log('   3. A câmera vai funcionar normalmente!');
            console.log('');
        }
    });

    // Inicia HTTPS com certificado auto-assinado (para câmera no celular)
    if (USE_HTTPS) {
        startHttps(localIPs);
    }
}

async function startHttps(localIPs) {
    try {
        const certPath = path.join(CONFIG_DIR, 'cert.pem');
        const keyPath = path.join(CONFIG_DIR, 'key.pem');

        let sslOptions;

        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            sslOptions = {
                cert: fs.readFileSync(certPath),
                key: fs.readFileSync(keyPath)
            };
            console.log('[HTTPS] Reutilizando certificado existente.');
        } else {
            const selfsigned = require('selfsigned');
            const attrs = [{ name: 'commonName', value: 'mra360.local' }];
            const pems = await selfsigned.generate(attrs, {
                days: 365,
                algorithm: 'sha256',
                extensions: [{
                    name: 'subjectAltName',
                    altNames: [
                        { type: 2, value: 'localhost' },
                        { type: 2, value: 'mra360.local' },
                        ...localIPs.map(ip => ({ type: 7, ip }))
                    ]
                }]
            });
            fs.writeFileSync(certPath, pems.cert);
            fs.writeFileSync(keyPath, pems.private);
            sslOptions = { cert: pems.cert, key: pems.private };
            console.log('[HTTPS] Certificado auto-assinado gerado em config/');
        }

        https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
            console.log(`[HTTPS] ✅ Servidor HTTPS rodando na porta ${HTTPS_PORT}`);
        });
    } catch (err) {
        console.warn('[HTTPS] Erro ao iniciar HTTPS:', err.message);
    }
}

startServers();
