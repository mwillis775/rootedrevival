/**
 * File Encryption Module for Open Scholar
 * 
 * Provides client-side encryption before upload:
 * - AES-256-GCM encryption
 * - Key derivation from password
 * - Encrypted metadata
 * - Streaming encryption for large files
 */

class FileEncryption {
    constructor() {
        this.CHUNK_SIZE = 64 * 1024; // 64KB chunks
    }

    /**
     * Generate a random encryption key
     * @returns {Promise<CryptoKey>}
     */
    async generateKey() {
        return await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Derive an encryption key from a password
     * @param {string} password - User password
     * @param {Uint8Array} salt - Salt for key derivation
     * @returns {Promise<CryptoKey>}
     */
    async deriveKey(password, salt) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Export a CryptoKey to raw bytes
     * @param {CryptoKey} key 
     * @returns {Promise<Uint8Array>}
     */
    async exportKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return new Uint8Array(exported);
    }

    /**
     * Import raw bytes as a CryptoKey
     * @param {Uint8Array} keyBytes 
     * @returns {Promise<CryptoKey>}
     */
    async importKey(keyBytes) {
        return await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Encrypt a file
     * @param {File} file - The file to encrypt
     * @param {string} password - Password for encryption
     * @param {function} onProgress - Progress callback (0-1)
     * @returns {Promise<{encryptedFile: Blob, metadata: Object}>}
     */
    async encryptFile(file, password, onProgress = () => {}) {
        // Generate salt and IV
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Derive key from password
        const key = await this.deriveKey(password, salt);

        // Read file as ArrayBuffer
        const fileBuffer = await file.arrayBuffer();
        const data = new Uint8Array(fileBuffer);

        // Create header with original filename and MIME type
        const header = {
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            encrypted: true,
            version: 1
        };
        const headerJson = JSON.stringify(header);
        const headerBytes = new TextEncoder().encode(headerJson);
        const headerLength = new Uint32Array([headerBytes.length]);

        // Encrypt the file content
        onProgress(0.1);
        const encryptedContent = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        onProgress(0.8);

        // Encrypt the header
        const headerIv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedHeader = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: headerIv },
            key,
            headerBytes
        );

        // Combine: version(1) + salt(16) + iv(12) + headerIv(12) + headerLen(4) + encHeader + encContent
        const version = new Uint8Array([1]); // Format version
        const headerLenBytes = new Uint8Array(headerLength.buffer);
        const encHeaderBytes = new Uint8Array(encryptedHeader);
        const encContentBytes = new Uint8Array(encryptedContent);

        const totalSize = 1 + 16 + 12 + 12 + 4 + encHeaderBytes.length + encContentBytes.length;
        const combined = new Uint8Array(totalSize);
        
        let offset = 0;
        combined.set(version, offset); offset += 1;
        combined.set(salt, offset); offset += 16;
        combined.set(iv, offset); offset += 12;
        combined.set(headerIv, offset); offset += 12;
        combined.set(headerLenBytes, offset); offset += 4;
        combined.set(encHeaderBytes, offset); offset += encHeaderBytes.length;
        combined.set(encContentBytes, offset);

        onProgress(1);

        const encryptedFile = new Blob([combined], { type: 'application/x-scholar-encrypted' });
        
        return {
            encryptedFile,
            metadata: {
                originalName: file.name,
                originalSize: file.size,
                encryptedSize: combined.length,
                encrypted: true
            }
        };
    }

    /**
     * Decrypt a file
     * @param {Blob} encryptedBlob - The encrypted file
     * @param {string} password - Password for decryption
     * @param {function} onProgress - Progress callback (0-1)
     * @returns {Promise<{file: Blob, metadata: Object}>}
     */
    async decryptFile(encryptedBlob, password, onProgress = () => {}) {
        const buffer = await encryptedBlob.arrayBuffer();
        const data = new Uint8Array(buffer);

        // Parse the encrypted format
        let offset = 0;
        const version = data[offset]; offset += 1;
        
        if (version !== 1) {
            throw new Error(`Unsupported encryption format version: ${version}`);
        }

        const salt = data.slice(offset, offset + 16); offset += 16;
        const iv = data.slice(offset, offset + 12); offset += 12;
        const headerIv = data.slice(offset, offset + 12); offset += 12;
        const headerLen = new Uint32Array(data.slice(offset, offset + 4).buffer)[0]; offset += 4;
        const encryptedHeader = data.slice(offset, offset + headerLen); offset += headerLen;
        const encryptedContent = data.slice(offset);

        onProgress(0.1);

        // Derive key from password
        const key = await this.deriveKey(password, salt);

        onProgress(0.2);

        // Decrypt header
        let header;
        try {
            const decryptedHeader = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: headerIv },
                key,
                encryptedHeader
            );
            const headerJson = new TextDecoder().decode(decryptedHeader);
            header = JSON.parse(headerJson);
        } catch (e) {
            throw new Error('Invalid password or corrupted file');
        }

        onProgress(0.3);

        // Decrypt content
        let decryptedContent;
        try {
            decryptedContent = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encryptedContent
            );
        } catch (e) {
            throw new Error('Failed to decrypt file content');
        }

        onProgress(1);

        const decryptedFile = new Blob([decryptedContent], { type: header.mimeType });
        
        return {
            file: decryptedFile,
            metadata: header
        };
    }

    /**
     * Check if a file is encrypted
     * @param {Blob} file 
     * @returns {Promise<boolean>}
     */
    async isEncrypted(file) {
        if (file.type === 'application/x-scholar-encrypted') {
            return true;
        }

        // Check for magic bytes
        const header = file.slice(0, 1);
        const buffer = await header.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        
        // Version 1 encrypted files start with 0x01
        return bytes[0] === 1;
    }
}

/**
 * File Encryption UI Component
 */
class FileEncryptionUI {
    constructor(encryption) {
        this.encryption = encryption;
        this.encryptionEnabled = false;
        this.password = null;
    }

    /**
     * Toggle encryption for uploads
     * @param {boolean} enabled 
     */
    setEncryptionEnabled(enabled) {
        this.encryptionEnabled = enabled;
    }

    /**
     * Set the encryption password
     * @param {string} password 
     */
    setPassword(password) {
        this.password = password;
    }

    /**
     * Render encryption options for upload form
     * @returns {string} HTML content
     */
    renderUploadOptions() {
        return `
        <div class="encryption-options">
            <div class="form-check">
                <input type="checkbox" id="enable-encryption" class="form-check-input" onchange="toggleEncryption(this.checked)">
                <label for="enable-encryption" class="form-check-label">
                    🔒 Encrypt file before upload
                </label>
            </div>
            <div id="encryption-password-group" style="display: none; margin-top: 10px;">
                <p class="help-text">Files will be encrypted client-side before upload. Only you can decrypt them with this password.</p>
                <input type="password" id="encryption-password" placeholder="Enter encryption password" class="form-control">
                <input type="password" id="encryption-password-confirm" placeholder="Confirm password" class="form-control" style="margin-top: 5px;">
            </div>
        </div>
        `;
    }

    /**
     * Render decryption prompt
     * @returns {string} HTML content
     */
    renderDecryptionPrompt() {
        return `
        <div id="decryption-modal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h2>🔐 Decrypt File</h2>
                    <button class="close-btn" onclick="closeDecryptModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <p>This file is encrypted. Enter the password to decrypt it.</p>
                    <input type="password" id="decrypt-password" placeholder="Enter decryption password" class="form-control">
                    <div id="decrypt-progress" style="display: none; margin-top: 10px;">
                        <div class="progress-bar">
                            <div class="progress-fill" id="decrypt-progress-fill"></div>
                        </div>
                        <span id="decrypt-progress-text">Decrypting...</span>
                    </div>
                    <div style="margin-top: 15px;">
                        <button class="btn btn-primary" onclick="decryptAndDownload()">Decrypt & Download</button>
                        <button class="btn btn-secondary" onclick="closeDecryptModal()">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Process file before upload (encrypt if enabled)
     * @param {File} file 
     * @returns {Promise<{file: Blob|File, encrypted: boolean, metadata: Object}>}
     */
    async processFileForUpload(file) {
        if (!this.encryptionEnabled || !this.password) {
            return { file, encrypted: false, metadata: {} };
        }

        const result = await this.encryption.encryptFile(file, this.password, (progress) => {
            this.updateProgress(progress);
        });

        return {
            file: result.encryptedFile,
            encrypted: true,
            metadata: result.metadata
        };
    }

    updateProgress(progress) {
        const fill = document.getElementById('encrypt-progress-fill');
        if (fill) {
            fill.style.width = `${progress * 100}%`;
        }
    }
}

// Global instances
const fileEncryption = new FileEncryption();
const encryptionUI = new FileEncryptionUI(fileEncryption);

// Global functions for UI
function toggleEncryption(enabled) {
    encryptionUI.setEncryptionEnabled(enabled);
    document.getElementById('encryption-password-group').style.display = enabled ? 'block' : 'none';
}

function validateEncryptionPasswords() {
    const password = document.getElementById('encryption-password').value;
    const confirm = document.getElementById('encryption-password-confirm').value;
    
    if (password.length < 8) {
        throw new Error('Encryption password must be at least 8 characters');
    }
    if (password !== confirm) {
        throw new Error('Encryption passwords do not match');
    }
    
    encryptionUI.setPassword(password);
    return true;
}

// Decryption modal handlers
let pendingDecryptFile = null;
let pendingDecryptFilename = null;

function openDecryptModal(file, filename) {
    pendingDecryptFile = file;
    pendingDecryptFilename = filename;
    document.getElementById('decryption-modal').style.display = 'flex';
}

function closeDecryptModal() {
    pendingDecryptFile = null;
    pendingDecryptFilename = null;
    document.getElementById('decryption-modal').style.display = 'none';
    document.getElementById('decrypt-password').value = '';
}

async function decryptAndDownload() {
    const password = document.getElementById('decrypt-password').value;
    
    if (!password) {
        alert('Please enter the decryption password');
        return;
    }

    document.getElementById('decrypt-progress').style.display = 'block';

    try {
        const result = await fileEncryption.decryptFile(pendingDecryptFile, password, (progress) => {
            document.getElementById('decrypt-progress-fill').style.width = `${progress * 100}%`;
            document.getElementById('decrypt-progress-text').textContent = 
                progress < 1 ? 'Decrypting...' : 'Complete!';
        });

        // Download the decrypted file
        const url = URL.createObjectURL(result.file);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.metadata.filename || pendingDecryptFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        closeDecryptModal();
    } catch (e) {
        alert('Decryption failed: ' + e.message);
        document.getElementById('decrypt-progress').style.display = 'none';
    }
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FileEncryption, FileEncryptionUI };
}
