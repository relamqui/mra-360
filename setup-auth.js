const { google } = require('googleapis');
const fs = require('fs');
const http = require('http');
const url = require('url');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, 'config');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'oauth2-credentials.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];

if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR);
}

if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('\n=============================================================');
    console.log('❌ O arquivo oauth2-credentials.json não foi encontrado!');
    console.log('=============================================================');
    console.log('\nSiga estas instruções no Google Cloud Console:');
    console.log('1. Vá em "APIs e Serviços" -> "Tela de Consentimento OAuth"');
    console.log('   - Crie como "Externo" e preencha os dados obrigatórios.');
    console.log('   - Adicione o seu email @gmail.com em "Usuários de Teste".');
    console.log('2. Vá em "Credenciais" -> "Criar Credenciais" -> "ID do cliente OAuth"');
    console.log('   - Tipo: "App para computador" (Desktop app) ou "Aplicativo da Web".');
    console.log('   - (Se Web, adicione "http://localhost:3000" como URI de redirecionamento).');
    console.log('3. Baixe o JSON gerado.');
    console.log('4. Renomeie o arquivo baixado para exatos "oauth2-credentials.json".');
    console.log('5. Coloque esse arquivo na sua pasta "config/".');
    console.log('\nDepois, rode este script novamente: node setup-auth.js\n');
    process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web || {};

if (!client_id || !client_secret) {
    console.log('\n[ERRO] Credenciais inválidas no arquivo oauth2-credentials.json. Baixou o arquivo certo?');
    process.exit(1);
}

// Suporte tanto para credenciais Desktop App quanto Web App
let redirectUri = 'http://localhost:3000';
if (redirect_uris && redirect_uris.length > 0 && redirect_uris[0].startsWith('http')) {
    redirectUri = redirect_uris[0];
}

const parsedUrl = new URL(redirectUri);
const PORT = parsedUrl.port || 3000;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // Crucial: nos dá o refresh_token perpétuo
    scope: SCOPES,
    prompt: 'consent'       // Força sempre pedir consentimento para garantir o refresh_token
});

console.log('\n===================================================');
console.log('🔗 AUTORIZAÇÃO DO GOOGLE DRIVE (MRA 360)');
console.log('===================================================\n');

const server = http.createServer(async (req, res) => {
    try {
        if (req.url.indexOf('/favicon.ico') > -1) {
            res.writeHead(204);
            return res.end();
        }

        const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
        const code = qs.get('code');
        const error = qs.get('error');

        if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h1 style="color: #4CAF50;">✅ Autorização Concluída!</h1>
                    <p>Você já pode fechar esta aba e voltar para o terminal do MRA 360.</p>
                </div>
            `);
            
            console.log('\nGerando tokens de acesso permanente...');
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
            console.log('\n✅ SUCESSO! Tokens gerados e salvos em: config/tokens.json');
            console.log('Tudo pronto! Seu App vai fazer upload usando o espaço do seu Gmail.');
            console.log('Você pode rodar o iniciar_servidor.bat normalmente agora.\n');
            
            // Fecha o servidor temporário
            setTimeout(() => {
                if(server.closeAllConnections) server.closeAllConnections();
                server.close(() => process.exit(0));
            }, 1000);
            
        } else if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h1>Erro na autorização: ${error}</h1>`);
            console.error('\n❌ Erro retornado pelo Google:', error);
            process.exit(1);
        } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Requisicao ignorada.</h1>');
        }
    } catch (err) {
        console.error('Erro interno:', err);
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[ERRO] A porta ${PORT} já está em uso.`);
        console.error('Pare o iniciar_servidor.bat se ele estiver rodando antes de fazer a autenticação.');
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`Pressione Ctrl+clique no link abaixo para abrir o seu navegador:\n`);
    console.log(authUrl);
    console.log(`\n(Aguardando você fazer login e dar permissão na porta ${PORT}...)\n`);
});
