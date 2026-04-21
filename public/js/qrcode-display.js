/**
 * MRA 360 — QR Code Display
 * Gerencia a exibição do QR Code e resultado.
 */
class QRCodeDisplay {
    constructor() {
        this.qrImage = document.getElementById('qr-image');
        this.btnNewRecording = document.getElementById('btn-new-recording');
    }

    /**
     * Exibe o QR Code na tela.
     * @param {string} dataUrl - Data URL base64 da imagem do QR Code
     */
    show(dataUrl) {
        this.qrImage.src = dataUrl;
        this.qrImage.classList.add('fade-in');
    }

    /**
     * Limpa o QR Code.
     */
    clear() {
        this.qrImage.src = '';
        this.qrImage.classList.remove('fade-in');
    }
}

// Exportar globalmente
window.QRCodeDisplay = QRCodeDisplay;
