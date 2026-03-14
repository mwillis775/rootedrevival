/**
 * GrabNet P2P API - Drop-in replacement for fetch-based API calls
 * 
 * This module provides a seamless API that uses P2P when available,
 * falls back to HTTP, and caches everything locally.
 * 
 * Usage:
 *   import { api } from './grabnet-api.js';
 *   const papers = await api.browse({ type: 'paper', limit: 20 });
 *   const paper = await api.getPaper(uuid);
 *   const results = await api.search('quantum computing');
 */

import { initGrabNet, getGrabNet, ContentHash } from './grabnet-p2p.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_CONFIG = {
    API_BASE: 'https://scholar.rootedrevival.us/api',
    TIMEOUT: 30000,
    RETRY_COUNT: 3,
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes
};

// =============================================================================
// MEMORY CACHE (with TTL)
// =============================================================================

class MemoryCache {
    constructor(ttl = API_CONFIG.CACHE_TTL) {
        this.cache = new Map();
        this.ttl = ttl;
    }
    
    set(key, value) {
        this.cache.set(key, {
            value,
            expires: Date.now() + this.ttl,
        });
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return null;
        }
        return entry.value;
    }
    
    has(key) {
        return this.get(key) !== null;
    }
    
    clear() {
        this.cache.clear();
    }
    
    invalidate(pattern) {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }
}

const cache = new MemoryCache();

// =============================================================================
// P2P NODE REFERENCE
// =============================================================================

let p2pNode = null;
let initPromise = null;

/**
 * Ensure P2P node is initialized
 */
async function ensureP2P() {
    if (p2pNode?.isStarted) return p2pNode;
    
    if (!initPromise) {
        initPromise = initGrabNet({ 
            showUI: true,
            uiOptions: { position: 'bottom-right' }
        }).then(node => {
            p2pNode = node;
            return node;
        }).catch(error => {
            console.warn('[GrabNet API] P2P init failed, using HTTP fallback:', error);
            return null;
        });
    }
    
    return initPromise;
}

// Auto-init on module load
ensureP2P();

// =============================================================================
// HTTP FALLBACK
// =============================================================================

async function httpFetch(path, options = {}) {
    const url = path.startsWith('http') ? path : `${API_CONFIG.API_BASE}${path}`;
    
    const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
    }
    
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
        return response.json();
    }
    
    return response;
}

// =============================================================================
// UNIFIED API
// =============================================================================

export const api = {
    /**
     * Get current connection status
     */
    getStatus() {
        return p2pNode?.getStatus() || { mode: 'fallback', peerCount: 0 };
    },
    
    /**
     * Browse content with optional filters
     * @param {Object} options - { type, limit, offset, sort }
     */
    async browse(options = {}) {
        const { type, limit = 20, offset = 0, sort = 'newest' } = options;
        const cacheKey = `browse:${type || 'all'}:${limit}:${offset}:${sort}`;
        
        // Check cache first
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        // Try P2P first
        const node = await ensureP2P();
        if (node) {
            try {
                const results = await node.browse({ type, limit, offset });
                if (results?.length > 0) {
                    cache.set(cacheKey, results);
                    return results;
                }
            } catch (error) {
                console.warn('[API] P2P browse failed:', error);
            }
        }
        
        // Fall back to HTTP
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });
        if (type) params.set('type', type);
        if (sort) params.set('sort', sort);
        
        const data = await httpFetch(`/papers?${params}`);
        const results = data?.papers || data || [];
        cache.set(cacheKey, results);
        
        return results;
    },
    
    /**
     * Get a single paper by UUID
     * @param {string} uuid - Paper UUID
     */
    async getPaper(uuid) {
        const cacheKey = `paper:${uuid}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        // Try P2P
        const node = await ensureP2P();
        if (node) {
            try {
                const result = await node.fetchContent(uuid);
                if (result) {
                    cache.set(cacheKey, result);
                    return result;
                }
            } catch (error) {
                console.warn('[API] P2P fetch failed:', error);
            }
        }
        
        // HTTP fallback
        const paper = await httpFetch(`/papers/${uuid}`);
        cache.set(cacheKey, paper);
        return paper;
    },
    
    /**
     * Search content
     * @param {string} query - Search query
     * @param {Object} options - { type, limit, sort }
     */
    async search(query, options = {}) {
        const { type, limit = 20, sort = 'relevance' } = options;
        const cacheKey = `search:${query}:${type || 'all'}:${limit}:${sort}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        // Try P2P distributed search
        const node = await ensureP2P();
        if (node) {
            try {
                const results = await node.search(query, { type, limit });
                if (results?.length > 0) {
                    cache.set(cacheKey, results);
                    return results;
                }
            } catch (error) {
                console.warn('[API] P2P search failed:', error);
            }
        }
        
        // HTTP fallback
        const params = new URLSearchParams({
            q: query,
            limit: limit.toString(),
        });
        if (type) params.set('type', type);
        if (sort) params.set('sort', sort);
        
        const data = await httpFetch(`/browse/search?${params}`);
        const results = data?.papers || data || [];
        cache.set(cacheKey, results);
        
        return results;
    },
    
    /**
     * Get recent content
     * @param {Object} options - { limit, type }
     */
    async getRecent(options = {}) {
        const { limit = 10, type } = options;
        return this.browse({ limit, type, sort: 'newest' });
    },
    
    /**
     * Get trending content
     * @param {Object} options - { limit, type }
     */
    async getTrending(options = {}) {
        const { limit = 10, type } = options;
        return this.browse({ limit, type, sort: 'trending' });
    },
    
    /**
     * Get content by tag
     * @param {string} tag - Tag name
     * @param {Object} options - { limit }
     */
    async getByTag(tag, options = {}) {
        const { limit = 20 } = options;
        const cacheKey = `tag:${tag}:${limit}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        const data = await httpFetch(`/browse/tag/${encodeURIComponent(tag)}?limit=${limit}`);
        const results = data?.papers || data || [];
        cache.set(cacheKey, results);
        
        return results;
    },
    
    /**
     * Download file content
     * @param {number|string} fileId - File ID
     * @param {Object} options - { cid, asBlob }
     */
    async downloadFile(fileId, options = {}) {
        const { cid, asBlob = true } = options;
        
        // Try P2P with CID
        const node = await ensureP2P();
        if (node && cid) {
            try {
                const data = await node.downloadFile(fileId, { cid });
                if (data) {
                    return asBlob ? new Blob([data]) : data;
                }
            } catch (error) {
                console.warn('[API] P2P download failed:', error);
            }
        }
        
        // HTTP fallback
        const response = await fetch(`${API_CONFIG.API_BASE}/files/${fileId}/stream`, {
            credentials: 'include',
        });
        
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        
        return asBlob ? response.blob() : response.arrayBuffer();
    },
    
    /**
     * Stream file content with progress
     * @param {number|string} fileId - File ID
     * @param {Function} onProgress - Progress callback (received, total)
     */
    async streamFile(fileId, onProgress) {
        const response = await fetch(`${API_CONFIG.API_BASE}/files/${fileId}/stream`, {
            credentials: 'include',
        });
        
        if (!response.ok) {
            throw new Error(`Stream failed: ${response.status}`);
        }
        
        const contentLength = +response.headers.get('Content-Length') || 0;
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            received += value.length;
            
            if (onProgress) {
                onProgress(received, contentLength);
            }
        }
        
        return new Blob(chunks);
    },
    
    /**
     * Upload content (paper + files)
     * @param {Object} metadata - Paper metadata
     * @param {File[]} files - Array of files to upload
     * @param {Function} onProgress - Progress callback
     */
    async upload(metadata, files = [], onProgress) {
        // Prepare form data
        const formData = new FormData();
        formData.append('metadata', JSON.stringify(metadata));
        
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }
        
        // Try P2P publish first
        const node = await ensureP2P();
        if (node && files.length === 1) {
            try {
                const result = await node.publish(metadata, files[0]);
                if (result) {
                    cache.invalidate('browse:');
                    cache.invalidate('search:');
                    return result;
                }
            } catch (error) {
                console.warn('[API] P2P publish failed:', error);
            }
        }
        
        // HTTP upload with progress
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (onProgress && e.lengthComputable) {
                    onProgress(e.loaded, e.total);
                }
            });
            
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    cache.invalidate('browse:');
                    cache.invalidate('search:');
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    reject(new Error(`Upload failed: ${xhr.status}`));
                }
            });
            
            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            
            xhr.open('POST', `${API_CONFIG.API_BASE}/papers`);
            xhr.withCredentials = true;
            xhr.send(formData);
        });
    },
    
    /**
     * Get citations for a paper
     * @param {string} uuid - Paper UUID
     */
    async getCitations(uuid) {
        const cacheKey = `citations:${uuid}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        const citations = await httpFetch(`/papers/${uuid}/citations`);
        cache.set(cacheKey, citations);
        
        return citations;
    },
    
    /**
     * Get reviews for a paper
     * @param {string} uuid - Paper UUID
     */
    async getReviews(uuid) {
        const cacheKey = `reviews:${uuid}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        const reviews = await httpFetch(`/reviews/${uuid}`);
        cache.set(cacheKey, reviews);
        
        return reviews;
    },
    
    /**
     * Submit a review
     * @param {string} uuid - Paper UUID
     * @param {Object} review - Review data
     */
    async submitReview(uuid, review) {
        const result = await httpFetch(`/reviews/${uuid}`, {
            method: 'POST',
            body: JSON.stringify(review),
        });
        
        cache.invalidate(`reviews:${uuid}`);
        return result;
    },
    
    /**
     * Get user profile
     * @param {string} username - Username
     */
    async getProfile(username) {
        const cacheKey = `profile:${username}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        const profile = await httpFetch(`/users/${username}`);
        cache.set(cacheKey, profile);
        
        return profile;
    },
    
    /**
     * Get current user (auth check)
     */
    async getCurrentUser() {
        try {
            return await httpFetch('/auth/me');
        } catch (error) {
            if (error.status === 401) return null;
            throw error;
        }
    },
    
    /**
     * Get all tags with counts
     */
    async getTags() {
        const cacheKey = 'tags:all';
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        const tags = await httpFetch('/tags');
        cache.set(cacheKey, tags);
        
        return tags;
    },
    
    /**
     * Get disciplines/categories
     */
    async getDisciplines() {
        const cacheKey = 'disciplines:all';
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        const disciplines = await httpFetch('/disciplines');
        cache.set(cacheKey, disciplines);
        
        return disciplines;
    },
    
    /**
     * Clear all caches
     */
    clearCache() {
        cache.clear();
    },
    
    /**
     * Get the raw P2P node for advanced operations
     */
    async getP2PNode() {
        return ensureP2P();
    },
};

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export { ContentHash };

// Global export for non-module scripts
if (typeof window !== 'undefined') {
    window.GrabNetAPI = api;
}
