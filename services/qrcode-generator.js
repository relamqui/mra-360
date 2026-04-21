const QRCode = require('qrcode');

/**
 * Gera um QR Code simples.
 * @param {string} url - URL para codificar no QR Code
 * @param {number} [size=600] - Tamanho do QR Code em pixels
 * @returns {Promise<string>} Data URL base64 da imagem
 */
async function generateQRCode(url, size = 600) {
    const qrBuffer = await QRCode.toBuffer(url, {
        errorCorrectionLevel: 'M',
        width: size,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF'
        }
    });

    return `data:image/png;base64,${qrBuffer.toString('base64')}`;
}

module.exports = { generateQRCode };
