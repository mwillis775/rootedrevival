/**
 * Call Signaling - WebSocket server for private audio/video calls
 * 
 * Handles WebRTC signaling: offer/answer exchange, ICE candidates,
 * call initiation/rejection/termination.
 * 
 * Authenticates via session cookie on WebSocket upgrade.
 * All media flows peer-to-peer via WebRTC (DTLS-SRTP encrypted).
 */

const { WebSocketServer } = require('ws');
const cookie = require('cookie');
const users = require('./db/users');

// Map of username -> WebSocket connection
const connectedUsers = new Map();

// Active calls: callId -> { caller, callee, startedAt }
const activeCalls = new Map();

/**
 * Attach WebSocket signaling to an existing HTTP server.
 */
function attachCallSignaling(httpServer) {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (url.pathname !== '/ws/calls') {
            // Not our upgrade — ignore (let other handlers take it)
            return;
        }

        // Authenticate via session cookie
        const cookies = cookie.parse(req.headers.cookie || '');
        const token = cookies.session;

        if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        const session = users.validateSession(token);
        if (!session) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.user = session.user;
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (ws) => {
        const username = ws.user.username;

        // If user already connected, close old connection
        const existing = connectedUsers.get(username);
        if (existing) {
            sendMsg(existing, { type: 'replaced', reason: 'Connected from another tab' });
            existing.close(1000, 'replaced');
        }

        connectedUsers.set(username, ws);
        console.log(`[calls] ${username} connected (${connectedUsers.size} online)`);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                handleSignalingMessage(ws, msg);
            } catch (e) {
                sendMsg(ws, { type: 'error', message: 'Invalid message format' });
            }
        });

        ws.on('close', () => {
            // Only remove if this is still the active connection for this user
            if (connectedUsers.get(username) === ws) {
                connectedUsers.delete(username);
            }
            // End any active calls involving this user
            endCallsForUser(username);
            console.log(`[calls] ${username} disconnected (${connectedUsers.size} online)`);
        });

        ws.on('error', (err) => {
            console.error(`[calls] WebSocket error for ${username}:`, err.message);
        });

        // Send connection confirmation
        sendMsg(ws, { type: 'connected', username });
    });

    // Heartbeat to detect stale connections
    const heartbeat = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                if (ws.user) endCallsForUser(ws.user.username);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(heartbeat));

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
    });

    return wss;
}

function handleSignalingMessage(ws, msg) {
    const sender = ws.user.username;

    switch (msg.type) {
        case 'call-offer': {
            // User wants to call someone
            const target = sanitizeUsername(msg.target);
            if (!target || target === sender) {
                return sendMsg(ws, { type: 'error', message: 'Invalid call target' });
            }

            const targetWs = connectedUsers.get(target);
            if (!targetWs) {
                return sendMsg(ws, { type: 'call-unavailable', target, reason: 'User is not online' });
            }

            // Check if either party is already in a call
            if (isInCall(sender)) {
                return sendMsg(ws, { type: 'error', message: 'You are already in a call' });
            }
            if (isInCall(target)) {
                return sendMsg(ws, { type: 'call-unavailable', target, reason: 'User is busy' });
            }

            const callId = `${sender}-${target}-${Date.now()}`;

            // Register pending call
            activeCalls.set(callId, {
                caller: sender,
                callee: target,
                startedAt: null,
                pending: true
            });

            // Forward offer to target
            sendMsg(targetWs, {
                type: 'call-offer',
                callId,
                from: sender,
                fromDisplayName: ws.user.displayName || sender,
                mediaType: msg.mediaType || 'audio' // 'audio' or 'video'
            });

            // Confirm to caller that offer was sent
            sendMsg(ws, { type: 'call-ringing', callId, target });

            // Auto-expire unanswered calls after 30 seconds
            setTimeout(() => {
                const call = activeCalls.get(callId);
                if (call && call.pending) {
                    activeCalls.delete(callId);
                    sendMsg(ws, { type: 'call-timeout', callId });
                    const tws = connectedUsers.get(target);
                    if (tws) sendMsg(tws, { type: 'call-timeout', callId });
                }
            }, 30000);
            break;
        }

        case 'call-answer': {
            const call = activeCalls.get(msg.callId);
            if (!call || call.callee !== sender) {
                return sendMsg(ws, { type: 'error', message: 'Invalid call' });
            }

            call.pending = false;
            call.startedAt = Date.now();

            // Notify caller that callee accepted
            const callerWs = connectedUsers.get(call.caller);
            if (callerWs) {
                sendMsg(callerWs, { type: 'call-accepted', callId: msg.callId });
            }
            break;
        }

        case 'call-reject': {
            const call = activeCalls.get(msg.callId);
            if (!call) return;

            // Only the callee or caller can reject
            if (call.callee !== sender && call.caller !== sender) return;

            activeCalls.delete(msg.callId);

            // Notify the other party
            const otherUser = call.caller === sender ? call.callee : call.caller;
            const otherWs = connectedUsers.get(otherUser);
            if (otherWs) {
                sendMsg(otherWs, {
                    type: 'call-rejected',
                    callId: msg.callId,
                    by: sender
                });
            }
            break;
        }

        case 'sdp-offer':
        case 'sdp-answer': {
            const call = activeCalls.get(msg.callId);
            if (!call) return;

            const target = call.caller === sender ? call.callee : call.caller;
            if (target !== call.caller && target !== call.callee) return;

            const targetWs = connectedUsers.get(target);
            if (targetWs) {
                sendMsg(targetWs, {
                    type: msg.type,
                    callId: msg.callId,
                    sdp: msg.sdp
                });
            }
            break;
        }

        case 'ice-candidate': {
            const call = activeCalls.get(msg.callId);
            if (!call) return;

            const target = call.caller === sender ? call.callee : call.caller;
            const targetWs = connectedUsers.get(target);
            if (targetWs) {
                sendMsg(targetWs, {
                    type: 'ice-candidate',
                    callId: msg.callId,
                    candidate: msg.candidate
                });
            }
            break;
        }

        case 'call-end': {
            const call = activeCalls.get(msg.callId);
            if (!call) return;

            if (call.caller !== sender && call.callee !== sender) return;

            activeCalls.delete(msg.callId);

            const otherUser = call.caller === sender ? call.callee : call.caller;
            const otherWs = connectedUsers.get(otherUser);
            if (otherWs) {
                sendMsg(otherWs, { type: 'call-ended', callId: msg.callId });
            }
            break;
        }

        case 'ping':
            sendMsg(ws, { type: 'pong' });
            break;

        default:
            sendMsg(ws, { type: 'error', message: 'Unknown message type' });
    }
}

function sendMsg(ws, data) {
    if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(data));
    }
}

function sanitizeUsername(name) {
    if (typeof name !== 'string') return null;
    // Only allow alphanumeric, underscores, hyphens (match existing user validation)
    return /^[a-zA-Z0-9_-]{1,50}$/.test(name) ? name : null;
}

function isInCall(username) {
    for (const call of activeCalls.values()) {
        if (!call.pending && (call.caller === username || call.callee === username)) {
            return true;
        }
    }
    return false;
}

function endCallsForUser(username) {
    for (const [callId, call] of activeCalls.entries()) {
        if (call.caller === username || call.callee === username) {
            activeCalls.delete(callId);
            const otherUser = call.caller === username ? call.callee : call.caller;
            const otherWs = connectedUsers.get(otherUser);
            if (otherWs) {
                sendMsg(otherWs, { type: 'call-ended', callId });
            }
        }
    }
}

module.exports = { attachCallSignaling };
