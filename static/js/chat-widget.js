/**
 * Rooted Revival — Support Chat Widget
 * 
 * Simple predetermined Q&A chatbot (no AI).
 * Appears as a floating widget on every page.
 */

const ChatWidget = (() => {
    const COMPANY = 'Rooted Revival';
    const BOT_NAME = 'Sage';

    const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://scholar.rootedrevival.us';

    let _aiMode = false;       // false = predetermined Q&A, true = AI chat
    let _aiAvailable = false;
    let _aiHistory = [];       // conversation history for AI context

    // ── Knowledge Tree ──
    // Each node: { q: display question, a: answer text, children: [...sub-options] }
    const TREE = {
        greeting: `Hey there! 👋 I'm ${BOT_NAME}, ${COMPANY}'s virtual assistant. How can I help you today?`,
        options: [
            {
                q: '🌿 What services do you offer?',
                a: `We offer a full range of regenerative landscaping, construction, and technology services:\n\n` +
                   `🌱 **Growing Systems** — In-ground gardens, food forests, hydroponics, aeroponics, native plantings, pollinator habitat\n` +
                   `🏗️ **Greenhouses & CEA** — Custom design/build, climate control, electrical, lighting, automation, fertigation\n` +
                   `🔧 **Construction** — Concrete, general contracting, electrical, plumbing, earthwork, structures\n` +
                   `💻 **Technology** — Environment monitoring, automation software, custom hardware/electronics, data analytics\n` +
                   `🗺️ **Consulting** — Site assessment, system design, soil/water analysis, project planning\n` +
                   `📐 **CAD Drafting** — Technical drawings, plans, and design documentation\n\n` +
                   `We also do software development, hardware design, and decentralized web infrastructure.`,
                children: [
                    {
                        q: '💰 How much does a consultation cost?',
                        a: `**Free consultations** for the Tulsa metro area! For remote or out-of-area projects, we offer virtual consultations at competitive hourly rates. Every project starts with understanding your goals — no pressure, no upsells.`,
                        children: []
                    },
                    {
                        q: '📐 Tell me about CAD drafting',
                        a: `We provide professional CAD drafting for:\n\n• Greenhouse & growing facility plans\n• Site layouts & landscape designs\n• Electrical & plumbing schematics\n• Custom hardware/enclosure designs\n• Permit-ready construction drawings\n\nWe work in industry-standard formats and can collaborate with your existing team or architect.`,
                        children: []
                    },
                    {
                        q: '🌱 I want a backyard garden',
                        a: `Great choice! We design and build gardens of all sizes:\n\n• **Raised beds** — Cedar, steel, or stone\n• **In-ground beds** — No-till, hugelkultur, traditional\n• **Food forests** — Perennial, low-maintenance\n• **Container gardens** — Patios and small spaces\n\nWe start with a site visit to understand your soil, sun exposure, and what you want to grow. Then we design a plan that fits your space and budget.\n\nFree consultations in the Tulsa area!`,
                        children: []
                    },
                    {
                        q: '🏗️ I need a greenhouse',
                        a: `We design and build greenhouses from the ground up — literally. That means:\n\n• Foundation & concrete\n• Steel or wood framing\n• Glazing (poly, polycarbonate, glass)\n• HVAC & climate control\n• Electrical & grow lighting\n• Automation & monitoring\n• Fertigation systems\n\nFrom hobby-scale to commercial production. One team handles everything — no gaps between trades.\n\nTell us about your project size and goals and we'll put together a plan.`,
                        children: []
                    }
                ]
            },
            {
                q: '💰 What are your rates?',
                a: `Our pricing varies by service type:\n\n` +
                   `• **Consultations** — Free in Tulsa metro; competitive hourly rates for remote\n` +
                   `• **Design & Planning** — Project-based quotes after initial consultation\n` +
                   `• **Installation & Build** — Based on scope, materials, and labor. We provide detailed estimates before any work begins\n` +
                   `• **Technology & Software** — Hourly or project-based depending on scope\n` +
                   `• **CAD Drafting** — Per-drawing or hourly rates\n` +
                   `• **Ongoing Maintenance** — Monthly or seasonal packages available\n\n` +
                   `We don't do hidden fees or surprise charges. You'll know exactly what you're paying for before we start.`,
                children: [
                    {
                        q: '📋 Can I get a quote?',
                        a: `Absolutely! The best way to get a quote is to:\n\n1. **Contact us** through the contact form on our site\n2. Tell us about your project — what you want, where you are, rough timeline\n3. We'll set up a consultation (free in Tulsa metro)\n4. After the consultation you'll get a detailed written estimate\n\nNo obligation, no pressure. We want you to make the right decision for your project.`,
                        children: []
                    }
                ]
            },
            {
                q: '📍 Where are you located?',
                a: `We're based in **Tulsa, Oklahoma** and serve the greater Tulsa metro area for on-site work.\n\nFor consulting, design, CAD, and technology services, we work with clients remotely anywhere.\n\nLocal service areas include Tulsa, Broken Arrow, Owasso, Jenks, Bixby, Sand Springs, Sapulpa, and surrounding communities.`,
                children: [
                    {
                        q: '🚗 Do you travel for projects?',
                        a: `Yes! For larger projects we'll travel beyond the Tulsa metro. Travel fees may apply for distant locations, but we'll always be upfront about costs.\n\nFor consulting and design, we can work remotely with clients anywhere in the US.`,
                        children: []
                    }
                ]
            },
            {
                q: '📚 What is Open Scholar?',
                a: `**Open Scholar** is our free, open-access knowledge archive. Think of it like a library anyone can contribute to:\n\n• Upload and share research papers, videos, music, art, and more\n• Everything is freely accessible — no paywalls\n• End-to-end encrypted messaging between users\n• Built on **GrabNet**, our decentralized hosting network\n\nWe believe knowledge should be free and accessible to everyone. Open Scholar is how we put that into practice.`,
                children: [
                    {
                        q: '🔗 What is GrabNet?',
                        a: `**GrabNet** is our custom peer-to-peer network for decentralized web hosting. It powers this entire website!\n\n• Content-addressed storage (like IPFS, but purpose-built)\n• Sites can't be censored or taken down\n• Peers help distribute content automatically\n• Built in Rust for speed and reliability\n\nThe whole Rooted Revival site is published on GrabNet. You can even run a node and help host it yourself!`,
                        children: []
                    }
                ]
            },
            {
                q: '📞 How do I contact a human?',
                a: `You have several options:\n\n• **Contact form** — Use the form at the bottom of our homepage\n• **Direct message** — If you have an account, you can message "theboss" directly from your profile\n• **Audio/Video call** — Log in and visit theboss's profile to start a call\n• **Email** — Reach out through the contact form and we'll reply to your email\n\nMichael (the founder) reads every message personally. Response time is usually within a few hours during business days.`,
                children: []
            },
            {
                q: '🛒 Do you sell products?',
                a: `Yes! We have a small shop with:\n\n• **Limited-run prints** — Nature and botanical artwork\n• **Apparel** — T-shirts, hoodies, and more with Rooted Revival designs\n• **Merchandise** — Various items through our Printful and Square integrations\n\nCheck out the Shop page for current offerings. New items added regularly!`,
                children: []
            }
        ]
    };

    let _isOpen = false;
    let _historyStack = []; // navigation stack for back button
    let _container = null;

    function init() {
        if (document.getElementById('chatWidget')) return;
        injectStyles();
        injectHTML();
        _container = document.getElementById('chatWidget');
        showGreeting();
        // Check if AI assistant is available
        checkAIAvailability();
    }

    async function checkAIAvailability() {
        try {
            const res = await fetch(`${API}/api/assistant/status`);
            if (res.ok) {
                const data = await res.json();
                _aiAvailable = data.available;
            }
        } catch {
            _aiAvailable = false;
        }
    }

    async function handleAIChat(text) {
        _aiHistory.push({ role: 'user', content: text });

        // Show typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'cw-msg bot';
        typingEl.innerHTML = '<em style="color:var(--text-muted)">Sage is thinking...</em>';
        typingEl.id = 'cwTyping';
        document.getElementById('cwMessages').appendChild(typingEl);
        scrollBottom();

        try {
            const res = await fetch(`${API}/api/assistant/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ message: text, history: _aiHistory.slice(-10) })
            });

            const data = await res.json();
            typingEl.remove();

            const reply = data.reply || "Sorry, I couldn't process that. Try again or type 'menu' for quick answers.";
            _aiHistory.push({ role: 'assistant', content: reply });

            addBotMessage(reply);
        } catch (e) {
            typingEl.remove();
            addBotMessage("I'm having trouble connecting right now. Type **menu** to go back to quick answers, or try the contact form.");
        }
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #chatWidgetBtn {
                position: fixed; bottom: 24px; right: 24px; z-index: 99998;
                width: 60px; height: 60px; border-radius: 50%;
                background: var(--accent, #33ff33); color: var(--bg, #0a0a0a);
                border: none; font-size: 1.6rem; cursor: pointer;
                box-shadow: 0 4px 20px rgba(51,255,51,0.3);
                transition: all 0.3s; display: flex; align-items: center; justify-content: center;
            }
            #chatWidgetBtn:hover { transform: scale(1.1); box-shadow: 0 4px 30px rgba(51,255,51,0.5); }
            #chatWidgetBtn.open { display: none; }

            #chatWidget {
                position: fixed; bottom: 24px; right: 24px; z-index: 99999;
                width: 380px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 48px);
                background: var(--bg-surface, #111); border: 1px solid var(--border, #333);
                border-radius: 16px; display: none; flex-direction: column;
                box-shadow: 0 8px 40px rgba(0,0,0,0.6); overflow: hidden;
                font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
            }
            #chatWidget.open { display: flex; }

            .cw-header {
                padding: 16px 20px; background: var(--bg-elevated, #1a1a1a);
                border-bottom: 1px solid var(--border, #333);
                display: flex; align-items: center; justify-content: space-between;
            }
            .cw-header-left { display: flex; align-items: center; gap: 10px; }
            .cw-header-avatar { font-size: 1.3rem; }
            .cw-header-name { font-size: 0.95rem; font-weight: 600; color: var(--text, #e0e0e0); }
            .cw-header-status { font-size: 0.75rem; color: var(--accent, #33ff33); }
            .cw-close {
                background: none; border: none; color: var(--text-muted, #888);
                font-size: 1.3rem; cursor: pointer; padding: 4px 8px; border-radius: 6px;
            }
            .cw-close:hover { background: var(--bg, #0a0a0a); color: var(--text, #e0e0e0); }

            .cw-messages {
                flex: 1; overflow-y: auto; padding: 16px;
                display: flex; flex-direction: column; gap: 12px;
                scrollbar-width: thin; scrollbar-color: var(--border, #333) transparent;
            }

            .cw-msg {
                max-width: 90%; padding: 12px 16px; border-radius: 12px;
                font-size: 0.88rem; line-height: 1.6; white-space: pre-line;
            }
            .cw-msg.bot {
                background: var(--bg-elevated, #1a1a1a); color: var(--text, #e0e0e0);
                border-bottom-left-radius: 4px; align-self: flex-start;
                border: 1px solid var(--border, #333);
            }
            .cw-msg.user {
                background: var(--accent, #33ff33); color: var(--bg, #0a0a0a);
                border-bottom-right-radius: 4px; align-self: flex-end;
                font-weight: 500;
            }
            .cw-msg b, .cw-msg strong { color: var(--accent, #33ff33); font-weight: 600; }
            .cw-msg.bot b, .cw-msg.bot strong { color: var(--accent, #33ff33); }

            .cw-options {
                padding: 0 16px 16px; display: flex; flex-direction: column; gap: 6px;
            }
            .cw-opt {
                background: var(--bg, #0a0a0a); border: 1px solid var(--border, #333);
                color: var(--text, #e0e0e0); padding: 10px 14px; border-radius: 10px;
                cursor: pointer; font-size: 0.85rem; text-align: left;
                transition: all 0.2s; font-family: inherit;
            }
            .cw-opt:hover { border-color: var(--accent, #33ff33); color: var(--accent, #33ff33); background: var(--accent-dim, rgba(51,255,51,0.08)); }

            .cw-back {
                background: none; border: none; color: var(--text-muted, #888);
                font-size: 0.8rem; cursor: pointer; padding: 8px 16px 4px;
                text-align: left; font-family: inherit;
            }
            .cw-back:hover { color: var(--accent, #33ff33); }

            .cw-footer {
                padding: 12px 16px; border-top: 1px solid var(--border, #333);
                display: flex; gap: 8px; align-items: center;
            }
            .cw-input {
                flex: 1; background: var(--bg, #0a0a0a); border: 1px solid var(--border, #333);
                border-radius: 10px; padding: 10px 14px; color: var(--text, #e0e0e0);
                font-size: 0.88rem; font-family: inherit; outline: none;
            }
            .cw-input:focus { border-color: var(--accent, #33ff33); }
            .cw-input::placeholder { color: var(--text-muted, #888); }
            .cw-send {
                background: var(--accent, #33ff33); color: var(--bg, #0a0a0a);
                border: none; border-radius: 10px; padding: 10px 16px;
                font-size: 0.88rem; cursor: pointer; font-weight: 600; font-family: inherit;
            }
            .cw-send:hover { filter: brightness(1.1); }

            @media (max-width: 500px) {
                #chatWidget { width: calc(100vw - 16px); right: 8px; bottom: 8px; height: calc(100vh - 80px); border-radius: 12px; }
                #chatWidgetBtn { bottom: 16px; right: 16px; width: 52px; height: 52px; font-size: 1.4rem; }
            }
        `;
        document.head.appendChild(style);
    }

    function injectHTML() {
        // Floating button
        const btn = document.createElement('button');
        btn.id = 'chatWidgetBtn';
        btn.innerHTML = '💬';
        btn.title = `Chat with ${BOT_NAME}`;
        btn.onclick = () => toggle(true);
        document.body.appendChild(btn);

        // Chat panel
        const widget = document.createElement('div');
        widget.id = 'chatWidget';
        widget.innerHTML = `
            <div class="cw-header">
                <div class="cw-header-left">
                    <span class="cw-header-avatar">🌱</span>
                    <div>
                        <div class="cw-header-name">${BOT_NAME}</div>
                        <div class="cw-header-status">● Online</div>
                    </div>
                </div>
                <button class="cw-close" onclick="ChatWidget.toggle(false)" title="Close">✕</button>
            </div>
            <div class="cw-messages" id="cwMessages"></div>
            <div class="cw-options" id="cwOptions"></div>
            <div class="cw-footer">
                <input class="cw-input" id="cwInput" placeholder="Type a message..." autocomplete="off">
                <button class="cw-send" id="cwSend" onclick="ChatWidget.handleFreeText()">Send</button>
            </div>`;
        document.body.appendChild(widget);

        // Enter key
        document.getElementById('cwInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') ChatWidget.handleFreeText();
        });
    }

    function toggle(open) {
        _isOpen = open;
        document.getElementById('chatWidget').classList.toggle('open', open);
        document.getElementById('chatWidgetBtn').classList.toggle('open', open);
        if (open) {
            setTimeout(() => document.getElementById('cwInput').focus(), 100);
        }
    }

    function showGreeting() {
        clearChat();
        addBotMessage(TREE.greeting);
        showOptions(TREE.options, false);
        _historyStack = [];
    }

    function addBotMessage(text) {
        const el = document.createElement('div');
        el.className = 'cw-msg bot';
        el.innerHTML = formatText(text);
        document.getElementById('cwMessages').appendChild(el);
        scrollBottom();
    }

    function addUserMessage(text) {
        const el = document.createElement('div');
        el.className = 'cw-msg user';
        el.textContent = text;
        document.getElementById('cwMessages').appendChild(el);
        scrollBottom();
    }

    function showOptions(options, showBack = true) {
        const container = document.getElementById('cwOptions');
        container.innerHTML = '';

        if (showBack) {
            const backBtn = document.createElement('button');
            backBtn.className = 'cw-back';
            backBtn.textContent = '← Back';
            backBtn.onclick = goBack;
            container.appendChild(backBtn);
        }

        options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'cw-opt';
            btn.textContent = opt.q;
            btn.onclick = () => selectOption(opt);
            container.appendChild(btn);
        });
    }

    function selectOption(opt) {
        addUserMessage(opt.q);

        // Special: switch to AI mode
        if (opt.a === '__AI_MODE__') {
            _aiMode = true;
            _aiHistory = [];
            setTimeout(() => {
                addBotMessage(`🤖 You're now chatting with **Sage AI** — I can answer detailed questions about our services, pricing, growing methods, technology, and more.\n\nJust type your question below. Type "menu" to go back to the quick answers.`);
                document.getElementById('cwOptions').innerHTML = '';
                document.getElementById('cwInput').focus();
            }, 300);
            return;
        }

        // Special: start over
        if (opt.a === null) {
            _aiMode = false;
            _aiHistory = [];
            setTimeout(() => showGreeting(), 200);
            return;
        }

        // Push current state to history
        _historyStack.push(() => {});

        setTimeout(() => {
            addBotMessage(opt.a);

            if (opt.children && opt.children.length > 0) {
                const combined = [...opt.children, ...getGenericFollowups()];
                showOptions(combined, true);
            } else {
                showOptions(getGenericFollowups(), true);
            }
        }, 300);
    }

    function getGenericFollowups() {
        const followups = [
            {
                q: '📞 Talk to a human',
                a: `You can reach Michael (the founder) by:\n\n• **Direct message** — Log in and message "theboss" from your profile\n• **Contact form** — Use the form on our homepage\n• **Audio/Video call** — Log in and visit theboss's user profile to call directly\n\nResponse time is usually within a few hours on business days.`,
                children: []
            }
        ];
        if (_aiAvailable) {
            followups.push({
                q: '🤖 Ask Sage AI (detailed questions)',
                a: '__AI_MODE__',
                children: []
            });
        }
        followups.push({
            q: '🔄 Start over',
            a: null,
            children: []
        });
        return followups;
    }

    function goBack() {
        // Simply restart — simpler and more reliable than complex state management
        showGreeting();
    }

    function handleFreeText() {
        const input = document.getElementById('cwInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';

        addUserMessage(text);

        // If in AI mode, route to AI
        if (_aiMode) {
            if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'start over') {
                _aiMode = false;
                _aiHistory = [];
                showGreeting();
                return;
            }
            handleAIChat(text);
            return;
        }

        // Simple keyword matching for predetermined mode
        const lower = text.toLowerCase();
        let response = null;

        if (lower.match(/\b(price|cost|rate|how much|pricing|quote|estimate|budget)\b/)) {
            response = TREE.options.find(o => o.q.includes('rates'));
        } else if (lower.match(/\b(service|offer|do you do|what do you|help with)\b/)) {
            response = TREE.options.find(o => o.q.includes('services'));
        } else if (lower.match(/\b(where|location|located|tulsa|area|address)\b/)) {
            response = TREE.options.find(o => o.q.includes('located'));
        } else if (lower.match(/\b(scholar|archive|paper|research|upload)\b/)) {
            response = TREE.options.find(o => o.q.includes('Scholar'));
        } else if (lower.match(/\b(human|person|talk|call|phone|speak|contact|michael|email)\b/)) {
            response = { a: `You can reach Michael (the founder) by:\n\n• **Direct message** — Log in and message "theboss" from your profile\n• **Contact form** — Use the form on our homepage\n• **Audio/Video call** — Log in and visit theboss's user profile to call directly\n\nResponse time is usually within a few hours on business days.` };
        } else if (lower.match(/\b(shop|product|buy|merch|shirt|print)\b/)) {
            response = TREE.options.find(o => o.q.includes('products'));
        } else if (lower.match(/\b(garden|plant|grow|food forest|bed)\b/)) {
            response = { a: `We'd love to help you grow! We build everything from simple raised beds to full food forests.\n\nFor a personalized recommendation, use the contact form on our homepage or message "theboss" directly. Free consultations in the Tulsa metro area!` };
        } else if (lower.match(/\b(greenhouse|cea|controlled environment)\b/)) {
            response = { a: `We design and build custom greenhouses from the ground up — foundation, framing, glazing, HVAC, electrical, automation, and more.\n\nTell us about your project through the contact form and we'll set up a consultation!` };
        } else if (lower.match(/\b(cad|draft|drawing|blueprint|plan)\b/)) {
            response = { a: `We provide professional CAD drafting for greenhouse plans, site layouts, electrical schematics, hardware designs, and permit-ready construction drawings.\n\nReach out through the contact form with your project details for a quote!` };
        } else if (lower.match(/\b(grabnet|p2p|decentralized|peer)\b/)) {
            response = { a: `**GrabNet** is our custom peer-to-peer network that powers this website. Content-addressed, censorship-resistant, built in Rust.\n\nYou can even run a node yourself! Check out the Download page for the desktop app.` };
        } else if (lower.match(/\b(hi|hello|hey|sup|yo|howdy)\b/)) {
            response = { a: `Hey! 👋 How can I help you today? You can ask me about our services, pricing, location, or anything else about Rooted Revival.` };
        } else if (lower.match(/\b(thanks|thank|thx|ty|appreciate)\b/)) {
            response = { a: `You're welcome! Let me know if there's anything else I can help with. 🌱` };
        } else if (lower.match(/\b(bye|goodbye|cya|later)\b/)) {
            response = { a: `Take care! Feel free to come back anytime. 🌱` };
        }

        setTimeout(() => {
            if (response && response.a) {
                addBotMessage(response.a);
                if (response.children && response.children.length > 0) {
                    showOptions([...response.children, ...getGenericFollowups()], true);
                } else {
                    showOptions(getGenericFollowups(), true);
                }
            } else if (response === null || (response && response.a === null)) {
                // Start over case or no match
                if (text.toLowerCase().includes('start over')) {
                    showGreeting();
                } else {
                    addBotMessage(`I'm not sure I understand that one. Here are some things I can help with:`);
                    showOptions(TREE.options, false);
                }
            }
        }, 400);
    }

    function formatText(text) {
        // Simple markdown-like formatting
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>')
            .replace(/• /g, '&bull; ');
    }

    function clearChat() {
        document.getElementById('cwMessages').innerHTML = '';
        document.getElementById('cwOptions').innerHTML = '';
    }

    function scrollBottom() {
        const el = document.getElementById('cwMessages');
        setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { toggle, handleFreeText, init };
})();
