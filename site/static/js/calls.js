/**
 * Rooted Revival — Private Audio/Video Calls
 * 
 * WebRTC peer-to-peer calls with WebSocket signaling.
 * Media is encrypted end-to-end via DTLS-SRTP (browser-native).
 */

const CallManager = (() => {
    // ── State ──
    let _ws = null;
    let _pc = null;          // RTCPeerConnection
    let _localStream = null;
    let _callId = null;
    let _callState = 'idle'; // idle | ringing | incoming | connected
    let _remoteUser = null;
    let _mediaType = 'audio'; // audio | video
    let _iceCandidateBuffer = [];
    let _onStateChange = null;
    let _reconnectTimer = null;
    let _reconnectAttempts = 0;
    const MAX_RECONNECT = 5;

    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];

    // ── WebSocket Signaling ──

    function getWsUrl() {
        const loc = window.location;
        if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
            return 'ws://localhost:3000/ws/calls';
        }
        return 'wss://scholar.rootedrevival.us/ws/calls';
    }

    function connect() {
        if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        _ws = new WebSocket(getWsUrl());

        _ws.onopen = () => {
            console.log('[calls] Signaling connected');
            _reconnectAttempts = 0;
            if (_reconnectTimer) {
                clearTimeout(_reconnectTimer);
                _reconnectTimer = null;
            }
        };

        _ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                handleSignalingMessage(msg);
            } catch (e) {
                console.warn('[calls] Bad message:', e);
            }
        };

        _ws.onclose = (ev) => {
            console.log('[calls] Signaling disconnected:', ev.code, ev.reason);
            // Auto-reconnect unless replaced or intentionally closed
            if (ev.code !== 1000 || ev.reason !== 'replaced') {
                scheduleReconnect();
            }
        };

        _ws.onerror = () => {
            // onclose will fire after this
        };
    }

    function scheduleReconnect() {
        if (_reconnectAttempts >= MAX_RECONNECT) return;
        _reconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(2, _reconnectAttempts - 1), 30000);
        _reconnectTimer = setTimeout(() => connect(), delay);
    }

    function disconnect() {
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
        _reconnectAttempts = MAX_RECONNECT; // prevent reconnect
        if (_ws) {
            _ws.close(1000, 'user-disconnect');
            _ws = null;
        }
    }

    function wsSend(msg) {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            _ws.send(JSON.stringify(msg));
        }
    }

    // ── Signaling Message Handler ──

    function handleSignalingMessage(msg) {
        switch (msg.type) {
            case 'connected':
                break;

            case 'call-offer':
                handleIncomingCall(msg);
                break;

            case 'call-ringing':
                _callId = msg.callId;
                setState('ringing');
                break;

            case 'call-accepted':
                startWebRTC(true); // caller creates offer
                break;

            case 'call-rejected':
                cleanup();
                setState('idle');
                showCallToast('Call declined', 'info');
                break;

            case 'call-unavailable':
                cleanup();
                setState('idle');
                showCallToast(msg.reason || 'User unavailable', 'err');
                break;

            case 'call-timeout':
                cleanup();
                setState('idle');
                showCallToast('No answer', 'info');
                break;

            case 'call-ended':
                cleanup();
                setState('idle');
                showCallToast('Call ended', 'info');
                break;

            case 'sdp-offer':
                handleSdpOffer(msg);
                break;

            case 'sdp-answer':
                handleSdpAnswer(msg);
                break;

            case 'ice-candidate':
                handleIceCandidate(msg);
                break;

            case 'replaced':
                cleanup();
                setState('idle');
                break;

            case 'error':
                console.warn('[calls] Server error:', msg.message);
                if (_callState !== 'connected') {
                    cleanup();
                    setState('idle');
                    showCallToast(msg.message, 'err');
                }
                break;
        }
    }

    // ── Incoming Call ──

    function handleIncomingCall(msg) {
        if (_callState !== 'idle') {
            // Already in a call — auto-reject
            wsSend({ type: 'call-reject', callId: msg.callId });
            return;
        }

        _callId = msg.callId;
        _remoteUser = msg.from;
        _mediaType = msg.mediaType || 'audio';
        setState('incoming');

        // Play ringtone
        playRingtone();

        // Show incoming call UI
        showIncomingCallUI(msg.fromDisplayName || msg.from, msg.mediaType);
    }

    // ── Initiate Call ──

    async function call(targetUsername, mediaType = 'audio') {
        if (_callState !== 'idle') {
            showCallToast('Already in a call', 'err');
            return;
        }

        if (!_ws || _ws.readyState !== WebSocket.OPEN) {
            showCallToast('Not connected to call server', 'err');
            return;
        }

        _remoteUser = targetUsername;
        _mediaType = mediaType;

        // Request media permission early to avoid delays
        try {
            _localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: mediaType === 'video'
            });
        } catch (e) {
            showCallToast('Could not access microphone' + (mediaType === 'video' ? '/camera' : ''), 'err');
            return;
        }

        wsSend({
            type: 'call-offer',
            target: targetUsername,
            mediaType
        });

        setState('ringing');
        showOutgoingCallUI(targetUsername, mediaType);
    }

    // ── Answer / Reject ──

    async function answer() {
        if (_callState !== 'incoming') return;

        stopRingtone();

        try {
            _localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: _mediaType === 'video'
            });
        } catch (e) {
            showCallToast('Could not access microphone' + (_mediaType === 'video' ? '/camera' : ''), 'err');
            reject();
            return;
        }

        wsSend({ type: 'call-answer', callId: _callId });
        startWebRTC(false); // callee waits for offer
    }

    function reject() {
        stopRingtone();
        wsSend({ type: 'call-reject', callId: _callId });
        cleanup();
        setState('idle');
    }

    function hangUp() {
        wsSend({ type: 'call-end', callId: _callId });
        cleanup();
        setState('idle');
    }

    // ── WebRTC ──

    function startWebRTC(isCaller) {
        _pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        // Add local tracks
        if (_localStream) {
            _localStream.getTracks().forEach(track => {
                _pc.addTrack(track, _localStream);
            });
        }

        // Remote tracks
        _pc.ontrack = (ev) => {
            const remoteVideo = document.getElementById('callRemoteMedia');
            if (remoteVideo && ev.streams[0]) {
                remoteVideo.srcObject = ev.streams[0];
            }
        };

        // ICE candidates
        _pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                wsSend({
                    type: 'ice-candidate',
                    callId: _callId,
                    candidate: ev.candidate.toJSON()
                });
            }
        };

        // Connection state
        _pc.onconnectionstatechange = () => {
            if (_pc.connectionState === 'connected') {
                setState('connected');
                showConnectedCallUI();
            } else if (_pc.connectionState === 'failed' || _pc.connectionState === 'disconnected') {
                showCallToast('Connection lost', 'err');
                hangUp();
            }
        };

        if (isCaller) {
            createAndSendOffer();
        }
        // If not caller, we wait for sdp-offer from the caller
    }

    async function createAndSendOffer() {
        try {
            const offer = await _pc.createOffer();
            await _pc.setLocalDescription(offer);
            wsSend({
                type: 'sdp-offer',
                callId: _callId,
                sdp: _pc.localDescription.toJSON()
            });
        } catch (e) {
            console.error('[calls] Failed to create offer:', e);
            hangUp();
        }
    }

    async function handleSdpOffer(msg) {
        if (!_pc) return;
        try {
            await _pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await _pc.createAnswer();
            await _pc.setLocalDescription(answer);
            wsSend({
                type: 'sdp-answer',
                callId: _callId,
                sdp: _pc.localDescription.toJSON()
            });
            // Flush buffered ICE candidates
            flushIceCandidates();
        } catch (e) {
            console.error('[calls] Failed to handle SDP offer:', e);
            hangUp();
        }
    }

    async function handleSdpAnswer(msg) {
        if (!_pc) return;
        try {
            await _pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            flushIceCandidates();
        } catch (e) {
            console.error('[calls] Failed to handle SDP answer:', e);
        }
    }

    async function handleIceCandidate(msg) {
        if (!_pc) return;
        if (!_pc.remoteDescription) {
            // Buffer until remote description is set
            _iceCandidateBuffer.push(msg.candidate);
            return;
        }
        try {
            await _pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {
            console.warn('[calls] ICE candidate error:', e);
        }
    }

    async function flushIceCandidates() {
        for (const c of _iceCandidateBuffer) {
            try {
                await _pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
                console.warn('[calls] Buffered ICE error:', e);
            }
        }
        _iceCandidateBuffer = [];
    }

    // ── Media Controls ──

    function toggleMute() {
        if (!_localStream) return false;
        const audioTrack = _localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            return !audioTrack.enabled; // return true if now muted
        }
        return false;
    }

    function toggleVideo() {
        if (!_localStream) return false;
        const videoTrack = _localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            return !videoTrack.enabled; // return true if now off
        }
        return false;
    }

    // ── Cleanup ──

    function cleanup() {
        stopRingtone();
        if (_localStream) {
            _localStream.getTracks().forEach(t => t.stop());
            _localStream = null;
        }
        if (_pc) {
            _pc.close();
            _pc = null;
        }
        _callId = null;
        _remoteUser = null;
        _iceCandidateBuffer = [];
    }

    // ── State ──

    function setState(state) {
        _callState = state;
        if (_onStateChange) _onStateChange(state, _remoteUser, _mediaType);
        updateCallUI(state);
    }

    // ── UI ──

    let _ringtoneAudio = null;

    function playRingtone() {
        try {
            // Use Web Audio API for a simple ringtone
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 440;
            gain.gain.value = 0.1;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();

            // Ring pattern: on 1s, off 2s
            let ringOn = true;
            const interval = setInterval(() => {
                gain.gain.value = ringOn ? 0 : 0.1;
                ringOn = !ringOn;
            }, 1000);

            _ringtoneAudio = { ctx, osc, gain, interval };
        } catch (e) {
            // Audio may not be permitted yet
        }
    }

    function stopRingtone() {
        if (_ringtoneAudio) {
            clearInterval(_ringtoneAudio.interval);
            try { _ringtoneAudio.osc.stop(); } catch {}
            try { _ringtoneAudio.ctx.close(); } catch {}
            _ringtoneAudio = null;
        }
    }

    function getOrCreateOverlay() {
        let overlay = document.getElementById('callOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'callOverlay';
            overlay.className = 'call-overlay hidden';
            overlay.innerHTML = `
                <div class="call-container">
                    <div class="call-header">
                        <span class="call-status" id="callStatus">Calling...</span>
                        <span class="call-timer hidden" id="callTimer">0:00</span>
                    </div>
                    <div class="call-media">
                        <video id="callRemoteMedia" autoplay playsinline></video>
                        <video id="callLocalMedia" autoplay playsinline muted class="call-local-pip"></video>
                        <div class="call-avatar" id="callAvatar">
                            <div class="call-avatar-icon">👤</div>
                            <div class="call-remote-name" id="callRemoteName"></div>
                        </div>
                    </div>
                    <div class="call-controls" id="callControls">
                        <button class="call-btn call-btn-mute" id="callBtnMute" onclick="CallManager.onMuteClick()" title="Mute">
                            🎤
                        </button>
                        <button class="call-btn call-btn-video hidden" id="callBtnVideo" onclick="CallManager.onVideoClick()" title="Toggle Video">
                            📷
                        </button>
                        <button class="call-btn call-btn-hangup" id="callBtnHangup" onclick="CallManager.onHangupClick()" title="Hang Up">
                            📞
                        </button>
                    </div>
                    <div class="call-incoming-actions hidden" id="callIncomingActions">
                        <button class="call-btn call-btn-answer" id="callBtnAnswer" onclick="CallManager.onAnswerClick()">
                            ✅ Answer
                        </button>
                        <button class="call-btn call-btn-decline" id="callBtnDecline" onclick="CallManager.onDeclineClick()">
                            ❌ Decline
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
        }
        return overlay;
    }

    function showIncomingCallUI(fromName, mediaType) {
        const overlay = getOrCreateOverlay();
        overlay.classList.remove('hidden');
        document.getElementById('callStatus').textContent = `${mediaType === 'video' ? '📹' : '📞'} Incoming ${mediaType} call`;
        document.getElementById('callRemoteName').textContent = fromName;
        document.getElementById('callAvatar').classList.remove('hidden');
        document.getElementById('callControls').classList.add('hidden');
        document.getElementById('callIncomingActions').classList.remove('hidden');
        document.getElementById('callBtnVideo').classList.toggle('hidden', mediaType !== 'video');
        document.getElementById('callRemoteMedia').classList.add('hidden');
        document.getElementById('callLocalMedia').classList.add('hidden');
    }

    function showOutgoingCallUI(targetName, mediaType) {
        const overlay = getOrCreateOverlay();
        overlay.classList.remove('hidden');
        document.getElementById('callStatus').textContent = `Calling ${targetName}...`;
        document.getElementById('callRemoteName').textContent = targetName;
        document.getElementById('callAvatar').classList.remove('hidden');
        document.getElementById('callControls').classList.remove('hidden');
        document.getElementById('callIncomingActions').classList.add('hidden');
        document.getElementById('callBtnVideo').classList.toggle('hidden', mediaType !== 'video');
        document.getElementById('callRemoteMedia').classList.add('hidden');

        // Show local preview for video calls
        const localMedia = document.getElementById('callLocalMedia');
        if (mediaType === 'video' && _localStream) {
            localMedia.srcObject = _localStream;
            localMedia.classList.remove('hidden');
        } else {
            localMedia.classList.add('hidden');
        }
    }

    function showConnectedCallUI() {
        document.getElementById('callStatus').textContent = 'Connected';
        document.getElementById('callControls').classList.remove('hidden');
        document.getElementById('callIncomingActions').classList.add('hidden');

        const remoteMedia = document.getElementById('callRemoteMedia');
        const localMedia = document.getElementById('callLocalMedia');
        const avatar = document.getElementById('callAvatar');

        if (_mediaType === 'video') {
            remoteMedia.classList.remove('hidden');
            localMedia.classList.remove('hidden');
            if (_localStream) localMedia.srcObject = _localStream;
            avatar.classList.add('hidden');
        } else {
            remoteMedia.classList.add('hidden');
            localMedia.classList.add('hidden');
            avatar.classList.remove('hidden');
        }

        // Start call timer
        startCallTimer();
    }

    function updateCallUI(state) {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) return;

        if (state === 'idle') {
            overlay.classList.add('hidden');
            stopCallTimer();
            // Reset media elements
            const remote = document.getElementById('callRemoteMedia');
            const local = document.getElementById('callLocalMedia');
            if (remote) remote.srcObject = null;
            if (local) local.srcObject = null;
        }
    }

    let _callTimerInterval = null;
    let _callStartTime = null;

    function startCallTimer() {
        _callStartTime = Date.now();
        const timerEl = document.getElementById('callTimer');
        if (timerEl) {
            timerEl.classList.remove('hidden');
            _callTimerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - _callStartTime) / 1000);
                const m = Math.floor(elapsed / 60);
                const s = elapsed % 60;
                timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
            }, 1000);
        }
    }

    function stopCallTimer() {
        if (_callTimerInterval) {
            clearInterval(_callTimerInterval);
            _callTimerInterval = null;
        }
        _callStartTime = null;
        const timerEl = document.getElementById('callTimer');
        if (timerEl) {
            timerEl.classList.add('hidden');
            timerEl.textContent = '0:00';
        }
    }

    function showCallToast(msg, type = 'info') {
        // Reuse the page toast if available
        if (typeof window.toast === 'function') {
            window.toast(msg, type === 'err' ? 'err' : 'ok');
            return;
        }
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;font-size:0.9rem;z-index:100001;animation:slideIn 0.3s;' +
            (type === 'err' ? 'background:#e53e3e;color:#fff;' : 'background:#2d3748;color:#fff;');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }

    // ── Button Handlers (called from UI) ──

    function onMuteClick() {
        const muted = toggleMute();
        const btn = document.getElementById('callBtnMute');
        if (btn) {
            btn.textContent = muted ? '🔇' : '🎤';
            btn.classList.toggle('active', muted);
        }
    }

    function onVideoClick() {
        const off = toggleVideo();
        const btn = document.getElementById('callBtnVideo');
        if (btn) {
            btn.textContent = off ? '📷' : '📹';
            btn.classList.toggle('active', off);
        }
    }

    function onHangupClick() {
        if (_callState === 'ringing') {
            // Cancel outgoing call
            wsSend({ type: 'call-reject', callId: _callId });
            cleanup();
            setState('idle');
        } else {
            hangUp();
        }
    }

    function onAnswerClick() {
        answer();
    }

    function onDeclineClick() {
        reject();
    }

    // ── Public API ──

    return {
        connect,
        disconnect,
        call,
        answer,
        reject,
        hangUp,
        toggleMute,
        toggleVideo,
        onMuteClick,
        onVideoClick,
        onHangupClick,
        onAnswerClick,
        onDeclineClick,
        get state() { return _callState; },
        get remoteUser() { return _remoteUser; },
        set onStateChange(fn) { _onStateChange = fn; },
        get isConnected() { return _ws && _ws.readyState === WebSocket.OPEN; }
    };
})();
