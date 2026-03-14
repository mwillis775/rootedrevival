/**
 * Rooted Revival - WebAuthn/U2F Authentication
 * 
 * Supports hardware security keys (Flipper Zero U2F, YubiKey, etc.)
 * for admin-level authentication. When a registered U2F key is present
 * and verified, the session is elevated to admin.
 * 
 * Uses the Web Authentication API (WebAuthn Level 2) with pure Node.js crypto.
 * No external WebAuthn libraries required.
 */

const crypto = require('crypto');
const { getDb } = require('./db/index');
const { hashToken } = require('./crypto');

// RP (Relying Party) configuration
const RP_NAME = 'Rooted Revival';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'rootedrevival.us';
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://rootedrevival.us';

// Challenge store (in-memory, short-lived)
const challengeStore = new Map();
const CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup old challenges periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of challengeStore) {
        if (now - val.created > CHALLENGE_TTL) {
            challengeStore.delete(key);
        }
    }
}, 60000);

/**
 * Initialize the webauthn_credentials table
 */
function initWebAuthnTable() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS webauthn_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            credential_id TEXT UNIQUE NOT NULL,
            public_key TEXT NOT NULL,
            sign_count INTEGER DEFAULT 0,
            device_name TEXT,
            aaguid TEXT,
            transports TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            last_used TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON webauthn_credentials(credential_id);
        CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
    `);
}

// --- CBOR Minimal Decoder ---
// WebAuthn attestation objects use CBOR encoding. We need a minimal decoder.

function decodeCBOR(buffer) {
    let offset = 0;
    
    function read(n) {
        const slice = buffer.slice(offset, offset + n);
        offset += n;
        return slice;
    }
    
    function readUint8() {
        return buffer[offset++];
    }
    
    function readUint16() {
        const val = buffer.readUInt16BE(offset);
        offset += 2;
        return val;
    }
    
    function readUint32() {
        const val = buffer.readUInt32BE(offset);
        offset += 4;
        return val;
    }
    
    function decodeItem() {
        const initial = readUint8();
        const majorType = initial >> 5;
        const additionalInfo = initial & 0x1f;
        
        let value = additionalInfo;
        if (additionalInfo === 24) value = readUint8();
        else if (additionalInfo === 25) value = readUint16();
        else if (additionalInfo === 26) value = readUint32();
        else if (additionalInfo === 27) {
            // 64-bit - read as number (may lose precision for very large values)
            const hi = readUint32();
            const lo = readUint32();
            value = hi * 0x100000000 + lo;
        }
        
        switch (majorType) {
            case 0: // unsigned integer
                return value;
            case 1: // negative integer
                return -1 - value;
            case 2: { // byte string
                return read(value);
            }
            case 3: { // text string
                return read(value).toString('utf8');
            }
            case 4: { // array
                const arr = [];
                for (let i = 0; i < value; i++) {
                    arr.push(decodeItem());
                }
                return arr;
            }
            case 5: { // map
                const map = {};
                for (let i = 0; i < value; i++) {
                    const key = decodeItem();
                    const val = decodeItem();
                    map[key] = val;
                }
                return map;
            }
            case 6: // tag (skip tag number, decode content)
                return decodeItem();
            case 7: { // simple/float
                if (additionalInfo === 20) return false;
                if (additionalInfo === 21) return true;
                if (additionalInfo === 22) return null;
                if (additionalInfo === 23) return undefined;
                if (additionalInfo === 25) {
                    // float16 - not common, skip
                    return 0;
                }
                if (additionalInfo === 26) {
                    // Already consumed 4 bytes as 'value', re-interpret as float32
                    const buf = Buffer.alloc(4);
                    buf.writeUInt32BE(value);
                    return buf.readFloatBE(0);
                }
                if (additionalInfo === 27) {
                    // float64
                    const buf = Buffer.alloc(8);
                    buf.writeDoubleBE(value);
                    return buf.readDoubleBE(0);
                }
                return value;
            }
            default:
                throw new Error(`Unknown CBOR major type: ${majorType}`);
        }
    }
    
    return decodeItem();
}

// --- COSE Key Parser ---
// Parse COSE_Key format to extract public key for verification

const COSE_KEYS = {
    kty: 1,
    alg: 3,
    crv: -1,
    x: -2,
    y: -3,
    n: -1,
    e: -2,
};

const COSE_ALG = {
    ES256: -7,   // ECDSA w/ SHA-256 (P-256)
    RS256: -257,  // RSASSA-PKCS1-v1_5 w/ SHA-256
    EdDSA: -8,   // EdDSA
};

function coseToPublicKeyPem(coseKeyMap) {
    const kty = coseKeyMap[COSE_KEYS.kty];
    const alg = coseKeyMap[COSE_KEYS.alg];
    
    if (kty === 2 && alg === COSE_ALG.ES256) {
        // EC2 key, P-256
        const x = coseKeyMap[COSE_KEYS.x];
        const y = coseKeyMap[COSE_KEYS.y];
        
        // Uncompressed point: 0x04 || x || y
        const publicKeyPoint = Buffer.concat([Buffer.from([0x04]), x, y]);
        
        // Wrap in SubjectPublicKeyInfo ASN.1 for P-256
        // SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING { public key } }
        const ecOid = Buffer.from('06072a8648ce3d0201', 'hex'); // OID 1.2.840.10045.2.1
        const p256Oid = Buffer.from('06082a8648ce3d030107', 'hex'); // OID 1.2.840.10045.3.1.7
        
        const algSeq = derSequence(Buffer.concat([ecOid, p256Oid]));
        const bitString = Buffer.concat([Buffer.from([0x03, publicKeyPoint.length + 1, 0x00]), publicKeyPoint]);
        const spki = derSequence(Buffer.concat([algSeq, bitString]));
        
        return {
            format: 'spki',
            key: spki,
            algorithm: 'ES256'
        };
    }
    
    if (kty === 3 && alg === COSE_ALG.RS256) {
        // RSA key
        const n = coseKeyMap[COSE_KEYS.n];
        const e = coseKeyMap[COSE_KEYS.e];
        
        const nInt = derInteger(n);
        const eInt = derInteger(e);
        const rsaSeq = derSequence(Buffer.concat([nInt, eInt]));
        
        const rsaOid = Buffer.from('06092a864886f70d010101', 'hex'); // OID 1.2.840.113549.1.1.1
        const nullParam = Buffer.from('0500', 'hex');
        const algSeq = derSequence(Buffer.concat([rsaOid, nullParam]));
        
        const bitString = Buffer.concat([Buffer.from([0x03, rsaSeq.length + 1, 0x00]), rsaSeq]);
        const spki = derSequence(Buffer.concat([algSeq, bitString]));
        
        return {
            format: 'spki',
            key: spki,
            algorithm: 'RS256'
        };
    }
    
    throw new Error(`Unsupported COSE key type: kty=${kty}, alg=${alg}`);
}

function derSequence(content) {
    return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
}

function derInteger(value) {
    let buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    // Ensure positive integer (leading zero if high bit set)
    if (buf[0] & 0x80) {
        buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return Buffer.concat([Buffer.from([0x02]), derLength(buf.length), buf]);
}

function derLength(length) {
    if (length < 128) return Buffer.from([length]);
    if (length < 256) return Buffer.from([0x81, length]);
    return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
}

// --- Base64URL helpers ---

function base64urlEncode(buffer) {
    return Buffer.from(buffer)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
}

// --- Registration ---

/**
 * Generate registration options for WebAuthn credential creation
 */
function generateRegistrationOptions(user) {
    const challenge = crypto.randomBytes(32);
    const challengeB64 = base64urlEncode(challenge);
    
    // Store challenge for verification
    challengeStore.set(challengeB64, {
        userId: user.id,
        type: 'registration',
        created: Date.now()
    });
    
    // Get existing credentials to exclude
    const db = getDb();
    const existing = db.prepare(
        'SELECT credential_id FROM webauthn_credentials WHERE user_id = ?'
    ).all(user.id);
    
    return {
        rp: {
            name: RP_NAME,
            id: RP_ID
        },
        user: {
            id: base64urlEncode(Buffer.from(String(user.id))),
            name: user.username,
            displayName: user.displayName || user.username
        },
        challenge: challengeB64,
        pubKeyCredParams: [
            { type: 'public-key', alg: COSE_ALG.ES256 },
            { type: 'public-key', alg: COSE_ALG.RS256 }
        ],
        timeout: 120000, // 2 minutes (Flipper Zero can be slow)
        authenticatorSelection: {
            // Don't require resident key - U2F keys (Flipper) don't support it
            residentKey: 'discouraged',
            requireResidentKey: false,
            userVerification: 'discouraged' // Flipper U2F doesn't have biometrics
        },
        attestation: 'direct',
        excludeCredentials: existing.map(c => ({
            type: 'public-key',
            id: c.credential_id,
            transports: ['usb', 'nfc'] // Flipper supports USB and NFC
        }))
    };
}

/**
 * Verify registration response and store credential
 */
function verifyRegistration(user, response, deviceName = 'Security Key') {
    const { id, rawId, response: authResponse, type } = response;
    
    if (type !== 'public-key') {
        throw new Error('Invalid credential type');
    }
    
    const { clientDataJSON, attestationObject } = authResponse;
    
    // Decode clientDataJSON
    const clientData = JSON.parse(Buffer.from(base64urlDecode(clientDataJSON)).toString('utf8'));
    
    // Verify challenge
    const storedChallenge = challengeStore.get(clientData.challenge);
    if (!storedChallenge || storedChallenge.type !== 'registration' || storedChallenge.userId !== user.id) {
        throw new Error('Invalid or expired challenge');
    }
    challengeStore.delete(clientData.challenge);
    
    // Verify origin
    if (clientData.type !== 'webauthn.create') {
        throw new Error('Invalid client data type');
    }
    
    // Allow localhost for development
    const allowedOrigins = [RP_ORIGIN, 'http://localhost:3000', 'http://localhost:8080'];
    if (!allowedOrigins.includes(clientData.origin)) {
        console.warn(`WebAuthn origin mismatch: expected ${RP_ORIGIN}, got ${clientData.origin}`);
        // Still allow - some setups proxy through different origins
    }
    
    // Decode attestation object (CBOR)
    const attestation = decodeCBOR(base64urlDecode(attestationObject));
    const authData = attestation.authData || attestation['authData'];
    
    if (!Buffer.isBuffer(authData)) {
        throw new Error('Invalid attestation: missing authData');
    }
    
    // Parse authenticator data
    const rpIdHash = authData.slice(0, 32);
    const flags = authData[32];
    const signCount = authData.readUInt32BE(33);
    
    // flags: bit 0 = user present, bit 2 = user verified, bit 6 = attested credential data
    const userPresent = !!(flags & 0x01);
    const attestedCredData = !!(flags & 0x40);
    
    if (!userPresent) {
        throw new Error('User presence not confirmed');
    }
    
    if (!attestedCredData) {
        throw new Error('No attested credential data in response');
    }
    
    // Parse attested credential data
    let offset = 37;
    const aaguid = authData.slice(offset, offset + 16);
    offset += 16;
    
    const credIdLength = authData.readUInt16BE(offset);
    offset += 2;
    
    const credentialId = authData.slice(offset, offset + credIdLength);
    offset += credIdLength;
    
    // Remaining bytes are the COSE public key
    const coseKeyBytes = authData.slice(offset);
    const coseKey = decodeCBOR(coseKeyBytes);
    
    // Convert COSE key to storable format
    const publicKeyInfo = coseToPublicKeyPem(coseKey);
    
    // Store credential
    const db = getDb();
    const credIdB64 = base64urlEncode(credentialId);
    
    db.prepare(`
        INSERT INTO webauthn_credentials 
        (user_id, credential_id, public_key, sign_count, device_name, aaguid, transports)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        user.id,
        credIdB64,
        JSON.stringify({
            key: publicKeyInfo.key.toString('base64'),
            algorithm: publicKeyInfo.algorithm
        }),
        signCount,
        deviceName,
        aaguid.toString('hex'),
        JSON.stringify(['usb', 'nfc'])
    );
    
    return {
        credentialId: credIdB64,
        deviceName,
        aaguid: aaguid.toString('hex')
    };
}

// --- Authentication ---

/**
 * Generate authentication options (challenge for signing)
 */
function generateAuthenticationOptions(userId = null) {
    const challenge = crypto.randomBytes(32);
    const challengeB64 = base64urlEncode(challenge);
    
    challengeStore.set(challengeB64, {
        userId,
        type: 'authentication',
        created: Date.now()
    });
    
    const options = {
        challenge: challengeB64,
        timeout: 120000,
        rpId: RP_ID,
        userVerification: 'discouraged' // Flipper Zero doesn't support UV
    };
    
    // If we know the user, only allow their credentials
    if (userId) {
        const db = getDb();
        const creds = db.prepare(
            'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?'
        ).all(userId);
        
        options.allowCredentials = creds.map(c => ({
            type: 'public-key',
            id: c.credential_id,
            transports: JSON.parse(c.transports || '["usb","nfc"]')
        }));
    }
    
    return options;
}

/**
 * Verify authentication response
 */
function verifyAuthentication(response) {
    const { id, rawId, response: authResponse, type } = response;
    
    if (type !== 'public-key') {
        throw new Error('Invalid credential type');
    }
    
    const { clientDataJSON, authenticatorData, signature } = authResponse;
    
    // Decode clientDataJSON
    const clientData = JSON.parse(Buffer.from(base64urlDecode(clientDataJSON)).toString('utf8'));
    
    // Verify challenge
    const storedChallenge = challengeStore.get(clientData.challenge);
    if (!storedChallenge || storedChallenge.type !== 'authentication') {
        throw new Error('Invalid or expired challenge');
    }
    challengeStore.delete(clientData.challenge);
    
    if (clientData.type !== 'webauthn.get') {
        throw new Error('Invalid client data type');
    }
    
    // Find credential in database
    const credIdB64 = typeof rawId === 'string' ? rawId : base64urlEncode(base64urlDecode(id));
    const db = getDb();
    
    const credential = db.prepare(`
        SELECT wc.*, u.id as uid, u.username, u.email, u.display_name, u.is_admin, u.is_moderator, u.is_banned
        FROM webauthn_credentials wc
        JOIN users u ON wc.user_id = u.id
        WHERE wc.credential_id = ?
    `).get(credIdB64);
    
    if (!credential) {
        throw new Error('Unknown credential');
    }
    
    if (credential.is_banned) {
        throw new Error('Account is banned');
    }
    
    // Verify if challenge was for specific user
    if (storedChallenge.userId && storedChallenge.userId !== credential.user_id) {
        throw new Error('Credential does not match expected user');
    }
    
    // Parse authenticator data
    const authDataBuf = base64urlDecode(authenticatorData);
    const flags = authDataBuf[32];
    const signCount = authDataBuf.readUInt32BE(33);
    
    const userPresent = !!(flags & 0x01);
    if (!userPresent) {
        throw new Error('User presence not confirmed');
    }
    
    // Verify signature
    const publicKeyInfo = JSON.parse(credential.public_key);
    const publicKeyDer = Buffer.from(publicKeyInfo.key, 'base64');
    
    // The signed data is: authenticatorData || SHA-256(clientDataJSON)
    const clientDataHash = crypto.createHash('sha256')
        .update(base64urlDecode(clientDataJSON))
        .digest();
    
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const sigBuf = base64urlDecode(signature);
    
    let verified = false;
    
    if (publicKeyInfo.algorithm === 'ES256') {
        // EC P-256 signature verification
        const keyObj = crypto.createPublicKey({
            key: publicKeyDer,
            format: 'der',
            type: 'spki'
        });
        
        verified = crypto.createVerify('SHA256')
            .update(signedData)
            .verify({ key: keyObj, dsaEncoding: 'ieee-p1363' }, convertDERtoP1363(sigBuf));
            
        // If that fails, try raw DER
        if (!verified) {
            verified = crypto.createVerify('SHA256')
                .update(signedData)
                .verify(keyObj, sigBuf);
        }
    } else if (publicKeyInfo.algorithm === 'RS256') {
        const keyObj = crypto.createPublicKey({
            key: publicKeyDer,
            format: 'der',
            type: 'spki'
        });
        
        verified = crypto.createVerify('SHA256')
            .update(signedData)
            .verify(keyObj, sigBuf);
    }
    
    if (!verified) {
        throw new Error('Signature verification failed');
    }
    
    // Check sign count (replay protection)
    if (signCount > 0 && signCount <= credential.sign_count) {
        console.warn(`WebAuthn: sign count not incremented for credential ${credIdB64}. Possible cloned key.`);
        // Don't fail for Flipper Zero which may not increment properly
    }
    
    // Update sign count and last_used
    db.prepare(`
        UPDATE webauthn_credentials 
        SET sign_count = ?, last_used = datetime('now')
        WHERE id = ?
    `).run(signCount, credential.id);
    
    return {
        user: {
            id: credential.uid,
            username: credential.username,
            email: credential.email,
            displayName: credential.display_name,
            isAdmin: !!credential.is_admin,
            isModerator: !!credential.is_moderator
        },
        credentialId: credIdB64,
        deviceName: credential.device_name
    };
}

/**
 * Convert DER-encoded ECDSA signature to IEEE P1363 format
 * WebAuthn typically sends DER, but Node.js verify with dsaEncoding ieee-p1363 expects raw r||s
 */
function convertDERtoP1363(derSig) {
    try {
        // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
        if (derSig[0] !== 0x30) return derSig; // Already P1363 or unknown format
        
        let offset = 2;
        if (derSig[1] & 0x80) offset += (derSig[1] & 0x7f);
        
        // Read r
        if (derSig[offset] !== 0x02) return derSig;
        offset++;
        const rLen = derSig[offset++];
        let r = derSig.slice(offset, offset + rLen);
        offset += rLen;
        
        // Read s
        if (derSig[offset] !== 0x02) return derSig;
        offset++;
        const sLen = derSig[offset++];
        let s = derSig.slice(offset, offset + sLen);
        
        // Normalize to 32 bytes each (P-256)
        if (r.length > 32) r = r.slice(r.length - 32);
        if (s.length > 32) s = s.slice(s.length - 32);
        if (r.length < 32) r = Buffer.concat([Buffer.alloc(32 - r.length), r]);
        if (s.length < 32) s = Buffer.concat([Buffer.alloc(32 - s.length), s]);
        
        return Buffer.concat([r, s]);
    } catch {
        return derSig;
    }
}

// --- Credential Management ---

function getUserCredentials(userId) {
    const db = getDb();
    return db.prepare(`
        SELECT id, credential_id, device_name, aaguid, transports, created_at, last_used, sign_count
        FROM webauthn_credentials
        WHERE user_id = ?
        ORDER BY created_at DESC
    `).all(userId);
}

function deleteCredential(userId, credentialId) {
    const db = getDb();
    const result = db.prepare(
        'DELETE FROM webauthn_credentials WHERE user_id = ? AND id = ?'
    ).run(userId, credentialId);
    return result.changes > 0;
}

function hasCredentials(userId) {
    const db = getDb();
    const row = db.prepare(
        'SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ?'
    ).get(userId);
    return row.count > 0;
}

module.exports = {
    initWebAuthnTable,
    generateRegistrationOptions,
    verifyRegistration,
    generateAuthenticationOptions,
    verifyAuthentication,
    getUserCredentials,
    deleteCredential,
    hasCredentials,
    base64urlEncode,
    base64urlDecode
};
