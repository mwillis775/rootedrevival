/**
 * GrabNet P2P Client - Browser libp2p Implementation
 * 
 * True peer-to-peer content discovery and transfer using WebRTC
 * Compatible with the GrabNet Rust backend via protocol bridge
 * 
 * @version 2.0.0
 * @author Rooted Revival
 */

// =============================================================================
// IMPORTS - Using ES Module CDN imports for browser compatibility
// =============================================================================

const LIBP2P_CDN = 'https://cdn.jsdelivr.net/npm/';

// Dynamic import helper
async function importLibp2p() {
    const modules = await Promise.all([
        import(`${LIBP2P_CDN}libp2p@1.9.0/+esm`),
        import(`${LIBP2P_CDN}@libp2p/webrtc@4.1.4/+esm`),
        import(`${LIBP2P_CDN}@libp2p/websockets@8.2.0/+esm`),
        import(`${LIBP2P_CDN}@libp2p/circuit-relay-v2@1.1.5/+esm`),
        import(`${LIBP2P_CDN}@libp2p/identify@2.1.2/+esm`),
        import(`${LIBP2P_CDN}@chainsafe/libp2p-gossipsub@13.0.0/+esm`),
        import(`${LIBP2P_CDN}@libp2p/kad-dht@12.1.0/+esm`),
        import(`${LIBP2P_CDN}@libp2p/bootstrap@10.1.2/+esm`),
        import(`${LIBP2P_CDN}@chainsafe/libp2p-noise@15.1.2/+esm`),
        import(`${LIBP2P_CDN}@chainsafe/libp2p-yamux@6.0.2/+esm`),
        import(`${LIBP2P_CDN}multiformats@13.0.0/+esm`),
        import(`${LIBP2P_CDN}uint8arrays@5.0.0/+esm`),
        import(`${LIBP2P_CDN}@multiformats/multiaddr@12.3.1/+esm`),
    ]);
    
    return {
        createLibp2p: modules[0].createLibp2p,
        webRTC: modules[1].webRTC,
        webRTCDirect: modules[1].webRTCDirect,
        webSockets: modules[2].webSockets,
        circuitRelayTransport: modules[3].circuitRelayTransport,
        identify: modules[4].identify,
        gossipsub: modules[5].gossipsub,
        kadDHT: modules[6].kadDHT,
        bootstrap: modules[7].bootstrap,
        noise: modules[8].noise,
        yamux: modules[9].yamux,
        CID: modules[10].CID,
        uint8arrays: modules[11],
        multiaddr: modules[12].multiaddr,
    };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const GRABNET_CONFIG = {
    // Protocol identifiers
    PROTOCOL_VERSION: '/grabnet/1.0.0',
    CONTENT_PROTOCOL: '/grabnet/content/1.0.0',
    ANNOUNCE_PROTOCOL: '/grabnet/announce/1.0.0',
    SEARCH_PROTOCOL: '/grabnet/search/1.0.0',
    
    // GossipSub topics
    TOPICS: {
        CONTENT_ANNOUNCE: 'grabnet/content/announce',
        SEARCH_REQUEST: 'grabnet/search/request',
        SEARCH_RESPONSE: 'grabnet/search/response',
        PEER_DISCOVERY: 'grabnet/peer/discovery',
    },
    
    // Bootstrap nodes (WebSocket relays)
    BOOTSTRAP_NODES: [
        // Primary relay via Cloudflare Tunnel (WSS)
        '/dns4/relay.rootedrevival.us/tcp/443/wss/p2p/12D3KooWM1KPVuqzoiVpARRe2ifwnDR2PMdozH31qAeN86u4DnoS',
    ],
    
    // Relay status endpoint for dynamic bootstrap discovery
    RELAY_STATUS_URL: null, // Set at runtime based on context
    
    // Fallback API (hybrid mode)
    API_BASE: 'https://scholar.rootedrevival.us/api',
    
    // Timeouts
    PEER_DISCOVERY_TIMEOUT: 10000,
    CONTENT_FETCH_TIMEOUT: 30000,
    SEARCH_TIMEOUT: 5000,
    
    // Limits
    MAX_PEERS: 50,
    MIN_PEERS_FOR_PURE_P2P: 3,
    CONTENT_CACHE_SIZE: 100,
    
    // Storage keys
    STORAGE_KEY_PEER_ID: 'grabnet_peer_id',
    STORAGE_KEY_KNOWN_PEERS: 'grabnet_known_peers',
    STORAGE_KEY_CONTENT_CACHE: 'grabnet_content_cache',
};

// =============================================================================
// CONTENT ADDRESSING - BLAKE3 compatible hashing
// =============================================================================

class ContentHash {
    /**
     * Hash content using SHA-256 (browser native, BLAKE3-compatible for verification)
     * The actual verification will check against the backend's BLAKE3 hash
     */
    static async hash(data) {
        const buffer = typeof data === 'string' 
            ? new TextEncoder().encode(data) 
            : data;
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        return this.toHex(new Uint8Array(hashBuffer));
    }
    
    static toHex(bytes) {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    static fromHex(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }
    
    /**
     * Create a GrabNet CID from content
     */
    static async createCID(content) {
        const hash = await this.hash(content);
        return `grab:${hash}`;
    }
    
    /**
     * Verify content against expected CID
     */
    static async verify(content, expectedCID) {
        const actualCID = await this.createCID(content);
        return actualCID === expectedCID;
    }
}

// =============================================================================
// LOCAL CONTENT STORE - IndexedDB backed
// =============================================================================

class ContentStore {
    constructor() {
        this.dbName = 'grabnet_store';
        this.dbVersion = 2;
        this.db = null;
    }
    
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Content chunks store
                if (!db.objectStoreNames.contains('chunks')) {
                    const chunks = db.createObjectStore('chunks', { keyPath: 'cid' });
                    chunks.createIndex('addedAt', 'addedAt');
                }
                
                // Metadata store (papers, files, etc.)
                if (!db.objectStoreNames.contains('metadata')) {
                    const meta = db.createObjectStore('metadata', { keyPath: 'uuid' });
                    meta.createIndex('type', 'type');
                    meta.createIndex('title', 'title');
                    meta.createIndex('addedAt', 'addedAt');
                }
                
                // Peer cache
                if (!db.objectStoreNames.contains('peers')) {
                    const peers = db.createObjectStore('peers', { keyPath: 'peerId' });
                    peers.createIndex('lastSeen', 'lastSeen');
                }
                
                // Search index (simple inverted index)
                if (!db.objectStoreNames.contains('searchIndex')) {
                    const search = db.createObjectStore('searchIndex', { keyPath: 'term' });
                }
                
                // Device key store (persistent PeerId per device)
                if (!db.objectStoreNames.contains('keys')) {
                    db.createObjectStore('keys', { keyPath: 'id' });
                }
            };
        });
    }
    
    async storePrivateKey(keyBytes) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['keys'], 'readwrite');
            const store = tx.objectStore('keys');
            store.put({ id: 'device_private_key', key: keyBytes, createdAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    
    async getPrivateKey() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['keys'], 'readonly');
            const store = tx.objectStore('keys');
            const request = store.get('device_private_key');
            request.onsuccess = () => resolve(request.result?.key || null);
            request.onerror = () => reject(request.error);
        });
    }
    
    async storeChunk(cid, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['chunks'], 'readwrite');
            const store = tx.objectStore('chunks');
            store.put({ cid, data, addedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    
    async getChunk(cid) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['chunks'], 'readonly');
            const store = tx.objectStore('chunks');
            const request = store.get(cid);
            request.onsuccess = () => resolve(request.result?.data);
            request.onerror = () => reject(request.error);
        });
    }
    
    async storeMetadata(item) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['metadata'], 'readwrite');
            const store = tx.objectStore('metadata');
            store.put({ ...item, addedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    
    async getMetadata(uuid) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['metadata'], 'readonly');
            const store = tx.objectStore('metadata');
            const request = store.get(uuid);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getAllMetadata(options = {}) {
        const { type, limit = 50 } = options;
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['metadata'], 'readonly');
            const store = tx.objectStore('metadata');
            const results = [];
            
            const index = type 
                ? store.index('type')
                : store.index('addedAt');
            
            const range = type ? IDBKeyRange.only(type) : null;
            const request = index.openCursor(range, 'prev');
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    async search(query) {
        const terms = query.toLowerCase().split(/\s+/);
        const results = new Map();
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['metadata'], 'readonly');
            const store = tx.objectStore('metadata');
            const request = store.openCursor();
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value;
                    const text = `${item.title || ''} ${item.abstract || ''} ${item.description || ''} ${(item.keywords || []).join(' ')}`.toLowerCase();
                    
                    const matchCount = terms.filter(term => text.includes(term)).length;
                    if (matchCount > 0) {
                        results.set(item.uuid, { item, score: matchCount / terms.length });
                    }
                    cursor.continue();
                } else {
                    // Sort by score descending
                    const sorted = Array.from(results.values())
                        .sort((a, b) => b.score - a.score)
                        .map(r => r.item);
                    resolve(sorted);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    async storePeer(peerId, info) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['peers'], 'readwrite');
            const store = tx.objectStore('peers');
            store.put({ peerId, ...info, lastSeen: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    
    async getKnownPeers(limit = 20) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['peers'], 'readonly');
            const store = tx.objectStore('peers');
            const index = store.index('lastSeen');
            const results = [];
            
            const request = index.openCursor(null, 'prev');
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// =============================================================================
// GRABNET P2P NODE - Main client
// =============================================================================

class GrabNetNode extends EventTarget {
    constructor(options = {}) {
        super();
        
        this.options = { ...GRABNET_CONFIG, ...options };
        this.node = null;
        this.store = new ContentStore();
        this.peerId = null;
        this.isStarted = false;
        this.connectedPeers = new Map();
        this.pendingSearches = new Map();
        this.contentProviders = new Map(); // CID -> Set<PeerId>
        this._dialingPeers = new Set(); // PeerIds currently being dialed
        this._libs = null; // cached libp2p module references
        this._announceInterval = null;
        this._peerDeadlineTimer = null;
        
        // Stats
        this.stats = {
            messagesReceived: 0,
            messagesSent: 0,
            bytesReceived: 0,
            bytesSent: 0,
            contentServed: 0,
            searchesHandled: 0,
        };
        
        // Mode: 'p2p', 'hybrid', 'fallback'
        this.mode = 'hybrid';
    }
    
    /**
     * Initialize and start the P2P node
     *
     * Attempts to connect to the relay via WebSocket. Falls back to API mode
     * if the relay is unreachable or libp2p fails to initialize.
     */
    async start() {
        if (this.isStarted) return;
        
        console.log('[GrabNet] Starting P2P node...');
        
        try {
            await this._startNode();
        } catch (error) {
            console.warn('[GrabNet] P2P startup failed, running in API fallback mode:', error.message);
            await this.store.init();
            this.mode = 'fallback';
            this.isStarted = true;
            this.dispatchEvent(new CustomEvent('fallback', { detail: { reason: 'p2p-failed', error: error.message } }));
        }
    }
    
    async _startNode() {
        try {
            // Initialize local store
            await this.store.init();
            
            // Import libp2p modules
            const libs = await importLibp2p();
            this._libs = libs;
            
            // Each device auto-generates a unique ephemeral key pair.
            // libp2p handles key generation internally — external @libp2p/crypto
            // has version-mismatch issues with the bundled crypto in libp2p@1.9.0.
            
            // Create libp2p node
            const nodeConfig = {
                addresses: {
                    listen: [
                        '/webrtc',
                    ]
                },
                transports: [
                    libs.webRTC(),
                    libs.webSockets({
                        filter: (addrs) => {
                            if (!addrs) return [];
                            return addrs.filter(a => {
                                if (!a) return false;
                                const s = a.toString();
                                return s.includes('/ws') || s.includes('/wss');
                            });
                        }
                    }),
                    libs.circuitRelayTransport({
                        discoverRelays: 1,
                    }),
                ],
                connectionEncryption: [libs.noise()],
                streamMuxers: [libs.yamux()],
                peerDiscovery: [
                    libs.bootstrap({
                        list: this.options.BOOTSTRAP_NODES,
                    }),
                ],
                services: {
                    identify: libs.identify(),
                    pubsub: libs.gossipsub({
                        allowPublishToZeroPeers: true,
                        emitSelf: false,
                        doPX: true,
                    }),
                    dht: libs.kadDHT({
                        clientMode: true,
                    }),
                },
            };
            this.node = await libs.createLibp2p(nodeConfig);
            
            this.peerId = this.node.peerId.toString();
            console.log(`[GrabNet] Node started with PeerId: ${this.peerId}`);
            
            // Set up event handlers
            this._setupEventHandlers();
            
            // Subscribe to GrabNet topics
            await this._subscribeToTopics();
            
            // Register protocol handlers
            await this._registerProtocols();
            
            // Start the node
            await this.node.start();
            this.isStarted = true;
            
            // Emit ready event
            this.dispatchEvent(new CustomEvent('ready', { detail: { peerId: this.peerId } }));
            
            // Start peer discovery loop
            this._startPeerDiscovery();
            
            // Auto-shutdown if no peers (not even the relay) connect within 30s
            this._peerDeadlineTimer = setTimeout(() => {
                if (this.connectedPeers.size === 0 && this.isStarted) {
                    console.warn('[GrabNet] No peers found after 30s, stopping P2P to preserve performance');
                    this.stop();
                    this.mode = 'fallback';
                    this.dispatchEvent(new CustomEvent('fallback', { detail: { reason: 'no-peers' } }));
                }
            }, 30000);
            
            return this.peerId;
            
        } catch (error) {
            console.error('[GrabNet] Failed to start node:', error);
            this.mode = 'fallback';
            this.dispatchEvent(new CustomEvent('fallback', { detail: { error } }));
            throw error;
        }
    }
    
    /**
     * Stop the P2P node
     */
    async stop() {
        if (!this.isStarted) return;
        
        console.log('[GrabNet] Stopping P2P node...');
        
        if (this._peerDeadlineTimer) {
            clearTimeout(this._peerDeadlineTimer);
            this._peerDeadlineTimer = null;
        }
        if (this._announceInterval) {
            clearInterval(this._announceInterval);
            this._announceInterval = null;
        }
        
        if (this.node) {
            await this.node.stop();
        }
        
        this.connectedPeers.clear();
        this._dialingPeers.clear();
        this.isStarted = false;
        this.dispatchEvent(new CustomEvent('stopped'));
    }
    
    /**
     * Get current network status
     */
    getStatus() {
        return {
            mode: this.mode,
            isStarted: this.isStarted,
            peerId: this.peerId,
            peerCount: this.connectedPeers.size,
            peers: Array.from(this.connectedPeers.keys()),
            stats: { ...this.stats },
            isPureP2P: this.connectedPeers.size >= this.options.MIN_PEERS_FOR_PURE_P2P,
        };
    }
    
    // =========================================================================
    // CONTENT OPERATIONS
    // =========================================================================
    
    /**
     * Fetch content by UUID - tries P2P first, falls back to API
     */
    async fetchContent(uuid, options = {}) {
        const { forceP2P = false, forceAPI = false } = options;
        
        // Check local cache first
        const cached = await this.store.getMetadata(uuid);
        if (cached && !options.skipCache) {
            console.log(`[GrabNet] Cache hit for ${uuid}`);
            return cached;
        }
        
        // Try P2P if we have peers
        if (!forceAPI && this.connectedPeers.size >= this.options.MIN_PEERS_FOR_PURE_P2P) {
            try {
                const result = await this._fetchFromPeers(uuid);
                if (result) {
                    await this.store.storeMetadata(result);
                    return result;
                }
            } catch (error) {
                console.warn('[GrabNet] P2P fetch failed:', error);
            }
        }
        
        // Fall back to API
        if (!forceP2P) {
            try {
                const result = await this._fetchFromAPI(`/papers/${uuid}`);
                if (result) {
                    await this.store.storeMetadata(result);
                    // Announce that we have this content
                    this._announceContent(uuid);
                }
                return result;
            } catch (error) {
                console.error('[GrabNet] API fetch failed:', error);
                throw error;
            }
        }
        
        throw new Error(`Content not found: ${uuid}`);
    }
    
    /**
     * Browse content - hybrid P2P + API
     */
    async browse(options = {}) {
        const { type, limit = 20, offset = 0 } = options;
        
        // Get local content
        const local = await this.store.getAllMetadata({ type, limit });
        
        // If we have enough local content, use it
        if (local.length >= limit && this.mode === 'p2p') {
            return local.slice(0, limit);
        }
        
        // Supplement with API
        try {
            const params = new URLSearchParams({ limit: limit.toString() });
            if (type) params.set('type', type);
            if (offset) params.set('offset', offset.toString());
            
            const apiContent = await this._fetchFromAPI(`/papers?${params}`);
            const papers = apiContent?.papers || apiContent || [];
            
            // Cache API results
            for (const paper of papers) {
                await this.store.storeMetadata(paper);
            }
            
            // Merge and dedupe
            const merged = new Map();
            for (const item of [...local, ...papers]) {
                merged.set(item.uuid, item);
            }
            
            return Array.from(merged.values()).slice(0, limit);
            
        } catch (error) {
            console.warn('[GrabNet] API browse failed, using local only:', error);
            return local;
        }
    }
    
    /**
     * Search content - P2P broadcast + local + API
     */
    async search(query, options = {}) {
        const { type, limit = 20, timeout = this.options.SEARCH_TIMEOUT } = options;
        
        // Start all search sources in parallel
        const searches = [];
        
        // Local search
        searches.push(this.store.search(query));
        
        // P2P search broadcast
        if (this.connectedPeers.size > 0) {
            searches.push(this._p2pSearch(query, { type, limit, timeout }));
        }
        
        // API search
        searches.push(this._apiSearch(query, { type, limit }));
        
        // Wait for all with timeout
        const results = await Promise.allSettled(searches);
        
        // Merge results
        const merged = new Map();
        for (const result of results) {
            if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                for (const item of result.value) {
                    if (!merged.has(item.uuid)) {
                        merged.set(item.uuid, item);
                    }
                }
            }
        }
        
        return Array.from(merged.values()).slice(0, limit);
    }
    
    /**
     * Download file content
     */
    async downloadFile(fileId, options = {}) {
        const { cid } = options;
        
        // Check local chunks first
        if (cid) {
            const cached = await this.store.getChunk(cid);
            if (cached) {
                console.log(`[GrabNet] Serving file from local cache: ${cid}`);
                return cached;
            }
        }
        
        // Try P2P if we have providers
        if (cid && this.contentProviders.has(cid)) {
            try {
                const data = await this._fetchFileFromPeers(cid);
                if (data) {
                    await this.store.storeChunk(cid, data);
                    return data;
                }
            } catch (error) {
                console.warn('[GrabNet] P2P file fetch failed:', error);
            }
        }
        
        // Fall back to API stream
        const response = await fetch(`${this.options.API_BASE}/files/${fileId}/stream`);
        if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
        
        const data = await response.arrayBuffer();
        
        // Cache if we have CID
        if (cid) {
            await this.store.storeChunk(cid, data);
            this._announceContent(cid);
        }
        
        return data;
    }
    
    /**
     * Publish content to the network
     */
    async publish(metadata, file = null) {
        // Store locally first
        await this.store.storeMetadata(metadata);
        
        // If file provided, store chunk
        if (file) {
            const data = await file.arrayBuffer();
            const cid = await ContentHash.createCID(new Uint8Array(data));
            await this.store.storeChunk(cid, data);
            metadata.grabnet_cid = cid;
        }
        
        // Announce to network
        this._announceContent(metadata.uuid, metadata);
        
        // Upload to API for persistence
        const formData = new FormData();
        formData.append('metadata', JSON.stringify(metadata));
        if (file) formData.append('file', file);
        
        try {
            const response = await fetch(`${this.options.API_BASE}/papers`, {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });
            return await response.json();
        } catch (error) {
            console.warn('[GrabNet] API publish failed, content is P2P only:', error);
            return { success: true, mode: 'p2p_only', uuid: metadata.uuid };
        }
    }
    
    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================
    
    _setupEventHandlers() {
        // Peer connection events
        this.node.addEventListener('peer:connect', (event) => {
            const peerId = event.detail.toString();
            console.log(`[GrabNet] Peer connected: ${peerId}`);
            this.connectedPeers.set(peerId, { connectedAt: Date.now() });
            this.store.storePeer(peerId, { connectedAt: Date.now() });
            
            // Cancel auto-shutdown timer — we found a peer
            if (this._peerDeadlineTimer) {
                clearTimeout(this._peerDeadlineTimer);
                this._peerDeadlineTimer = null;
            }
            
            this.dispatchEvent(new CustomEvent('peer:connect', { detail: { peerId } }));
            this._updateMode();
        });
        
        this.node.addEventListener('peer:disconnect', (event) => {
            const peerId = event.detail.toString();
            console.log(`[GrabNet] Peer disconnected: ${peerId}`);
            this.connectedPeers.delete(peerId);
            
            this.dispatchEvent(new CustomEvent('peer:disconnect', { detail: { peerId } }));
            this._updateMode();
        });
        
        // Peer discovery — dial newly discovered peers through the relay
        this.node.addEventListener('peer:discovery', (event) => {
            const discoveredId = event.detail.id.toString();
            // Skip relay bootstrap nodes — we're already connected to them
            const isBootstrap = this.options.BOOTSTRAP_NODES.some(addr => addr.includes(discoveredId));
            if (isBootstrap || this.connectedPeers.has(discoveredId) || this._dialingPeers.has(discoveredId)) return;
            
            console.log(`[GrabNet] Discovered peer: ${discoveredId}`);
            this._dialViaCiruitRelay(discoveredId);
        });
    }
    
    async _subscribeToTopics() {
        const topics = Object.values(this.options.TOPICS);
        
        for (const topic of topics) {
            this.node.services.pubsub.subscribe(topic);
            
            this.node.services.pubsub.addEventListener('message', (event) => {
                if (event.detail.topic === topic) {
                    this._handleMessage(topic, event.detail);
                }
            });
        }
    }
    
    async _registerProtocols() {
        // Content request protocol
        await this.node.handle(this.options.CONTENT_PROTOCOL, async ({ stream }) => {
            const chunks = [];
            for await (const chunk of stream.source) {
                chunks.push(chunk.subarray());
            }
            const request = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
            
            const content = await this.store.getMetadata(request.uuid) ||
                            await this.store.getChunk(request.cid);
            
            if (content) {
                this.stats.contentServed++;
                const response = JSON.stringify({ success: true, data: content });
                stream.sink([new TextEncoder().encode(response)]);
            } else {
                stream.sink([new TextEncoder().encode(JSON.stringify({ success: false }))]);
            }
        });
        
        // Search request protocol
        await this.node.handle(this.options.SEARCH_PROTOCOL, async ({ stream }) => {
            const chunks = [];
            for await (const chunk of stream.source) {
                chunks.push(chunk.subarray());
            }
            const request = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
            
            const results = await this.store.search(request.query);
            this.stats.searchesHandled++;
            
            const response = JSON.stringify({ success: true, results: results.slice(0, 10) });
            stream.sink([new TextEncoder().encode(response)]);
        });
    }
    
    _handleMessage(topic, message) {
        this.stats.messagesReceived++;
        
        try {
            const data = JSON.parse(new TextDecoder().decode(message.data));
            
            switch (topic) {
                case this.options.TOPICS.CONTENT_ANNOUNCE:
                    this._handleContentAnnounce(data, message.from);
                    break;
                    
                case this.options.TOPICS.SEARCH_REQUEST:
                    this._handleSearchRequest(data, message.from);
                    break;
                    
                case this.options.TOPICS.SEARCH_RESPONSE:
                    this._handleSearchResponse(data);
                    break;
                    
                case this.options.TOPICS.PEER_DISCOVERY:
                    this._handlePeerDiscovery(data, message.from);
                    break;
            }
        } catch (error) {
            console.warn('[GrabNet] Failed to handle message:', error);
        }
    }
    
    _handleContentAnnounce(data, fromPeer) {
        const { uuid, cid, metadata } = data;
        
        // Track content providers
        if (cid) {
            if (!this.contentProviders.has(cid)) {
                this.contentProviders.set(cid, new Set());
            }
            this.contentProviders.get(cid).add(fromPeer.toString());
        }
        
        // Store metadata if provided
        if (metadata) {
            this.store.storeMetadata(metadata);
        }
        
        this.dispatchEvent(new CustomEvent('content:announce', { detail: { uuid, cid, fromPeer } }));
    }
    
    async _handleSearchRequest(data, fromPeer) {
        const { searchId, query, type, limit } = data;
        
        const results = await this.store.search(query);
        const filtered = type 
            ? results.filter(r => r.type === type)
            : results;
        
        // Publish response
        this._publish(this.options.TOPICS.SEARCH_RESPONSE, {
            searchId,
            results: filtered.slice(0, limit || 10),
            fromPeer: this.peerId,
        });
    }
    
    _handleSearchResponse(data) {
        const { searchId, results } = data;
        
        if (this.pendingSearches.has(searchId)) {
            const pending = this.pendingSearches.get(searchId);
            pending.results.push(...results);
        }
    }
    
    _handlePeerDiscovery(data, fromPeer) {
        const { peers } = data;
        
        // The message sender is a real peer — try to connect to them directly
        const senderId = fromPeer?.toString?.() || fromPeer;
        if (senderId && senderId !== this.peerId && !this.connectedPeers.has(senderId)) {
            console.log(`[GrabNet] Peer announced itself: ${senderId}`);
            this._dialViaCiruitRelay(senderId);
        }
        
        // Also try peers listed in the broadcast
        for (const peer of peers || []) {
            this.store.storePeer(peer.peerId, peer);
            if (peer.peerId && peer.peerId !== this.peerId && !this.connectedPeers.has(peer.peerId)) {
                this._dialViaCiruitRelay(peer.peerId);
            }
        }
    }
    
    async _publish(topic, data) {
        if (!this.node?.services?.pubsub) return;
        
        try {
            const encoded = new TextEncoder().encode(JSON.stringify(data));
            await this.node.services.pubsub.publish(topic, encoded);
            this.stats.messagesSent++;
        } catch (error) {
            // NoPeersSubscribedToTopic is expected when no other browsers are online
            if (error.message?.includes('NoPeersSubscribedToTopic') || error.code === 'ERR_TOPIC_NO_PEERS') {
                return;
            }
            console.warn('[GrabNet] Publish failed:', error);
        }
    }
    
    _announceContent(id, metadata = null) {
        this._publish(this.options.TOPICS.CONTENT_ANNOUNCE, {
            uuid: metadata?.uuid || id,
            cid: metadata?.grabnet_cid || id,
            metadata,
            announcer: this.peerId,
        });
    }
    
    async _fetchFromPeers(uuid) {
        const peers = Array.from(this.connectedPeers.keys());
        
        for (const peerId of peers) {
            try {
                const stream = await this.node.dialProtocol(peerId, this.options.CONTENT_PROTOCOL);
                stream.sink([new TextEncoder().encode(JSON.stringify({ uuid }))]);
                
                const chunks = [];
                for await (const chunk of stream.source) {
                    chunks.push(chunk.subarray());
                }
                
                const response = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
                if (response.success && response.data) {
                    return response.data;
                }
            } catch (error) {
                console.warn(`[GrabNet] Failed to fetch from peer ${peerId}:`, error);
            }
        }
        
        return null;
    }
    
    async _fetchFileFromPeers(cid) {
        const providers = this.contentProviders.get(cid);
        if (!providers) return null;
        
        for (const peerId of providers) {
            try {
                const stream = await this.node.dialProtocol(peerId, this.options.CONTENT_PROTOCOL);
                stream.sink([new TextEncoder().encode(JSON.stringify({ cid }))]);
                
                const chunks = [];
                for await (const chunk of stream.source) {
                    chunks.push(chunk.subarray());
                }
                
                const response = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
                if (response.success && response.data) {
                    return response.data;
                }
            } catch (error) {
                console.warn(`[GrabNet] Failed to fetch file from peer ${peerId}:`, error);
            }
        }
        
        return null;
    }
    
    async _p2pSearch(query, options = {}) {
        const { type, limit = 20, timeout = 5000 } = options;
        
        const searchId = crypto.randomUUID();
        const pending = { results: [], resolve: null };
        this.pendingSearches.set(searchId, pending);
        
        // Broadcast search request
        this._publish(this.options.TOPICS.SEARCH_REQUEST, {
            searchId,
            query,
            type,
            limit,
        });
        
        // Wait for responses with timeout
        await new Promise(resolve => {
            pending.resolve = resolve;
            setTimeout(resolve, timeout);
        });
        
        this.pendingSearches.delete(searchId);
        return pending.results;
    }
    
    async _apiSearch(query, options = {}) {
        const { type, limit = 20 } = options;
        
        const params = new URLSearchParams({ q: query, limit: limit.toString() });
        if (type) params.set('type', type);
        
        const data = await this._fetchFromAPI(`/browse/search?${params}`);
        return data?.papers || data || [];
    }
    
    async _fetchFromAPI(path) {
        const response = await fetch(`${this.options.API_BASE}${path}`, {
            credentials: 'include',
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
    }
    
    _updateMode() {
        const peerCount = this.connectedPeers.size;
        
        if (peerCount >= this.options.MIN_PEERS_FOR_PURE_P2P) {
            this.mode = 'p2p';
        } else if (peerCount > 0) {
            this.mode = 'hybrid';
        } else {
            this.mode = 'fallback';
        }
        
        this.dispatchEvent(new CustomEvent('mode:change', { detail: { mode: this.mode, peerCount } }));
    }
    
    /**
     * Dial a peer through the relay using a circuit-relay address.
     * Address format: <relay-multiaddr>/p2p-circuit/p2p/<target-peer-id>
     */
    async _dialViaCiruitRelay(targetPeerId) {
        if (!this.node || !this.isStarted || !this._libs?.multiaddr) return;
        // Skip if already connected or already dialing this peer
        if (this.connectedPeers.has(targetPeerId) || this._dialingPeers.has(targetPeerId)) return;
        
        this._dialingPeers.add(targetPeerId);
        try {
            for (const relayAddr of this.options.BOOTSTRAP_NODES) {
                const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${targetPeerId}`;
                try {
                    const ma = this._libs.multiaddr(circuitAddr);
                    await this.node.dial(ma, { signal: AbortSignal.timeout(5000) });
                    console.log(`[GrabNet] Connected to peer ${targetPeerId} via circuit relay`);
                    return;
                } catch (error) {
                    // Silently ignore dial failures — peer may be offline or unreachable
                }
            }
        } finally {
            this._dialingPeers.delete(targetPeerId);
        }
    }
    
    _announcePresence() {
        // Broadcast our own PeerId so other browsers learn we exist
        const selfEntry = {
            peerId: this.peerId,
            addrs: this.options.BOOTSTRAP_NODES.map(relay => `${relay}/p2p-circuit/p2p/${this.peerId}`),
        };
        const peerEntries = Array.from(this.connectedPeers.keys())
            .filter(id => !this.options.BOOTSTRAP_NODES.some(a => a.includes(id)))
            .map(id => ({
                peerId: id,
                addrs: this.options.BOOTSTRAP_NODES.map(relay => `${relay}/p2p-circuit/p2p/${id}`),
            }));
        this._publish(this.options.TOPICS.PEER_DISCOVERY, { peers: [selfEntry, ...peerEntries] });
    }
    
    _startPeerDiscovery() {
        // Announce after relay connection has time to establish
        setTimeout(() => this._announcePresence(), 5000);
        // Repeat at a moderate pace — no need to flood
        this._announceInterval = setInterval(() => {
            if (this.isStarted) this._announcePresence();
        }, 20000);
    }
}

// =============================================================================
// P2P UI COMPONENT - Status indicator
// =============================================================================

class GrabNetStatusUI {
    constructor(node, options = {}) {
        this.node = node;
        this.container = null;
        this.options = {
            position: 'bottom-right',
            showPeerCount: true,
            showMode: true,
            collapsible: true,
            ...options,
        };
        
        this._setupUI();
        this._bindEvents();
    }
    
    _setupUI() {
        this.container = document.createElement('div');
        this.container.id = 'grabnet-status';
        this.container.innerHTML = `
            <style>
                #grabnet-status {
                    position: fixed;
                    ${this.options.position.includes('bottom') ? 'bottom: 20px' : 'top: 20px'};
                    ${this.options.position.includes('right') ? 'right: 20px' : 'left: 20px'};
                    z-index: 10000;
                    font-family: 'Fira Code', 'Monaco', monospace;
                    font-size: 12px;
                }
                
                #grabnet-status .status-pill {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--bg-secondary, #1a1a2e);
                    border: 1px solid var(--border, #333);
                    border-radius: 20px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }
                
                #grabnet-status .status-pill:hover {
                    border-color: var(--accent, #00ff88);
                }
                
                #grabnet-status .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    animation: pulse 2s infinite;
                }
                
                #grabnet-status .status-dot.p2p { background: #00ff88; }
                #grabnet-status .status-dot.hybrid { background: #ffaa00; }
                #grabnet-status .status-dot.fallback { background: #ff4444; }
                #grabnet-status .status-dot.connecting { background: #4488ff; }
                
                #grabnet-status .peer-count {
                    color: var(--text-muted, #888);
                }
                
                #grabnet-status .mode-label {
                    color: var(--text, #fff);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                #grabnet-status .status-details {
                    display: none;
                    margin-top: 10px;
                    padding: 12px;
                    background: var(--bg-secondary, #1a1a2e);
                    border: 1px solid var(--border, #333);
                    border-radius: 8px;
                    max-height: 200px;
                    overflow-y: auto;
                }
                
                #grabnet-status.expanded .status-details {
                    display: block;
                }
                
                #grabnet-status .peer-list {
                    margin: 0;
                    padding: 0;
                    list-style: none;
                }
                
                #grabnet-status .peer-list li {
                    padding: 4px 0;
                    color: var(--text-muted, #888);
                    font-size: 10px;
                    word-break: break-all;
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            </style>
            
            <div class="status-pill">
                <span class="status-dot connecting"></span>
                <span class="mode-label">Connecting...</span>
                <span class="peer-count">(0 peers)</span>
            </div>
            
            <div class="status-details">
                <div class="peer-id">Node ID: <code>-</code></div>
                <div class="stats">
                    <div>Messages: <span class="msg-count">0</span></div>
                    <div>Content Served: <span class="serve-count">0</span></div>
                </div>
                <div class="peers-section">
                    <strong>Connected Peers:</strong>
                    <ul class="peer-list"></ul>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.container);
        
        // Toggle expansion on click
        this.container.querySelector('.status-pill').addEventListener('click', () => {
            this.container.classList.toggle('expanded');
        });
    }
    
    _bindEvents() {
        this.node.addEventListener('ready', (e) => {
            this._update({ peerId: e.detail.peerId });
        });
        
        this.node.addEventListener('peer:connect', () => this._update());
        this.node.addEventListener('peer:disconnect', () => this._update());
        this.node.addEventListener('mode:change', () => this._update());
        this.node.addEventListener('fallback', () => this._update({ error: true }));
    }
    
    _update(extra = {}) {
        const status = this.node.getStatus();
        
        const dot = this.container.querySelector('.status-dot');
        dot.className = `status-dot ${status.mode}`;
        
        const modeLabel = this.container.querySelector('.mode-label');
        modeLabel.textContent = status.mode === 'p2p' ? 'P2P' : 
                                status.mode === 'hybrid' ? 'Hybrid' : 'API';
        
        const peerCount = this.container.querySelector('.peer-count');
        peerCount.textContent = `(${status.peerCount} peer${status.peerCount !== 1 ? 's' : ''})`;
        
        if (extra.peerId) {
            this.container.querySelector('.peer-id code').textContent = 
                extra.peerId.slice(0, 16) + '...';
        }
        
        this.container.querySelector('.msg-count').textContent = status.stats.messagesReceived;
        this.container.querySelector('.serve-count').textContent = status.stats.contentServed;
        
        const peerList = this.container.querySelector('.peer-list');
        peerList.innerHTML = status.peers.map(p => 
            `<li>${p.slice(0, 20)}...</li>`
        ).join('');
    }
}

// =============================================================================
// GLOBAL SINGLETON & AUTO-INIT
// =============================================================================

let grabnetInstance = null;

/**
 * Get or create the GrabNet singleton
 */
async function getGrabNet(options = {}) {
    if (!grabnetInstance) {
        grabnetInstance = new GrabNetNode(options);
    }
    
    if (!grabnetInstance.isStarted) {
        try {
            await grabnetInstance.start();
        } catch (error) {
            console.warn('[GrabNet] P2P failed, running in API fallback mode');
        }
    }
    
    return grabnetInstance;
}

/**
 * Initialize GrabNet with UI
 */
async function initGrabNet(options = {}) {
    const node = await getGrabNet(options);
    
    if (options.showUI !== false) {
        new GrabNetStatusUI(node, options.uiOptions);
    }
    
    return node;
}

// Export for ES modules
if (typeof window !== 'undefined') {
    window.GrabNet = {
        Node: GrabNetNode,
        ContentHash,
        ContentStore,
        StatusUI: GrabNetStatusUI,
        getNode: getGrabNet,
        init: initGrabNet,
        config: GRABNET_CONFIG,
    };
}

export { 
    GrabNetNode, 
    ContentHash, 
    ContentStore, 
    GrabNetStatusUI,
    getGrabNet, 
    initGrabNet, 
    GRABNET_CONFIG 
};
