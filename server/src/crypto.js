/**
 * OpenSource Scholar - Cryptography Utilities
 * 
 * Password hashing, token generation, and secure comparisons.
 * Uses bcrypt for passwords and crypto for tokens.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('./config');

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
async function hashPassword(password) {
    return bcrypt.hash(password, config.bcryptRounds);
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @returns {Promise<boolean>} True if match
 */
async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}

/**
 * Generate a secure random token
 * @param {number} bytes - Number of random bytes (default 32)
 * @returns {string} Hex-encoded token
 */
function generateToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Hash a token for storage (SHA-256)
 * @param {string} token - Plain token
 * @returns {string} Hashed token
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a session token and its hash
 * @returns {{token: string, hash: string}} Token and its hash
 */
function generateSessionToken() {
    const token = generateToken(32);
    const hash = hashToken(token);
    return { token, hash };
}

/**
 * Hash a file content (SHA-256)
 * @param {Buffer} content - File content
 * @returns {string} Hex-encoded hash
 */
function hashFile(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Constant-time string comparison (prevents timing attacks)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if equal
 */
function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    
    if (bufA.length !== bufB.length) {
        return false;
    }
    
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Encrypt data with AES-256-GCM (for sensitive data at rest)
 * @param {string} plaintext - Data to encrypt
 * @param {string} key - 32-byte hex key
 * @returns {string} Encrypted data as base64 (iv:authTag:ciphertext)
 */
function encrypt(plaintext, key) {
    const keyBuffer = Buffer.from(key, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt data encrypted with AES-256-GCM
 * @param {string} encryptedData - Data from encrypt()
 * @param {string} key - 32-byte hex key
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedData, key) {
    const [ivB64, authTagB64, ciphertext] = encryptedData.split(':');
    
    const keyBuffer = Buffer.from(key, 'hex');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

/**
 * Generate a data encryption key
 * @returns {string} 32-byte hex key
 */
function generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateToken,
    hashToken,
    generateSessionToken,
    hashFile,
    secureCompare,
    encrypt,
    decrypt,
    generateEncryptionKey
};
