const QRCode = require('qrcode');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'logo.png');

/**
 * Gera um QR Code com a logo MRA Eventos no centro.
 * @param {string} url - URL para codificar no QR Code
 * @param {number} [size=600] - Tamanho do QR Code em pixels
 * @returns {Promise<string>} Data URL base64 da imagem
 */
async function generateQRCode(url, size = 600) {
    // Gerar QR Code como buffer PNG
    const qrBuffer = await QRCode.toBuffer(url, {
        errorCorrectionLevel: 'H', // High error correction (suporta logo no centro)
        width: size,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF'
        }
    });

    // Verificar se existe logo
    if (fs.existsSync(LOGO_PATH)) {
        try {
            const logoSize = Math.round(size * 0.22); // Logo ocupa ~22% do QR

            // Criar fundo branco arredondado para a logo
            const logoPadding = 8;
            const logoWithBg = await sharp(LOGO_PATH)
                .resize(logoSize - logoPadding * 2, logoSize - logoPadding * 2, {
                    fit: 'contain',
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                })
                .extend({
                    top: logoPadding,
                    bottom: logoPadding,
                    left: logoPadding,
                    right: logoPadding,
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                })
                .png()
                .toBuffer();

            // Sobrepor logo no centro do QR Code
            const result = await sharp(qrBuffer)
                .composite([{
                    input: logoWithBg,
                    gravity: 'centre'
                }])
                .png()
                .toBuffer();

            return `data:image/png;base64,${result.toString('base64')}`;
        } catch (err) {
            console.warn('[QR] Erro ao adicionar logo, gerando QR sem logo:', err.message);
        }
    } else {
        console.warn('[QR] Logo não encontrada em:', LOGO_PATH);
    }

    // Fallback: QR sem logo
    return `data:image/png;base64,${qrBuffer.toString('base64')}`;
}

module.exports = { generateQRCode };
