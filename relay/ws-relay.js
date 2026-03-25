/**
 * GrabNet WebSocket Relay Bridge
 * 
 * This service bridges browser libp2p-js clients to the native Rust GrabNet network.
 * It runs as a WebSocket server that browser peers connect to, then relays
 * messages to/from the native libp2p network.
 * 
 * Run with: node ws-relay.js
 */

// Polyfill for Node < 22
if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    };
}

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { tcp } from '@libp2p/tcp';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { ping } from '@libp2p/ping';
import { createFromJSON, createFromPrivKey, createEd25519PeerId } from '@libp2p/peer-id-factory';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const CONFIG = {
    // Ports
    TCP_PORT: parseInt(process.env.TCP_PORT) || 4003,
    WS_PORT: parseInt(process.env.WS_PORT) || 4004,
    
    // Data directory
    DATA_DIR: process.env.DATA_DIR || './data/relay',
    
    // Bootstrap nodes (native GrabNet nodes)
    BOOTSTRAP_NODES: process.env.BOOTSTRAP_NODES?.split(',') || [],
    
    // GossipSub topics to relay
    TOPICS: [
        'grabnet/content/announce',
        'grabnet/search/request',
        'grabnet/search/response',
        'grabnet/peer/discovery',
    ],
    
    // Limits
    MAX_CONNECTIONS: 1000,
    MAX_INCOMING_PENDING: 100,
};

// Peer ID persistence
async function loadOrCreatePeerId() {
    const idPath = path.join(CONFIG.DATA_DIR, 'peer-id.json');
    
    try {
        const data = await fs.readFile(idPath, 'utf8');
        return await createFromJSON(JSON.parse(data));
    } catch {
        // Generate new peer ID
        const peerId = await createEd25519PeerId();
        
        // Save for next time
        await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
        await fs.writeFile(idPath, JSON.stringify({
            id: peerId.toString(),
            privKey: Buffer.from(peerId.privateKey).toString('base64'),
            pubKey: Buffer.from(peerId.publicKey).toString('base64'),
        }));
        
        return peerId;
    }
}

// Stats tracking
const stats = {
    startTime: Date.now(),
    connections: 0,
    messagesRelayed: 0,
    bytesRelayed: 0,
    activePeers: new Set(),
};

// Main relay node
async function createRelay() {
    console.log('[Relay] Starting GrabNet WebSocket Relay...');
    
    // Ensure data directory exists
    await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
    
    // Load or create peer identity
    const peerId = await loadOrCreatePeerId();
    console.log(`[Relay] PeerId: ${peerId.toString()}`);
    
    // Create libp2p node with relay capabilities
    const node = await createLibp2p({
        peerId,
        addresses: {
            listen: [
                `/ip4/0.0.0.0/tcp/${CONFIG.TCP_PORT}`,
                `/ip4/0.0.0.0/tcp/${CONFIG.WS_PORT}/ws`,
            ],
            announce: [
                // Public addresses via Cloudflare Tunnel (TLS termination at edge)
                `/dns4/relay.rootedrevival.us/tcp/443/wss/p2p/${peerId}`,
            ],
        },
        transports: [
            tcp(),
            webSockets(),
        ],
        connectionEncryption: [noise()],
        streamMuxers: [yamux()],
        connectionManager: {
            maxConnections: CONFIG.MAX_CONNECTIONS,
            maxIncomingPendingConnections: CONFIG.MAX_INCOMING_PENDING,
        },
        services: {
            identify: identify(),
            ping: ping(),
            relay: circuitRelayServer({
                reservations: {
                    maxReservations: 500,
                    reservationClearInterval: 300000, // 5 minutes
                    applyDefaultLimit: true,
                    defaultDurationLimit: 120000, // 2 minutes
                    defaultDataLimit: 128n * 1024n * 1024n, // 128 MB
                },
            }),
            pubsub: gossipsub({
                allowPublishToZeroPeers: true,
                emitSelf: false,
                floodPublish: true, // For better message propagation
                doPX: true, // Peer exchange
            }),
            dht: kadDHT({
                clientMode: false, // Server mode for relay
            }),
        },
        peerDiscovery: CONFIG.BOOTSTRAP_NODES.length > 0 ? [
            bootstrap({ list: CONFIG.BOOTSTRAP_NODES }),
        ] : [],
    });
    
    // Event handlers
    node.addEventListener('peer:connect', (event) => {
        const peerId = event.detail.toString();
        stats.activePeers.add(peerId);
        stats.connections++;
        console.log(`[Relay] Peer connected: ${peerId.slice(0, 16)}... (${stats.activePeers.size} active)`);
    });
    
    node.addEventListener('peer:disconnect', (event) => {
        const peerId = event.detail.toString();
        stats.activePeers.delete(peerId);
        console.log(`[Relay] Peer disconnected: ${peerId.slice(0, 16)}... (${stats.activePeers.size} active)`);
    });
    
    // Subscribe to all GrabNet topics and relay messages
    for (const topic of CONFIG.TOPICS) {
        node.services.pubsub.subscribe(topic);
        console.log(`[Relay] Subscribed to topic: ${topic}`);
    }
    
    node.services.pubsub.addEventListener('message', (event) => {
        stats.messagesRelayed++;
        stats.bytesRelayed += event.detail.data.length;
        
        // Log message (but not content for privacy)
        console.log(`[Relay] Message on ${event.detail.topic} from ${event.detail.from.toString().slice(0, 16)}... (${event.detail.data.length} bytes)`);
    });
    
    // Start the node
    await node.start();
    
    const addrs = node.getMultiaddrs();
    console.log('[Relay] Listening on:');
    for (const addr of addrs) {
        console.log(`  ${addr.toString()}`);
    }
    
    // HTTP status endpoint
    const { createServer } = await import('http');
    const statusServer = createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        } else if (req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                peerId: peerId.toString(),
                uptime: Math.floor((Date.now() - stats.startTime) / 1000),
                connections: stats.connections,
                activePeers: stats.activePeers.size,
                messagesRelayed: stats.messagesRelayed,
                bytesRelayed: stats.bytesRelayed,
                addresses: addrs.map(a => a.toString()),
            }));
        } else if (req.url === '/peers') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                count: stats.activePeers.size,
                peers: Array.from(stats.activePeers),
            }));
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });
    
    statusServer.listen(8099, () => {
        console.log('[Relay] Status API listening on http://localhost:8099');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[Relay] Shutting down...');
        await node.stop();
        statusServer.close();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('[Relay] Received SIGTERM, shutting down...');
        await node.stop();
        statusServer.close();
        process.exit(0);
    });
    
    return node;
}

// Run
createRelay().catch(err => {
    console.error('[Relay] Fatal error:', err);
    process.exit(1);
});
