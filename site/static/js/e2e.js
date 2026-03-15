/**
 * Rooted Revival — End-to-End Encryption Module
 * 
 * Uses Web Crypto API (RSA-OAEP + AES-256-GCM).
 * Public keys stored on server, private keys in browser localStorage.
 * Server never sees plaintext message content.
 */
const E2E = (function() {
    const ALGO_RSA = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' };
    const ALGO_AES = { name: 'AES-GCM', length: 256 };
    const STORAGE_KEY = 'e2e_privkey';

    function b64encode(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
    }

    function b64decode(str) {
        const bin = atob(str);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    }

    /** Generate a new RSA-OAEP keypair */
    async function generateKeypair() {
        return crypto.subtle.generateKey(ALGO_RSA, true, ['encrypt', 'decrypt']);
    }

    /** Export public key as base64 JWK JSON string */
    async function exportPublicKey(keypair) {
        const jwk = await crypto.subtle.exportKey('jwk', keypair.publicKey);
        return JSON.stringify(jwk);
    }

    /** Export private key as base64 JWK JSON string */
    async function exportPrivateKey(keypair) {
        const jwk = await crypto.subtle.exportKey('jwk', keypair.privateKey);
        return JSON.stringify(jwk);
    }

    /** Import a public key from JWK JSON string */
    async function importPublicKey(jwkStr) {
        const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr;
        return crypto.subtle.importKey('jwk', jwk, ALGO_RSA, false, ['encrypt']);
    }

    /** Import a private key from JWK JSON string */
    async function importPrivateKey(jwkStr) {
        const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr;
        return crypto.subtle.importKey('jwk', jwk, ALGO_RSA, true, ['decrypt']);
    }

    /** Save private key to localStorage */
    function savePrivateKey(jwkStr) {
        localStorage.setItem(STORAGE_KEY, jwkStr);
    }

    /** Load private key from localStorage */
    function loadPrivateKey() {
        return localStorage.getItem(STORAGE_KEY);
    }

    /** Check if user has a stored private key */
    function hasPrivateKey() {
        return !!localStorage.getItem(STORAGE_KEY);
    }

    /**
     * Encrypt a message string using recipient's public key.
     * Returns JSON string: { e2e:true, k:<wrapped AES key>, iv:<iv>, d:<ciphertext> }
     */
    async function encrypt(plaintext, recipientPubKeyStr) {
        const pubKey = await importPublicKey(recipientPubKeyStr);

        // Generate random AES-256-GCM key
        const aesKey = await crypto.subtle.generateKey(ALGO_AES, true, ['encrypt']);
        const rawAes = await crypto.subtle.exportKey('raw', aesKey);

        // Wrap AES key with RSA-OAEP
        const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, rawAes);

        // Encrypt plaintext with AES-GCM
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

        return JSON.stringify({
            e2e: true,
            k: b64encode(wrappedKey),
            iv: b64encode(iv),
            d: b64encode(ciphertext)
        });
    }

    /**
     * Decrypt an encrypted message JSON string using own private key.
     * Returns plaintext string.
     */
    async function decrypt(encryptedJson, privKeyStr) {
        const data = typeof encryptedJson === 'string' ? JSON.parse(encryptedJson) : encryptedJson;
        if (!data.e2e) return typeof encryptedJson === 'string' ? encryptedJson : JSON.stringify(encryptedJson);

        privKeyStr = privKeyStr || loadPrivateKey();
        if (!privKeyStr) throw new Error('No private key available. Check your browser or import your key.');

        const privKey = await importPrivateKey(privKeyStr);

        // Unwrap AES key
        const wrappedKey = b64decode(data.k);
        const rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, wrappedKey);
        const aesKey = await crypto.subtle.importKey('raw', rawAes, ALGO_AES, false, ['decrypt']);

        // Decrypt ciphertext
        const iv = b64decode(data.iv);
        const ciphertext = b64decode(data.d);
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);

        return new TextDecoder().decode(plainBuf);
    }

    /** Check if a message body is E2E encrypted */
    function isEncrypted(body) {
        if (!body) return false;
        try {
            const d = typeof body === 'string' ? JSON.parse(body) : body;
            return d && d.e2e === true;
        } catch { return false; }
    }

    /**
     * Initialize E2E for the current user.
     * Generates keypair if needed, uploads public key to server.
     * Returns { publicKey, privateKey } JWK strings.
     */
    async function init(apiBase) {
        let privKeyStr = loadPrivateKey();
        if (privKeyStr) {
            // Already have a key — check if server has our pubkey
            return { privateKey: privKeyStr, existing: true };
        }

        // Generate new keypair
        const keypair = await generateKeypair();
        const pubStr = await exportPublicKey(keypair);
        privKeyStr = await exportPrivateKey(keypair);

        // Save private key locally
        savePrivateKey(privKeyStr);

        // Upload public key to server
        await fetch(`${apiBase}/api/users/me/pubkey`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: pubStr })
        });

        return { publicKey: pubStr, privateKey: privKeyStr, generated: true };
    }

    /** Export private key as downloadable backup file */
    function exportKeyBackup() {
        const key = loadPrivateKey();
        if (!key) throw new Error('No key to export');
        const blob = new Blob([key], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rootedrevival-privkey.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    /** Import private key from file content string */
    async function importKeyBackup(jwkStr) {
        // Validate it's a real key
        await importPrivateKey(jwkStr);
        savePrivateKey(jwkStr);
    }

    return {
        init,
        encrypt,
        decrypt,
        isEncrypted,
        hasPrivateKey,
        loadPrivateKey,
        exportKeyBackup,
        importKeyBackup,
        importPublicKey,
        generateKeypair,
        exportPublicKey,
        exportPrivateKey
    };
})();
