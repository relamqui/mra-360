const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'oauth2-credentials.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'tokens.json');

// Escopo "drive" completo: necessário para listar e enviar para pastas que já
// existem na conta (com "drive.file" o app só enxerga pastas criadas por ele).
const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let driveClient = null;
let authClient = null;

/**
 * Lê client_id/client_secret de config/oauth2-credentials.json
 * (ou das variáveis GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 */
function loadCredentials() {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        return {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: []
        };
    }
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    return credentials.web || credentials.installed || null;
}

/**
 * Cria um cliente OAuth2.
 * @param {string} [redirectUri] - URL de retorno do login (necessária no fluxo pelo site)
 */
function createOAuthClient(redirectUri) {
    const creds = loadCredentials();
    if (!creds || !creds.client_id || !creds.client_secret) {
        throw new Error('Credenciais OAuth do Google não configuradas (config/oauth2-credentials.json).');
    }

    let uri = redirectUri;
    if (!uri) {
        uri = 'http://localhost:3000';
        if (creds.redirect_uris && creds.redirect_uris.length > 0 && creds.redirect_uris[0].startsWith('http')) {
            uri = creds.redirect_uris[0];
        }
    }
    return new google.auth.OAuth2(creds.client_id, creds.client_secret, uri);
}

/**
 * Inicializa o cliente do Google Drive usando os tokens salvos em config/tokens.json.
 */
function initDriveClient() {
    driveClient = null;
    authClient = null;

    if (!loadCredentials() || !fs.existsSync(TOKEN_PATH)) {
        console.warn('[Drive] ❌ Conta do Google não conectada.');
        console.warn('[Drive] Abra o site e clique em "Entrar no Drive" para conectar.');
        return null;
    }

    try {
        const oAuth2Client = createOAuthClient();
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
        oAuth2Client.setCredentials(tokens);

        // Escuta eventos de atualização de token (quando um token expira e é renovado)
        oAuth2Client.on('tokens', (newTokens) => {
            try {
                const current = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
                fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }, null, 2));
                console.log('[Drive] ✅ Tokens renovados e salvos com sucesso.');
            } catch (e) {
                console.error('[Drive] ❌ Erro ao salvar novo token:', e.message);
            }
        });

        authClient = oAuth2Client;
        driveClient = google.drive({ version: 'v3', auth: oAuth2Client });
        console.log('[Drive] ✅ Cliente Drive conectado com sucesso via OAuth2.');
        return driveClient;
    } catch (err) {
        console.error('[Drive] ❌ Erro ao configurar OAuth2:', err.message);
        return null;
    }
}

/**
 * URL da tela de login do Google.
 * @param {string} redirectUri - URL de retorno (ex.: https://site.com/auth/google/callback)
 * @param {string} state - valor anti-CSRF devolvido pelo Google no retorno
 */
function getAuthUrl(redirectUri, state) {
    return createOAuthClient(redirectUri).generateAuthUrl({
        access_type: 'offline', // Crucial: nos dá o refresh_token perpétuo
        prompt: 'consent select_account', // Garante o refresh_token e deixa escolher a conta
        scope: SCOPES,
        state
    });
}

/**
 * Troca o código de retorno do Google por tokens, salva e reconecta o Drive.
 * @returns {Promise<{name: string, email: string}>} Conta conectada
 */
async function handleAuthCallback(code, redirectUri) {
    const oAuth2Client = createOAuthClient(redirectUri);
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const { data } = await google.oauth2({ version: 'v2', auth: oAuth2Client }).userinfo.get();

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    initDriveClient();

    return { name: data.name || '', email: data.email || '' };
}

/**
 * Desconecta a conta: revoga o acesso no Google e apaga os tokens locais.
 */
async function disconnect() {
    if (authClient) {
        try {
            await authClient.revokeCredentials();
        } catch (e) {
            console.warn('[Drive] Não foi possível revogar o token (continuando):', e.message);
        }
    }
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    driveClient = null;
    authClient = null;
}

/**
 * Nome e e-mail da conta conectada (via Drive, funciona também com tokens antigos).
 */
async function getAccount() {
    if (!driveClient) throw new Error('Drive client não inicializado');
    const { data } = await driveClient.about.get({ fields: 'user(displayName, emailAddress)' });
    return { name: data.user.displayName || '', email: data.user.emailAddress || '' };
}

/** Nome de uma pasta pelo ID. */
async function getFolderName(folderId) {
    if (!driveClient) throw new Error('Drive client não inicializado');
    const { data } = await driveClient.files.get({ fileId: folderId, fields: 'name', supportsAllDrives: true });
    return data.name;
}

/**
 * Lista as subpastas de uma pasta.
 * @param {string} parentId - 'root' (Meu Drive), 'shared' (Compartilhados comigo) ou ID de pasta
 */
async function listFolders(parentId = 'root') {
    if (!driveClient) throw new Error('Drive client não inicializado');

    const parentQuery = parentId === 'shared'
        ? 'sharedWithMe'
        : `'${parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents`;

    const folders = [];
    let pageToken;
    do {
        const { data } = await driveClient.files.list({
            q: `mimeType='${FOLDER_MIME}' and trashed=false and ${parentQuery}`,
            fields: 'nextPageToken, files(id, name)',
            orderBy: 'name',
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        folders.push(...(data.files || []));
        pageToken = data.nextPageToken;
    } while (pageToken);

    return folders;
}

/**
 * Cria uma pasta no Drive.
 * @param {string} name - Nome da pasta
 * @param {string} [parentId] - ID da pasta pai ('root' ou vazio = Meu Drive)
 */
async function createFolder(name, parentId) {
    if (!driveClient) throw new Error('Drive client não inicializado');

    const requestBody = { name, mimeType: FOLDER_MIME };
    if (parentId && parentId !== 'root' && parentId !== 'shared') {
        requestBody.parents = [parentId];
    }
    const { data } = await driveClient.files.create({
        requestBody,
        fields: 'id, name',
        supportsAllDrives: true
    });
    return { id: data.id, name: data.name };
}

/**
 * Busca ou cria a pasta do dia (YYYY-MM-DD) dentro da pasta pai do Drive.
 * @param {string} parentFolderId - ID da pasta pai no Drive
 * @returns {Promise<string>} ID da pasta do dia
 */
async function getOrCreateDayFolder(parentFolderId) {
    if (!driveClient) throw new Error('Drive client não inicializado');

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Buscar pasta do dia
    const searchResponse = await driveClient.files.list({
        q: `name='${today}' and '${parentFolderId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    if (searchResponse.data.files.length > 0) {
        console.log(`[Drive] Pasta do dia encontrada: ${today} (${searchResponse.data.files[0].id})`);
        return searchResponse.data.files[0].id;
    }

    // Criar pasta do dia
    const createResponse = await driveClient.files.create({
        requestBody: {
            name: today,
            mimeType: FOLDER_MIME,
            parents: [parentFolderId]
        },
        fields: 'id',
        supportsAllDrives: true
    });

    console.log(`[Drive] Pasta do dia criada: ${today} (${createResponse.data.id})`);
    return createResponse.data.id;
}

/**
 * Faz upload de um arquivo para o Google Drive.
 * @param {string} filePath - Caminho local do arquivo
 * @param {string} parentFolderId - ID da pasta pai no Drive
 * @param {string} [customName] - Nome personalizado para o arquivo
 * @returns {Promise<{fileId: string, downloadLink: string, webLink: string}>}
 */
async function uploadFile(filePath, parentFolderId, customName) {
    if (!driveClient) throw new Error('Drive client não inicializado');

    // Obter ou criar pasta do dia
    const dayFolderId = await getOrCreateDayFolder(parentFolderId);

    const fileName = customName || path.basename(filePath);

    // Upload do arquivo
    const fileMetadata = {
        name: fileName,
        parents: [dayFolderId]
    };

    const media = {
        mimeType: 'video/mp4',
        body: fs.createReadStream(filePath)
    };

    console.log(`[Drive] Fazendo upload: ${fileName}...`);

    const uploadResponse = await driveClient.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink',
        supportsAllDrives: true
    });

    const fileId = uploadResponse.data.id;

    // Tornar público (anyone with link = reader)
    await driveClient.permissions.create({
        fileId: fileId,
        requestBody: {
            role: 'reader',
            type: 'anyone'
        },
        supportsAllDrives: true
    });

    // webContentLink é o link direto de download (funciona melhor no Android)
    const downloadLink = uploadResponse.data.webContentLink || `https://drive.google.com/uc?export=download&id=${fileId}`;
    const webLink = uploadResponse.data.webViewLink;

    console.log(`[Drive] Upload concluído. ID: ${fileId}`);
    console.log(`[Drive] Link de download: ${downloadLink}`);

    return { fileId, downloadLink, webLink };
}

/**
 * Verifica se o cliente do Drive está disponível.
 * @returns {boolean}
 */
function isDriveAvailable() {
    return driveClient !== null;
}

module.exports = {
    initDriveClient,
    uploadFile,
    isDriveAvailable,
    getOrCreateDayFolder,
    getAuthUrl,
    handleAuthCallback,
    disconnect,
    listFolders,
    createFolder,
    getAccount,
    getFolderName
};
