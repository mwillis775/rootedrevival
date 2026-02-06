/**
 * OpenSource Scholar - Frontend Application
 * 
 * Pure vanilla JavaScript SPA with routing, API calls, and UI rendering.
 */

(function() {
    'use strict';

    // ========================================
    // STATE
    // ========================================
    
    const state = {
        user: null,
        disciplines: [],
        currentPage: null
    };

    // ========================================
    // API CLIENT
    // ========================================
    
    const api = {
        async request(method, path, body = null) {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            };
            
            if (body && method !== 'GET') {
                options.body = JSON.stringify(body);
            }
            
            const response = await fetch(`/api${path}`, options);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }
            
            return data;
        },
        
        async upload(path, formData) {
            const response = await fetch(`/api${path}`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Upload failed');
            }
            
            return data;
        },
        
        get: (path) => api.request('GET', path),
        post: (path, body) => api.request('POST', path, body),
        put: (path, body) => api.request('PUT', path, body),
        delete: (path) => api.request('DELETE', path)
    };

    // ========================================
    // ROUTER
    // ========================================
    
    const routes = {
        '/': { template: 'page-home', init: initHomePage },
        '/browse': { template: 'page-browse', init: initBrowsePage },
        '/paper/:uuid': { template: 'page-paper', init: initPaperPage },
        '/login': { template: 'page-login', init: initLoginPage, guest: true },
        '/register': { template: 'page-register', init: initRegisterPage, guest: true },
        '/upload': { template: 'page-upload', init: initUploadPage, auth: true },
        '/dashboard': { template: 'page-dashboard', init: initDashboardPage, auth: true },
        '/disciplines': { template: 'page-disciplines', init: initDisciplinesPage },
        '/admin': { template: 'page-admin', init: initAdminPage, admin: true }
    };

    function matchRoute(pathname) {
        for (const [pattern, route] of Object.entries(routes)) {
            const regex = pattern
                .replace(/\//g, '\\/')
                .replace(/:([a-zA-Z0-9_]+)/g, '(?<$1>[^/]+)');
            
            const match = pathname.match(new RegExp(`^${regex}$`));
            
            if (match) {
                return { route, params: match.groups || {} };
            }
        }
        return null;
    }

    async function navigate(pathname, pushState = true) {
        const match = matchRoute(pathname);
        
        if (!match) {
            document.getElementById('main-content').innerHTML = '<section class="section"><h1>404 - Not Found</h1></section>';
            return;
        }
        
        const { route, params } = match;
        
        // Check auth requirements
        if (route.auth && !state.user) {
            return navigate('/login');
        }
        
        if (route.guest && state.user) {
            return navigate('/dashboard');
        }
        
        // Check admin requirements
        if (route.admin && (!state.user || (!state.user.isAdmin && !state.user.isModerator))) {
            return navigate('/');
        }
        
        // Update URL
        if (pushState) {
            history.pushState({}, '', pathname);
        }
        
        // Render template
        const template = document.getElementById(route.template);
        if (template) {
            document.getElementById('main-content').innerHTML = template.innerHTML;
        }
        
        // Initialize page
        if (route.init) {
            await route.init(params);
        }
        
        state.currentPage = pathname;
        
        // Scroll to top
        window.scrollTo(0, 0);
    }

    // ========================================
    // UI HELPERS
    // ========================================
    
    function $(selector) {
        return document.querySelector(selector);
    }
    
    function $$(selector) {
        return document.querySelectorAll(selector);
    }
    
    function html(strings, ...values) {
        return strings.reduce((result, str, i) => {
            const value = values[i] !== undefined ? values[i] : '';
            return result + str + (typeof value === 'string' ? escapeHtml(value) : value);
        }, '');
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    
    function truncate(text, maxLength = 200) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    function renderPaperCard(paper) {
        const authors = paper.authors?.join(', ') || 'Unknown author';
        const year = paper.publication_year || '';
        
        return `
            <article class="paper-card">
                <a href="/paper/${paper.uuid}" data-route="/paper/${paper.uuid}" class="paper-title">
                    ${escapeHtml(paper.title)}
                </a>
                <p class="paper-authors">${escapeHtml(authors)}</p>
                <p class="paper-meta">
                    <span class="paper-type">${escapeHtml(paper.paper_type || 'paper')}</span>
                    ${year ? `<span class="paper-year">${year}</span>` : ''}
                </p>
                ${paper.abstract ? `<p class="paper-abstract">${escapeHtml(truncate(paper.abstract))}</p>` : ''}
            </article>
        `;
    }
    
    function renderDisciplineCard(discipline) {
        return `
            <a href="/browse?discipline=${discipline.slug}" data-route="/browse?discipline=${discipline.slug}" class="discipline-card">
                <span class="discipline-icon">${discipline.icon || '📄'}</span>
                <span class="discipline-name">${escapeHtml(discipline.name)}</span>
            </a>
        `;
    }

    // ========================================
    // PAGE INITIALIZERS
    // ========================================
    
    async function initHomePage() {
        // Load recent papers
        try {
            const { papers } = await api.get('/papers/recent?limit=6');
            const container = $('#recent-papers');
            
            if (papers.length === 0) {
                container.innerHTML = '<p>No papers yet. Be the first to upload!</p>';
            } else {
                container.innerHTML = papers.map(renderPaperCard).join('');
            }
        } catch (e) {
            $('#recent-papers').innerHTML = '<p class="error">Failed to load papers</p>';
        }
        
        // Load disciplines
        try {
            const { disciplines } = await api.get('/disciplines');
            state.disciplines = disciplines;
            
            const topLevel = disciplines.filter(d => !d.parent_id);
            $('#disciplines-grid').innerHTML = topLevel.map(renderDisciplineCard).join('');
        } catch (e) {
            $('#disciplines-grid').innerHTML = '<p class="error">Failed to load disciplines</p>';
        }
        
        bindRouteLinks();
    }
    
    async function initBrowsePage() {
        // Load disciplines for filter
        if (state.disciplines.length === 0) {
            try {
                const { disciplines } = await api.get('/disciplines');
                state.disciplines = disciplines;
            } catch (e) {}
        }
        
        const select = $('#filterDiscipline');
        state.disciplines.filter(d => !d.parent_id).forEach(d => {
            const option = document.createElement('option');
            option.value = d.slug;
            option.textContent = d.name;
            select.appendChild(option);
        });
        
        // Check URL params
        const params = new URLSearchParams(window.location.search);
        if (params.get('discipline')) {
            select.value = params.get('discipline');
        }
        
        // Search handler
        async function doSearch() {
            const query = $('#searchInput').value;
            const discipline = $('#filterDiscipline').value;
            const type = $('#filterType').value;
            const year = $('#filterYear').value;
            
            let url = '/papers?';
            if (query) url += `q=${encodeURIComponent(query)}&`;
            if (discipline) url += `discipline=${discipline}&`;
            if (type) url += `type=${type}&`;
            if (year) url += `year=${year}&`;
            
            try {
                $('#search-results').innerHTML = '<p class="loading">Searching...</p>';
                const { papers } = await api.get(url);
                
                if (papers.length === 0) {
                    $('#search-results').innerHTML = '<p>No papers found matching your criteria.</p>';
                } else {
                    $('#search-results').innerHTML = papers.map(renderPaperCard).join('');
                }
            } catch (e) {
                $('#search-results').innerHTML = '<p class="error">Search failed</p>';
            }
            
            bindRouteLinks();
        }
        
        $('#searchBtn').addEventListener('click', doSearch);
        $('#searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') doSearch();
        });
        $('#filterDiscipline').addEventListener('change', doSearch);
        $('#filterType').addEventListener('change', doSearch);
        
        // Initial search
        doSearch();
    }
    
    async function initPaperPage(params) {
        try {
            const { paper, citations } = await api.get(`/papers/${params.uuid}`);
            
            const authors = paper.authors?.map(a => a.author_name).join(', ') || 'Unknown';
            const disciplines = paper.disciplines?.map(d => `
                <a href="/browse?discipline=${d.slug}" data-route="/browse?discipline=${d.slug}" class="tag">${d.icon} ${escapeHtml(d.name)}</a>
            `).join('') || '';
            const keywords = paper.keywords?.map(k => `<span class="tag tag-sm">${escapeHtml(k)}</span>`).join('') || '';
            
            const files = paper.files?.map(f => `
                <a href="/api/files/${f.id}/download" class="file-link">
                    📄 ${escapeHtml(f.original_filename)} 
                    <small>(${(f.file_size / 1024 / 1024).toFixed(2)} MB, v${f.version})</small>
                </a>
            `).join('') || '<p>No files uploaded yet.</p>';
            
            $('#paper-content').innerHTML = `
                <header class="paper-header">
                    <h1>${escapeHtml(paper.title)}</h1>
                    <p class="paper-authors">${escapeHtml(authors)}</p>
                    <p class="paper-meta">
                        <span class="paper-type">${escapeHtml(paper.paper_type)}</span>
                        ${paper.publication_year ? `<span>Published: ${paper.publication_year}</span>` : ''}
                        <span>Views: ${paper.view_count}</span>
                        <span>Downloads: ${paper.download_count}</span>
                    </p>
                    <div class="paper-disciplines">${disciplines}</div>
                </header>
                
                ${paper.abstract ? `
                    <section class="paper-section">
                        <h2>Abstract</h2>
                        <p>${escapeHtml(paper.abstract)}</p>
                    </section>
                ` : ''}
                
                ${keywords ? `
                    <section class="paper-section">
                        <h2>Keywords</h2>
                        <div class="tags">${keywords}</div>
                    </section>
                ` : ''}
                
                <section class="paper-section">
                    <h2>Files</h2>
                    <div class="files-list">${files}</div>
                </section>
                
                <section class="paper-section">
                    <h2>Cite this work</h2>
                    <div class="citation-tabs">
                        <button class="citation-tab active" data-format="apa">APA</button>
                        <button class="citation-tab" data-format="mla">MLA</button>
                        <button class="citation-tab" data-format="chicago">Chicago</button>
                        <button class="citation-tab" data-format="bibtex">BibTeX</button>
                    </div>
                    <div class="citation-output">
                        <pre id="citationText">${escapeHtml(citations.apa)}</pre>
                        <button class="btn btn-sm" id="copyCitation">Copy</button>
                    </div>
                </section>
                
                ${paper.doi ? `
                    <section class="paper-section">
                        <h2>External Links</h2>
                        <p><a href="https://doi.org/${paper.doi}" target="_blank" rel="noopener">DOI: ${escapeHtml(paper.doi)}</a></p>
                    </section>
                ` : ''}
            `;
            
            // Citation tab switching
            const citationData = citations;
            $$('.citation-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    $$('.citation-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const format = tab.dataset.format;
                    $('#citationText').textContent = citationData[format];
                });
            });
            
            // Copy citation
            $('#copyCitation').addEventListener('click', () => {
                navigator.clipboard.writeText($('#citationText').textContent);
                $('#copyCitation').textContent = 'Copied!';
                setTimeout(() => $('#copyCitation').textContent = 'Copy', 2000);
            });
            
        } catch (e) {
            $('#paper-content').innerHTML = `<p class="error">Failed to load paper: ${escapeHtml(e.message)}</p>`;
        }
        
        bindRouteLinks();
    }
    
    function initLoginPage() {
        $('#loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = $('#loginUsername').value;
            const password = $('#loginPassword').value;
            
            try {
                const { user } = await api.post('/auth/login', { username, password });
                state.user = user;
                updateAuthNav();
                navigate('/dashboard');
            } catch (err) {
                $('#loginError').textContent = err.message;
            }
        });
        
        bindRouteLinks();
    }
    
    function initRegisterPage() {
        $('#registerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = $('#regUsername').value;
            const email = $('#regEmail').value;
            const password = $('#regPassword').value;
            const displayName = $('#regDisplayName').value;
            
            try {
                const { user } = await api.post('/auth/register', { 
                    username, email, password, displayName 
                });
                state.user = user;
                updateAuthNav();
                navigate('/dashboard');
            } catch (err) {
                $('#registerError').textContent = err.message;
            }
        });
        
        bindRouteLinks();
    }
    
    async function initUploadPage() {
        // Load disciplines
        if (state.disciplines.length === 0) {
            try {
                const { disciplines } = await api.get('/disciplines');
                state.disciplines = disciplines;
            } catch (e) {}
        }
        
        const container = $('#disciplineCheckboxes');
        state.disciplines.filter(d => !d.parent_id).forEach(d => {
            container.innerHTML += `
                <label class="checkbox-label">
                    <input type="checkbox" name="disciplines" value="${d.id}">
                    ${d.icon} ${escapeHtml(d.name)}
                </label>
            `;
        });
        
        $('#uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            
            // Parse authors
            const authorsText = formData.get('authors');
            const authors = authorsText.split('\n').filter(Boolean).map(line => {
                const [name, email, affiliation] = line.split('|').map(s => s.trim());
                return { name, email, affiliation };
            });
            
            // Get selected disciplines
            const disciplines = [...$$('[name="disciplines"]:checked')].map(cb => parseInt(cb.value));
            
            // Parse keywords
            const keywords = formData.get('keywords').split(',').map(k => k.trim()).filter(Boolean);
            
            const data = {
                title: formData.get('title'),
                abstract: formData.get('abstract'),
                publicationYear: formData.get('publicationYear') ? parseInt(formData.get('publicationYear')) : null,
                paperType: formData.get('paperType'),
                doi: formData.get('doi') || null,
                language: formData.get('language'),
                license: formData.get('license'),
                visibility: formData.get('visibility'),
                authors: authors.length > 0 ? authors : [{ name: state.user.displayName }],
                disciplines,
                keywords
            };
            
            try {
                const { paper } = await api.post('/papers', data);
                navigate(`/paper/${paper.uuid}`);
            } catch (err) {
                $('#uploadError').textContent = err.message;
            }
        });
    }
    
    async function initDashboardPage() {
        try {
            const { papers } = await api.get('/me/papers');
            
            if (papers.length === 0) {
                $('#my-papers').innerHTML = `
                    <p>You haven't uploaded any papers yet.</p>
                    <a href="/upload" data-route="/upload" class="btn btn-primary">Upload your first paper</a>
                `;
            } else {
                $('#my-papers').innerHTML = papers.map(p => `
                    <article class="paper-card">
                        <a href="/paper/${p.uuid}" data-route="/paper/${p.uuid}" class="paper-title">
                            ${escapeHtml(p.title)}
                        </a>
                        <p class="paper-meta">
                            <span class="paper-status status-${p.status}">${p.status}</span>
                            <span class="paper-type">${escapeHtml(p.paper_type)}</span>
                            <span>Views: ${p.view_count}</span>
                            <span>Downloads: ${p.download_count}</span>
                        </p>
                    </article>
                `).join('');
            }
        } catch (e) {
            $('#my-papers').innerHTML = `<p class="error">Failed to load papers: ${escapeHtml(e.message)}</p>`;
        }
        
        bindRouteLinks();
    }
    
    async function initDisciplinesPage() {
        try {
            const { disciplines } = await api.get('/disciplines');
            state.disciplines = disciplines;
            
            const topLevel = disciplines.filter(d => !d.parent_id);
            
            let html = '';
            for (const parent of topLevel) {
                const children = disciplines.filter(d => d.parent_id === parent.id);
                
                html += `
                    <div class="discipline-group">
                        <h2>${parent.icon} ${escapeHtml(parent.name)}</h2>
                        <p>${escapeHtml(parent.description || '')}</p>
                        <div class="discipline-children">
                            ${children.map(c => `
                                <a href="/browse?discipline=${c.slug}" data-route="/browse?discipline=${c.slug}" class="tag tag-lg">
                                    ${c.icon} ${escapeHtml(c.name)}
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            $('#all-disciplines').innerHTML = html;
        } catch (e) {
            $('#all-disciplines').innerHTML = '<p class="error">Failed to load disciplines</p>';
        }
        
        bindRouteLinks();
    }

    // ========================================
    // ADMIN PAGE
    // ========================================
    
    async function initAdminPage() {
        // Load stats
        try {
            const { totalUsers, totalPapers, totalDownloads, pendingPapers, bannedUsers } = await api.get('/admin/stats');
            $('#admin-stats').innerHTML = `
                <div class="stats-grid">
                    <div class="stat-card">
                        <span class="stat-value">${totalUsers}</span>
                        <span class="stat-label">Users</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value">${totalPapers}</span>
                        <span class="stat-label">Papers</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value">${totalDownloads}</span>
                        <span class="stat-label">Downloads</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value">${pendingPapers}</span>
                        <span class="stat-label">Pending Review</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value">${bannedUsers}</span>
                        <span class="stat-label">Banned</span>
                    </div>
                </div>
            `;
        } catch (e) {
            $('#admin-stats').innerHTML = '<p class="error">Failed to load stats</p>';
        }
        
        // Tab switching
        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.tab-btn').forEach(b => b.classList.remove('active'));
                $$('.tab-content').forEach(c => c.classList.add('hidden'));
                btn.classList.add('active');
                $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
            });
        });
        
        // Load pending papers
        await loadPendingPapers();
        
        // User search
        $('#userSearchBtn')?.addEventListener('click', async () => {
            const search = $('#userSearchInput').value;
            await loadAdminUsers(search);
        });
        
        // Load moderation log
        await loadModerationLog();
    }
    
    async function loadPendingPapers() {
        try {
            const { papers } = await api.get('/admin/papers/pending');
            if (papers.length === 0) {
                $('#pending-papers').innerHTML = '<p>No papers pending review.</p>';
            } else {
                $('#pending-papers').innerHTML = papers.map(paper => `
                    <article class="paper-card paper-pending">
                        <div class="paper-info">
                            <span class="paper-title">${escapeHtml(paper.title)}</span>
                            <p class="paper-meta">by ${escapeHtml(paper.username)} • ${formatDate(paper.created_at)}</p>
                        </div>
                        <div class="paper-actions">
                            <button class="btn btn-success btn-sm" onclick="approveP(${paper.id})">Approve</button>
                            <button class="btn btn-danger btn-sm" onclick="rejectP(${paper.id})">Reject</button>
                        </div>
                    </article>
                `).join('');
            }
        } catch (e) {
            $('#pending-papers').innerHTML = '<p class="error">Failed to load pending papers</p>';
        }
    }
    
    async function loadAdminUsers(search = '') {
        try {
            const { users } = await api.get(`/admin/users?search=${encodeURIComponent(search)}`);
            if (users.length === 0) {
                $('#admin-users').innerHTML = '<p>No users found.</p>';
            } else {
                $('#admin-users').innerHTML = users.map(user => `
                    <div class="user-row ${user.is_banned ? 'user-banned' : ''}">
                        <div class="user-info">
                            <strong>${escapeHtml(user.username)}</strong>
                            <span class="user-email">${escapeHtml(user.email)}</span>
                            ${user.is_admin ? '<span class="badge badge-admin">Admin</span>' : ''}
                            ${user.is_moderator ? '<span class="badge badge-mod">Mod</span>' : ''}
                            ${user.is_banned ? '<span class="badge badge-banned">Banned</span>' : ''}
                        </div>
                        <div class="user-meta">
                            <span>Papers: ${user.paper_count || 0}</span>
                            <span>Joined: ${formatDate(user.created_at)}</span>
                        </div>
                        <div class="user-actions">
                            ${user.is_banned 
                                ? `<button class="btn btn-sm" onclick="unbanU(${user.id})">Unban</button>`
                                : `<button class="btn btn-danger btn-sm" onclick="banU(${user.id})">Ban</button>`
                            }
                        </div>
                    </div>
                `).join('');
            }
        } catch (e) {
            $('#admin-users').innerHTML = '<p class="error">Failed to load users</p>';
        }
    }
    
    async function loadModerationLog() {
        try {
            const { log } = await api.get('/admin/moderation-log');
            if (log.length === 0) {
                $('#moderation-log').innerHTML = '<p>No moderation actions yet.</p>';
            } else {
                $('#moderation-log').innerHTML = log.map(entry => `
                    <div class="log-entry">
                        <span class="log-action">${escapeHtml(entry.action)}</span>
                        <span class="log-target">${escapeHtml(entry.target_type)} #${entry.target_id}</span>
                        <span class="log-mod">by ${escapeHtml(entry.moderator_username)}</span>
                        <span class="log-time">${formatDate(entry.created_at)}</span>
                        ${entry.reason ? `<span class="log-reason">${escapeHtml(entry.reason)}</span>` : ''}
                    </div>
                `).join('');
            }
        } catch (e) {
            $('#moderation-log').innerHTML = '<p class="error">Failed to load log</p>';
        }
    }
    
    // Global admin action functions (exposed for onclick handlers)
    window.approveP = async (id) => {
        if (confirm('Approve this paper?')) {
            await api.post(`/admin/papers/${id}/approve`);
            loadPendingPapers();
        }
    };
    
    window.rejectP = async (id) => {
        const reason = prompt('Reason for rejection:');
        if (reason !== null) {
            await api.post(`/admin/papers/${id}/reject`, { reason });
            loadPendingPapers();
        }
    };
    
    window.banU = async (id) => {
        const reason = prompt('Reason for ban:');
        if (reason !== null) {
            await api.post(`/admin/users/${id}/ban`, { reason });
            loadAdminUsers($('#userSearchInput')?.value || '');
        }
    };
    
    window.unbanU = async (id) => {
        if (confirm('Unban this user?')) {
            await api.post(`/admin/users/${id}/unban`);
            loadAdminUsers($('#userSearchInput')?.value || '');
        }
    };

    // ========================================
    // AUTH & NAV
    // ========================================
    
    function updateAuthNav() {
        const authNav = $('.auth-nav');
        
        if (state.user) {
            authNav.innerHTML = document.getElementById('user-nav').innerHTML;
            $('#logoutBtn')?.addEventListener('click', logout);
            
            // Show/hide admin link based on role
            const adminLink = $('#adminLink');
            if (adminLink && (state.user.isAdmin || state.user.isModerator)) {
                adminLink.classList.remove('hidden');
            }
        } else {
            authNav.innerHTML = document.getElementById('guest-nav').innerHTML;
        }
        
        bindRouteLinks();
    }
    
    async function logout() {
        try {
            await api.post('/auth/logout');
        } catch (e) {}
        
        state.user = null;
        updateAuthNav();
        navigate('/');
    }
    
    async function checkAuth() {
        try {
            const { user } = await api.get('/auth/me');
            state.user = user;
        } catch (e) {
            state.user = null;
        }
        updateAuthNav();
    }

    // ========================================
    // EVENT BINDING
    // ========================================
    
    function bindRouteLinks() {
        $$('[data-route]').forEach(link => {
            if (link.dataset.bound) return;
            link.dataset.bound = 'true';
            
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const path = link.getAttribute('href') || link.dataset.route;
                navigate(path);
            });
        });
    }

    // ========================================
    // IPFS MODAL
    // ========================================
    
    function initIpfsModal() {
        const modal = $('#ipfsModal');
        const btn = $('#ipfsHelpBtn');
        
        btn.addEventListener('click', async () => {
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            
            // Check IPFS status
            try {
                const status = await api.get('/ipfs/status');
                if (status.running) {
                    $('#ipfsStatus').innerHTML = `
                        <p class="success">✓ Your IPFS node is running!</p>
                        <p>Peer ID: <code>${status.peerId}</code></p>
                    `;
                } else {
                    $('#ipfsStatus').innerHTML = '<p>IPFS node not detected. Install Kubo to get started.</p>';
                }
            } catch (e) {
                $('#ipfsStatus').innerHTML = '<p>Could not check IPFS status.</p>';
            }
        });
        
        modal.querySelectorAll('[data-close]').forEach(el => {
            el.addEventListener('click', () => {
                modal.classList.remove('is-open');
                modal.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
            });
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('is-open')) {
                modal.classList.remove('is-open');
                modal.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
            }
        });
    }

    // ========================================
    // INIT
    // ========================================
    
    async function init() {
        // Check auth status
        await checkAuth();
        
        // Setup navigation
        window.addEventListener('popstate', () => {
            navigate(window.location.pathname, false);
        });
        
        // Bind header links
        bindRouteLinks();
        
        // Init IPFS modal
        initIpfsModal();
        
        // Check if running in Electron desktop app
        initDesktopIntegration();
        
        // Navigate to current path
        navigate(window.location.pathname, false);
    }
    
    // ========================================
    // DESKTOP APP INTEGRATION
    // ========================================
    
    function initDesktopIntegration() {
        // Check if we're running inside the Electron desktop app
        if (window.rootedAPI) {
            console.log('Running in Rooted Revival OS desktop app');
            
            // Show the back to launcher link
            const launcherLink = document.getElementById('backToLauncher');
            if (launcherLink) {
                launcherLink.classList.remove('web-hidden');
                launcherLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.rootedAPI.loadLauncher();
                });
            }
            
            // Handle "Open Rooted Revival" footer link
            const revivalLink = document.getElementById('openRevival');
            if (revivalLink) {
                revivalLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.rootedAPI.loadRevival();
                });
            }
            
            // Override external link behavior
            document.querySelectorAll('a[target="_blank"]').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.rootedAPI.openExternal(link.href);
                });
            });
            
            // Enhanced IPFS integration when in desktop app
            const ipfsBtn = document.getElementById('ipfsHelpBtn');
            if (ipfsBtn) {
                ipfsBtn.textContent = '🛰️ IPFS Node Running';
                ipfsBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)';
                
                // Update IPFS status periodically
                updateDesktopIpfsStatus();
                setInterval(updateDesktopIpfsStatus, 10000);
            }
        }
        
        // Handle download app button (for web users)
        const downloadBtn = document.getElementById('downloadApp');
        if (downloadBtn && !window.rootedAPI) {
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // Open download page or show download modal
                window.open('https://github.com/rootedrevival/releases', '_blank');
            });
        } else if (downloadBtn && window.rootedAPI) {
            downloadBtn.textContent = '✓ App Running';
            downloadBtn.disabled = true;
            downloadBtn.style.opacity = '0.7';
        }
    }
    
    async function updateDesktopIpfsStatus() {
        if (!window.rootedAPI) return;
        
        try {
            const status = await window.rootedAPI.getIPFSStatus();
            const btn = document.getElementById('ipfsHelpBtn');
            if (btn && status.running) {
                btn.textContent = `🛰️ ${status.peerCount} IPFS Peers`;
            } else if (btn) {
                btn.textContent = '🛰️ IPFS Offline';
                btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            }
        } catch (e) {
            console.error('Failed to update IPFS status:', e);
        }
    }
    
    // Start app
    document.addEventListener('DOMContentLoaded', init);

})();
