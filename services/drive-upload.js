const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let driveClient = null;

/**
 * Inicializa o cliente do Google Drive usando OAuth2 autenticado pelo usuário.
 */
function initDriveClient() {
    const configDir = path.join(__dirname, '..', 'config');
    const credentialsPath = path.join(configDir, 'oauth2-credentials.json');
    const tokenPath = path.join(configDir, 'tokens.json');
    
    if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
        console.warn('[Drive] ❌ Falta oauth2-credentials.json ou tokens.json na pasta config/');
        console.warn('[Drive] Autenticação não realizada. Rode: node setup-auth.js no terminal.');
        return null;
    }

    try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath));
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web || {};
        
        let redirectUri = 'http://localhost:3000';
        if (redirect_uris && redirect_uris.length > 0 && redirect_uris[0].startsWith('http')) {
            redirectUri = redirect_uris[0];
        }
        
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
        const tokens = JSON.parse(fs.readFileSync(tokenPath));
        oAuth2Client.setCredentials(tokens);

        // Escuta eventos de atualização de token (quando um token expira e é renovado)
        oAuth2Client.on('tokens', (newTokens) => {
            try {
                const updatedTokens = { ...tokens, ...newTokens };
                fs.writeFileSync(tokenPath, JSON.stringify(updatedTokens, null, 2));
                console.log('[Drive] ✅ Tokens renovados e salvos com sucesso.');
            } catch (e) {
                console.error('[Drive] ❌ Erro ao salvar novo token:', e.message);
            }
        });

        driveClient = google.drive({ version: 'v3', auth: oAuth2Client });
        console.log('[Drive] ✅ Cliente Drive conectado com sucesso via OAuth2.');
        return driveClient;
    } catch (err) {
        console.error('[Drive] ❌ Erro ao configurar OAuth2:', err.message);
        return null;
    }
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
        q: `name='${today}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive'
    });

    if (searchResponse.data.files.length > 0) {
        console.log(`[Drive] Pasta do dia encontrada: ${today} (${searchResponse.data.files[0].id})`);
        return searchResponse.data.files[0].id;
    }

    // Criar pasta do dia
    const createResponse = await driveClient.files.create({
        requestBody: {
            name: today,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        },
        fields: 'id'
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
        fields: 'id, webViewLink, webContentLink'
    });

    const fileId = uploadResponse.data.id;

    // Tornar público (anyone with link = reader)
    await driveClient.permissions.create({
        fileId: fileId,
        requestBody: {
            role: 'reader',
            type: 'anyone'
        }
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

module.exports = { initDriveClient, uploadFile, isDriveAvailable, getOrCreateDayFolder };
