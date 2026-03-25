/**
 * Rooted Revival — End-to-End Encryption Module (v2)
 *
 * Password-wrapped key storage: private keys are encrypted with a
 * password-derived AES key (PBKDF2) and stored on the server.
 * Keys are unlocked client-side during login — the server never sees
 * the plaintext private key or the user's password-derived wrapping key.
 *
 * Messages use dual-wrapping: the per-message AES key is wrapped with
 * both the sender's and recipient's RSA public keys so either party
 * can decrypt.
 *
 * Backward-compatible with v1 messages ({ e2e: true, k, iv, d }).
 */
const E2E = (function () {
    const ALGO_RSA = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    const ALGO_AES = { name: 'AES-GCM', length: 256 };
    const PRIV_KEY   = 'e2e_privkey';
    const PUB_KEY    = 'e2e_pubkey';

    /* ── helpers ─────────────────────────────────────────────── */

    function b64encode(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
    }

    function b64decode(str) {
        const bin = atob(str);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    }

    function importPublicKey(jwkStr) {
        const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr;
        return crypto.subtle.importKey('jwk', jwk, ALGO_RSA, false, ['encrypt']);
    }

    function importPrivateKey(jwkStr) {
        const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr;
        return crypto.subtle.importKey('jwk', jwk, ALGO_RSA, true, ['decrypt']);
    }

    /* ── PBKDF2 wrapping key derivation ─────────────────────── */

    async function deriveWrappingKey(password, saltB64) {
        const enc = new TextEncoder();
        const material = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: b64decode(saltB64), iterations: 600000, hash: 'SHA-256' },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function wrapKey(plainJwkStr, wrappingKey) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, wrappingKey, new TextEncoder().encode(plainJwkStr)
        );
        return JSON.stringify({ iv: b64encode(iv), data: b64encode(ct) });
    }

    async function unwrapKey(wrappedJson, wrappingKey) {
        const w = typeof wrappedJson === 'string' ? JSON.parse(wrappedJson) : wrappedJson;
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64decode(w.iv) }, wrappingKey, b64decode(w.data)
        );
        return new TextDecoder().decode(plain);
    }

    /* ── key lifecycle ──────────────────────────────────────── */

    /**
     * Generate a fresh RSA keypair, wrap the private key with password.
     * Stores the unwrapped private + public key in localStorage.
     * Returns { publicKey, encryptedPrivateKey, keySalt } for server upload.
     */
    async function generateAndWrapKeys(password) {
        const kp = await crypto.subtle.generateKey(ALGO_RSA, true, ['encrypt', 'decrypt']);
        const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
        const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
        const publicKey = JSON.stringify(pubJwk);
        const privateKey = JSON.stringify(privJwk);

        const salt = crypto.getRandomValues(new Uint8Array(32));
        const keySalt = b64encode(salt);
        const wk = await deriveWrappingKey(password, keySalt);
        const encryptedPrivateKey = await wrapKey(privateKey, wk);

        localStorage.setItem(PRIV_KEY, privateKey);
        localStorage.setItem(PUB_KEY, publicKey);

        return { publicKey, encryptedPrivateKey, keySalt };
    }

    /**
     * Migrate an existing localStorage-only key into the new system.
     * Wraps the current private key with password for server storage.
     */
    async function migrateExistingKey(password) {
        const privateKey = localStorage.getItem(PRIV_KEY);
        if (!privateKey) throw new Error('No existing key to migrate');

        // Validate the key is usable
        await importPrivateKey(privateKey);

        // Extract public key from private JWK
        const priv = JSON.parse(privateKey);
        const pubJwk = { kty: priv.kty, n: priv.n, e: priv.e, alg: priv.alg, ext: true, key_ops: ['encrypt'] };
        const publicKey = JSON.stringify(pubJwk);

        const salt = crypto.getRandomValues(new Uint8Array(32));
        const keySalt = b64encode(salt);
        const wk = await deriveWrappingKey(password, keySalt);
        const encryptedPrivateKey = await wrapKey(privateKey, wk);

        localStorage.setItem(PUB_KEY, publicKey);

        return { publicKey, encryptedPrivateKey, keySalt };
    }

    /**
     * Unlock a server-stored encrypted private key using the user's password.
     * Stores the unwrapped key in localStorage.
     */
    async function unlockPrivateKey(password, encryptedPrivateKey, keySalt, publicKey) {
        const wk = await deriveWrappingKey(password, keySalt);
        const privateKey = await unwrapKey(encryptedPrivateKey, wk);

        // Validate
        await importPrivateKey(privateKey);

        localStorage.setItem(PRIV_KEY, privateKey);
        if (publicKey) localStorage.setItem(PUB_KEY, publicKey);

        return privateKey;
    }

    /**
     * Re-wrap the current private key with a new password.
     * Call this before a password-change request so the server stores
     * a version wrapped with the new password.
     */
    async function rewrapWithNewPassword(newPassword) {
        const privateKey = localStorage.getItem(PRIV_KEY);
        if (!privateKey) throw new Error('No private key to re-wrap');

        const salt = crypto.getRandomValues(new Uint8Array(32));
        const keySalt = b64encode(salt);
        const wk = await deriveWrappingKey(newPassword, keySalt);
        const encryptedPrivateKey = await wrapKey(privateKey, wk);

        return { publicKey: localStorage.getItem(PUB_KEY), encryptedPrivateKey, keySalt };
    }

    /* ── message encryption / decryption ────────────────────── */

    /**
     * Encrypt plaintext for both sender and recipient (dual-wrap).
     * Returns a JSON string with e2e:2 format.
     */
    async function encrypt(plaintext, recipientPubKeyStr) {
        const senderPriv = localStorage.getItem(PRIV_KEY);
        const senderPub  = localStorage.getItem(PUB_KEY);
        if (!senderPriv || !senderPub) throw new Error('E2E keys not unlocked. Log in again.');

        const recipientKey = await importPublicKey(recipientPubKeyStr);
        const senderKey    = await importPublicKey(senderPub);

        const aesKey = await crypto.subtle.generateKey(ALGO_AES, true, ['encrypt']);
        const rawAes = await crypto.subtle.exportKey('raw', aesKey);

        const rk = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientKey, rawAes);
        const sk = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, senderKey, rawAes);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext)
        );

        return JSON.stringify({ e2e: 2, rk: b64encode(rk), sk: b64encode(sk), iv: b64encode(iv), d: b64encode(ct) });
    }

    /**
     * Decrypt either v1 ({ e2e:true, k }) or v2 ({ e2e:2, rk, sk }) messages.
     */
    async function decrypt(encryptedJson) {
        const data = typeof encryptedJson === 'string' ? JSON.parse(encryptedJson) : encryptedJson;
        if (!data.e2e) return typeof encryptedJson === 'string' ? encryptedJson : JSON.stringify(encryptedJson);

        const privKeyStr = localStorage.getItem(PRIV_KEY);
        if (!privKeyStr) throw new Error('No private key. Log in again to unlock.');

        const privKey = await importPrivateKey(privKeyStr);
        let rawAes;

        if (data.e2e === 2) {
            for (const f of ['rk', 'sk']) {
                if (!data[f]) continue;
                try { rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, b64decode(data[f])); break; }
                catch { /* try next */ }
            }
            if (!rawAes) throw new Error('Cannot decrypt — wrong key');
        } else {
            rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, b64decode(data.k));
        }

        const aesKey = await crypto.subtle.importKey('raw', rawAes, ALGO_AES, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(data.iv) }, aesKey, b64decode(data.d));
        return new TextDecoder().decode(plain);
    }

    /** Check if a message body is E2E encrypted (v1 or v2) */
    function isEncrypted(body) {
        if (!body) return false;
        try {
            const d = typeof body === 'string' ? JSON.parse(body) : body;
            return d && (d.e2e === true || d.e2e === 2);
        } catch { return false; }
    }

    function hasPrivateKey() { return !!localStorage.getItem(PRIV_KEY); }
    function getPublicKey()  { return localStorage.getItem(PUB_KEY); }

    function clearKeys() {
        localStorage.removeItem(PRIV_KEY);
        localStorage.removeItem(PUB_KEY);
    }

    return {
        generateAndWrapKeys,
        migrateExistingKey,
        unlockPrivateKey,
        rewrapWithNewPassword,
        encrypt,
        decrypt,
        isEncrypted,
        hasPrivateKey,
        getPublicKey,
        clearKeys,
        importPublicKey,
    };
})();
