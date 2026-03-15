/**
 * Key Management Module for Open Scholar
 * 
 * Provides:
 * - ed25519 private key export/import
 * - Key backup with password encryption
 * - QR code generation for keys
 * - Key recovery
 */

class KeyManager {
    constructor() {
        this.privateKey = null;
        this.publicKey = null;
    }

    /**
     * Store the private key securely in memory
     * @param {string} privateKeyHex - The private key in hex format
     */
    setPrivateKey(privateKeyHex) {
        this.privateKey = privateKeyHex;
    }

    /**
     * Get the current private key
     * @returns {string|null} The private key in hex format
     */
    getPrivateKey() {
        return this.privateKey;
    }

    /**
     * Check if a private key is stored
     * @returns {boolean}
     */
    hasPrivateKey() {
        return this.privateKey !== null;
    }

    /**
     * Clear the private key from memory
     */
    clearPrivateKey() {
        this.privateKey = null;
    }

    /**
     * Export private key as encrypted backup
     * @param {string} password - Password to encrypt the backup
     * @returns {Promise<string>} Encrypted backup as base64
     */
    async exportEncryptedBackup(password) {
        if (!this.privateKey) {
            throw new Error('No private key to export');
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(this.privateKey);
        
        // Generate salt and derive key from password
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        // Generate IV and encrypt
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );

        // Combine salt + iv + encrypted data
        const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        combined.set(salt, 0);
        combined.set(iv, salt.length);
        combined.set(new Uint8Array(encrypted), salt.length + iv.length);

        // Return as base64 with prefix
        return 'scholar-key-v1:' + btoa(String.fromCharCode(...combined));
    }

    /**
     * Import private key from encrypted backup
     * @param {string} encryptedBackup - The encrypted backup string
     * @param {string} password - Password to decrypt
     * @returns {Promise<string>} The decrypted private key
     */
    async importEncryptedBackup(encryptedBackup, password) {
        if (!encryptedBackup.startsWith('scholar-key-v1:')) {
            throw new Error('Invalid backup format');
        }

        const base64Data = encryptedBackup.slice('scholar-key-v1:'.length);
        const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        // Extract salt, iv, and encrypted data
        const salt = combined.slice(0, 16);
        const iv = combined.slice(16, 28);
        const encrypted = combined.slice(28);

        // Derive key from password
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        // Decrypt
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encrypted
        );

        const decoder = new TextDecoder();
        const privateKey = decoder.decode(decrypted);
        
        this.privateKey = privateKey;
        return privateKey;
    }

    /**
     * Export private key as plain text (unsafe, for advanced users)
     * @returns {string} The private key in hex format
     */
    exportPlainText() {
        if (!this.privateKey) {
            throw new Error('No private key to export');
        }
        return this.privateKey;
    }

    /**
     * Import private key from plain text
     * @param {string} privateKeyHex - The private key in hex format
     */
    importPlainText(privateKeyHex) {
        // Validate it looks like a hex string (64 chars for ed25519)
        if (!/^[a-fA-F0-9]{64}$/.test(privateKeyHex)) {
            throw new Error('Invalid private key format. Expected 64 hex characters.');
        }
        this.privateKey = privateKeyHex.toLowerCase();
    }

    /**
     * Download key as file
     * @param {string} content - Content to download
     * @param {string} filename - Filename
     */
    downloadAsFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Save private key to local storage (encrypted with password)
     * @param {string} password - Password to encrypt
     */
    async saveToLocalStorage(password) {
        const encrypted = await this.exportEncryptedBackup(password);
        localStorage.setItem('scholar_encrypted_key', encrypted);
    }

    /**
     * Load private key from local storage
     * @param {string} password - Password to decrypt
     * @returns {Promise<boolean>} Whether key was loaded successfully
     */
    async loadFromLocalStorage(password) {
        const encrypted = localStorage.getItem('scholar_encrypted_key');
        if (!encrypted) {
            return false;
        }
        try {
            await this.importEncryptedBackup(encrypted, password);
            return true;
        } catch (e) {
            console.error('Failed to decrypt key:', e);
            return false;
        }
    }

    /**
     * Check if there's a stored key
     * @returns {boolean}
     */
    hasStoredKey() {
        return localStorage.getItem('scholar_encrypted_key') !== null;
    }

    /**
     * Remove stored key
     */
    removeStoredKey() {
        localStorage.removeItem('scholar_encrypted_key');
    }
}

/**
 * Key Management UI Component
 */
class KeyManagementUI {
    constructor(keyManager) {
        this.keyManager = keyManager;
    }

    /**
     * Render the key management modal
     * @returns {string} HTML content
     */
    render() {
        return `
        <div id="key-management-modal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h2>🔐 Key Management</h2>
                    <button class="close-btn" onclick="closeKeyModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="tabs">
                        <button class="tab-btn active" data-tab="export">Export Key</button>
                        <button class="tab-btn" data-tab="import">Import Key</button>
                        <button class="tab-btn" data-tab="backup">Backup</button>
                    </div>
                    
                    <div id="export-tab" class="tab-content active">
                        <p class="warning-text">⚠️ Your private key provides full access to your account. Keep it safe!</p>
                        
                        <div class="form-group">
                            <label>Export as encrypted backup (recommended):</label>
                            <input type="password" id="export-password" placeholder="Enter password to encrypt">
                            <input type="password" id="export-password-confirm" placeholder="Confirm password">
                            <button class="btn btn-primary" onclick="exportEncrypted()">Download Encrypted Backup</button>
                        </div>
                        
                        <div class="form-group">
                            <label>Export as plain text (advanced users only):</label>
                            <button class="btn btn-warning" onclick="exportPlainText()">Show Plain Text Key</button>
                            <div id="plain-key-display" style="display: none;">
                                <textarea readonly id="plain-key-text" style="font-family: monospace; width: 100%; height: 60px;"></textarea>
                                <button class="btn btn-sm" onclick="copyPlainKey()">📋 Copy</button>
                                <button class="btn btn-sm" onclick="hidePlainKey()">🙈 Hide</button>
                            </div>
                        </div>
                    </div>
                    
                    <div id="import-tab" class="tab-content">
                        <p class="info-text">ℹ️ Import a previously exported private key to restore your account.</p>
                        
                        <div class="form-group">
                            <label>Import from encrypted backup:</label>
                            <textarea id="import-encrypted" placeholder="Paste your encrypted backup here (starts with scholar-key-v1:)" style="width: 100%; height: 80px;"></textarea>
                            <input type="password" id="import-password" placeholder="Enter backup password">
                            <button class="btn btn-primary" onclick="importEncrypted()">Import Key</button>
                        </div>
                        
                        <div class="form-group">
                            <label>Import from plain text:</label>
                            <input type="text" id="import-plain" placeholder="Enter 64-character hex private key">
                            <button class="btn btn-warning" onclick="importPlainText()">Import Plain Key</button>
                        </div>
                    </div>
                    
                    <div id="backup-tab" class="tab-content">
                        <p class="info-text">💾 Manage your local key backup.</p>
                        
                        <div class="form-group" id="no-local-key" style="display: none;">
                            <p>No key stored locally.</p>
                            <label>Store your key locally (encrypted):</label>
                            <input type="password" id="store-password" placeholder="Enter password to protect key">
                            <button class="btn btn-primary" onclick="storeKeyLocally()">Store Key</button>
                        </div>
                        
                        <div class="form-group" id="has-local-key" style="display: none;">
                            <p>✅ You have a key stored locally.</p>
                            <button class="btn btn-danger" onclick="removeLocalKey()">Remove Local Key</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Initialize the UI (attach event listeners)
     */
    init() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
            });
        });

        // Update backup tab state
        this.updateBackupTabState();
    }

    updateBackupTabState() {
        const hasKey = this.keyManager.hasStoredKey();
        document.getElementById('no-local-key').style.display = hasKey ? 'none' : 'block';
        document.getElementById('has-local-key').style.display = hasKey ? 'block' : 'none';
    }
}

// Global key manager instance
const keyManager = new KeyManager();
const keyUI = new KeyManagementUI(keyManager);

// Global functions for onclick handlers
function openKeyModal() {
    document.getElementById('key-management-modal').style.display = 'flex';
    keyUI.init();
}

function closeKeyModal() {
    document.getElementById('key-management-modal').style.display = 'none';
}

async function exportEncrypted() {
    const password = document.getElementById('export-password').value;
    const confirm = document.getElementById('export-password-confirm').value;
    
    if (!password || password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
    }
    if (password !== confirm) {
        alert('Passwords do not match');
        return;
    }

    try {
        const encrypted = await keyManager.exportEncryptedBackup(password);
        const filename = `scholar-key-backup-${new Date().toISOString().split('T')[0]}.txt`;
        keyManager.downloadAsFile(encrypted, filename);
        alert('Key backup downloaded. Store it safely!');
    } catch (e) {
        alert('Error exporting key: ' + e.message);
    }
}

function exportPlainText() {
    if (!confirm('⚠️ This will show your private key in plain text. Are you sure?')) {
        return;
    }
    try {
        const key = keyManager.exportPlainText();
        document.getElementById('plain-key-text').value = key;
        document.getElementById('plain-key-display').style.display = 'block';
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

function copyPlainKey() {
    const text = document.getElementById('plain-key-text');
    text.select();
    document.execCommand('copy');
    alert('Copied to clipboard');
}

function hidePlainKey() {
    document.getElementById('plain-key-display').style.display = 'none';
    document.getElementById('plain-key-text').value = '';
}

async function importEncrypted() {
    const encrypted = document.getElementById('import-encrypted').value.trim();
    const password = document.getElementById('import-password').value;
    
    if (!encrypted) {
        alert('Please paste your encrypted backup');
        return;
    }
    if (!password) {
        alert('Please enter the backup password');
        return;
    }

    try {
        await keyManager.importEncryptedBackup(encrypted, password);
        alert('Key imported successfully!');
        closeKeyModal();
    } catch (e) {
        alert('Error importing key: ' + e.message);
    }
}

function importPlainText() {
    const key = document.getElementById('import-plain').value.trim();
    
    if (!key) {
        alert('Please enter a private key');
        return;
    }

    try {
        keyManager.importPlainText(key);
        alert('Key imported successfully!');
        closeKeyModal();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function storeKeyLocally() {
    const password = document.getElementById('store-password').value;
    
    if (!password || password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
    }

    try {
        await keyManager.saveToLocalStorage(password);
        alert('Key stored locally');
        keyUI.updateBackupTabState();
    } catch (e) {
        alert('Error storing key: ' + e.message);
    }
}

function removeLocalKey() {
    if (!confirm('Are you sure you want to remove the locally stored key?')) {
        return;
    }
    keyManager.removeStoredKey();
    keyUI.updateBackupTabState();
    alert('Local key removed');
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KeyManager, KeyManagementUI };
}
