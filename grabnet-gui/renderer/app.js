/**
 * GrabNet Desktop - Renderer Application
 */

class GrabNetApp {
    constructor() {
        this.currentView = 'projects';
        this.projects = [];
        this.nodeRunning = false;
        
        this.init();
    }

    async init() {
        // Check if running in Electron
        if (!window.grabAPI) {
            console.error('Not running in Electron context');
            return;
        }

        // Load initial data
        await this.loadProjects();
        await this.checkNodeStatus();
        await this.loadSettings();
        await this.checkGrabBinary();

        // Set up navigation
        this.setupNavigation();
        this.setupEventListeners();
        this.setupIPCListeners();

        // Start status polling
        setInterval(() => this.checkNodeStatus(), 5000);
    }

    // ========================================
    // NAVIGATION
    // ========================================

    setupNavigation() {
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                this.navigateTo(view);
            });
        });
    }

    navigateTo(view) {
        // Update nav
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        // Update views
        document.querySelectorAll('.view').forEach(v => {
            v.classList.toggle('active', v.id === `view-${view}`);
        });

        // Update header
        const titles = {
            projects: 'My Projects',
            publish: 'Quick Publish',
            hosting: 'Hosted Sites',
            browse: 'Browse Network',
            gateway: 'HTTP Gateway',
            keys: 'Identity Keys',
            settings: 'Settings'
        };
        document.getElementById('viewTitle').textContent = titles[view] || view;

        // Update header actions
        const headerActions = document.getElementById('headerActions');
        if (view === 'projects') {
            headerActions.innerHTML = '<button class="btn" id="newProjectBtn"><span>+</span> New Project</button>';
            document.getElementById('newProjectBtn').addEventListener('click', () => this.showModal('newProjectModal'));
        } else {
            headerActions.innerHTML = '';
        }

        this.currentView = view;

        // Refresh view data
        this.refreshCurrentView();
    }

    async refreshCurrentView() {
        switch (this.currentView) {
            case 'projects':
                await this.loadProjects();
                break;
            case 'hosting':
                await this.loadHostedSites();
                break;
            case 'keys':
                await this.loadKeys();
                break;
        }
    }

    // ========================================
    // EVENT LISTENERS
    // ========================================

    setupEventListeners() {
        // Node toggle
        document.getElementById('nodeToggle').addEventListener('click', () => this.toggleNode());

        // New project button
        document.getElementById('newProjectBtn')?.addEventListener('click', () => this.showModal('newProjectModal'));

        // Modal close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal-overlay');
                if (modal) this.hideModal(modal.id);
            });
        });

        // Modal overlay click to close
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.hideModal(overlay.id);
            });
        });

        // New project form
        document.getElementById('selectNewProjectFolder').addEventListener('click', async () => {
            const result = await window.grabAPI.selectDirectory();
            if (result.success) {
                document.getElementById('newProjectPath').value = result.path;
            }
        });

        document.getElementById('createProjectBtn').addEventListener('click', async () => {
            const name = document.getElementById('newProjectName').value;
            const path = document.getElementById('newProjectPath').value;
            
            if (name && path) {
                await window.grabAPI.addProject({ name, path });
                this.hideModal('newProjectModal');
                document.getElementById('newProjectName').value = '';
                document.getElementById('newProjectPath').value = '';
                await this.loadProjects();
            }
        });

        // Quick publish form
        document.getElementById('selectFolderBtn').addEventListener('click', async () => {
            const result = await window.grabAPI.selectDirectory();
            if (result.success) {
                document.getElementById('publishPath').value = result.path;
            }
        });

        document.getElementById('publishForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.publishSite();
        });

        // Pin form
        document.getElementById('pinForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.pinSite();
        });

        // Gateway form
        document.getElementById('gatewayForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.startGateway();
        });

        // Refresh sites button
        document.getElementById('refreshSitesBtn')?.addEventListener('click', () => this.loadHostedSites());

        // Generate key button
        document.getElementById('generateKeyBtn')?.addEventListener('click', () => this.showModal('generateKeyModal'));

        document.getElementById('doGenerateKeyBtn').addEventListener('click', async () => {
            const name = document.getElementById('newKeyName').value;
            if (name) {
                await window.grabAPI.keysGenerate(name);
                this.hideModal('generateKeyModal');
                document.getElementById('newKeyName').value = '';
                await this.loadKeys();
            }
        });

        // Settings form
        document.getElementById('detectGrabBtn').addEventListener('click', async () => {
            await this.checkGrabBinary();
        });

        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveSettings();
        });

        // External links
        document.getElementById('linkDocs')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.grabAPI.openExternal('https://grabnet.io/docs');
        });

        document.getElementById('linkGithub')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.grabAPI.openExternal('https://github.com/grabnet');
        });
    }

    setupIPCListeners() {
        // Listen for menu actions
        window.grabAPI.onNavigate((route) => {
            this.navigateTo(route);
        });

        window.grabAPI.onAction((action) => {
            switch (action) {
                case 'new-project':
                    this.showModal('newProjectModal');
                    break;
                case 'publish':
                    if (this.currentView === 'projects') {
                        // Could publish selected project
                    }
                    break;
            }
        });

        window.grabAPI.onOpenProject(async (path) => {
            await window.grabAPI.addProject({ path });
            await this.loadProjects();
        });
    }

    // ========================================
    // MODAL MANAGEMENT
    // ========================================

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }

    // ========================================
    // NODE MANAGEMENT
    // ========================================

    async checkNodeStatus() {
        try {
            const status = await window.grabAPI.nodeStatus();
            this.nodeRunning = status.running;
            this.updateNodeUI();
        } catch (error) {
            this.nodeRunning = false;
            this.updateNodeUI();
        }
    }

    updateNodeUI() {
        const dot = document.getElementById('nodeStatusDot');
        const text = document.getElementById('nodeStatusText');
        const toggle = document.getElementById('nodeToggle');

        if (this.nodeRunning) {
            dot.classList.remove('offline');
            text.textContent = 'Online';
            toggle.textContent = 'Stop';
        } else {
            dot.classList.add('offline');
            text.textContent = 'Offline';
            toggle.textContent = 'Start';
        }
    }

    async toggleNode() {
        const toggle = document.getElementById('nodeToggle');
        toggle.textContent = '...';
        toggle.disabled = true;

        try {
            if (this.nodeRunning) {
                await window.grabAPI.nodeStop();
            } else {
                await window.grabAPI.nodeStart();
            }
            await this.checkNodeStatus();
        } catch (error) {
            console.error('Failed to toggle node:', error);
        } finally {
            toggle.disabled = false;
        }
    }

    // ========================================
    // PROJECTS
    // ========================================

    async loadProjects() {
        this.projects = await window.grabAPI.getProjects() || [];
        this.renderProjects();
    }

    renderProjects() {
        const grid = document.getElementById('projectsGrid');
        
        if (this.projects.length === 0) {
            grid.innerHTML = `
                <div class="project-card add-project-card" id="addProjectCard">
                    <div class="icon">+</div>
                    <div>Add your first project</div>
                </div>
            `;
            document.getElementById('addProjectCard').addEventListener('click', () => {
                this.showModal('newProjectModal');
            });
            return;
        }

        grid.innerHTML = this.projects.map(project => `
            <div class="project-card" data-project-id="${project.id}">
                <div class="project-icon">${project.siteId ? '🌐' : '📁'}</div>
                <h3 class="project-name">${this.escapeHtml(project.name)}</h3>
                <div class="project-path">${this.escapeHtml(project.path)}</div>
                <div class="project-meta">
                    <div class="project-status ${project.siteId ? 'published' : 'draft'}">
                        ${project.siteId ? '● Published' : '○ Draft'}
                    </div>
                    ${project.lastPublished ? `<div>Last: ${this.formatDate(project.lastPublished)}</div>` : ''}
                </div>
            </div>
        `).join('') + `
            <div class="project-card add-project-card" id="addProjectCard">
                <div class="icon">+</div>
                <div>Add Project</div>
            </div>
        `;

        // Add click handlers
        grid.querySelectorAll('.project-card[data-project-id]').forEach(card => {
            card.addEventListener('click', () => {
                this.openProjectDetails(card.dataset.projectId);
            });
        });

        document.getElementById('addProjectCard').addEventListener('click', () => {
            this.showModal('newProjectModal');
        });
    }

    async openProjectDetails(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        // For now, switch to publish view with project path pre-filled
        this.navigateTo('publish');
        document.getElementById('publishPath').value = project.path;
        document.getElementById('publishName').value = project.name;
    }

    // ========================================
    // PUBLISHING
    // ========================================

    async publishSite() {
        const path = document.getElementById('publishPath').value;
        if (!path) {
            alert('Please select a folder to publish');
            return;
        }

        const options = {
            path,
            name: document.getElementById('publishName').value || null,
            entry: document.getElementById('publishEntry').value || null,
            spa: document.getElementById('publishSpa').value || null,
            cleanUrls: document.getElementById('publishCleanUrls').checked,
            noCompress: document.getElementById('publishNoCompress').checked
        };

        // Show output card
        const outputCard = document.getElementById('publishOutputCard');
        const output = document.getElementById('publishOutput');
        outputCard.style.display = 'block';
        output.innerHTML = '<span class="info">Publishing...</span>\n';

        try {
            const result = await window.grabAPI.publish(options);
            
            if (result.success) {
                output.innerHTML += `<span class="success">${this.escapeHtml(result.output)}</span>\n`;
                
                if (result.siteId) {
                    output.innerHTML += `\n<span class="success">✓ Site published successfully!</span>\n`;
                    output.innerHTML += `<span class="info">Site ID: ${result.siteId}</span>\n`;
                    
                    // Update project if it exists
                    const project = this.projects.find(p => p.path === path);
                    if (project) {
                        await window.grabAPI.updateProject(project.id, {
                            siteId: result.siteId,
                            lastPublished: new Date().toISOString()
                        });
                    }
                }
            } else {
                output.innerHTML += `<span class="error">Error: ${this.escapeHtml(result.error)}</span>\n`;
            }
        } catch (error) {
            output.innerHTML += `<span class="error">Error: ${this.escapeHtml(error.message)}</span>\n`;
        }
    }

    // ========================================
    // HOSTED SITES
    // ========================================

    async loadHostedSites() {
        try {
            // Get site list
            const listResult = await window.grabAPI.list();
            
            if (listResult.success) {
                this.renderSiteList(listResult.output);
            }

            // Get stats
            const statsResult = await window.grabAPI.stats();
            if (statsResult.success) {
                this.updateStats(statsResult.output);
            }
        } catch (error) {
            console.error('Failed to load hosted sites:', error);
        }
    }

    renderSiteList(output) {
        const container = document.getElementById('siteList');
        
        // Parse the output to extract sites
        const sites = this.parseSiteList(output);
        
        if (sites.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🛰️</div>
                    <h3>No sites hosted yet</h3>
                    <p>Publish your first site or pin a site from the network</p>
                </div>
            `;
            return;
        }

        container.innerHTML = sites.map(site => `
            <div class="site-item">
                <div class="site-info">
                    <div class="site-name">${this.escapeHtml(site.name || 'Unnamed Site')}</div>
                    <div class="site-id">${this.escapeHtml(site.id)}</div>
                </div>
                <div class="site-actions">
                    <button class="btn btn-sm btn-cyan" onclick="app.viewSite('${site.id}')">View</button>
                    <button class="btn btn-sm" onclick="app.copySiteId('${site.id}')">Copy ID</button>
                    <button class="btn btn-sm" style="border-color: var(--p-red); color: var(--p-red);" onclick="app.unhostSite('${site.id}')">Unhost</button>
                </div>
            </div>
        `).join('');
    }

    parseSiteList(output) {
        // Parse the grab list output
        const sites = [];
        const lines = output.split('\n');
        
        for (const line of lines) {
            // Try to extract site info from output
            // Format may vary, adjust parsing as needed
            const match = line.match(/^\s*(\S+)\s+(.*)$/);
            if (match && match[1].length > 10) {
                sites.push({
                    id: match[1],
                    name: match[2]?.trim() || null
                });
            }
        }
        
        return sites;
    }

    updateStats(output) {
        // Parse stats output and update UI
        // This will depend on the actual grab stats output format
        const lines = output.split('\n');
        
        for (const line of lines) {
            if (line.includes('Hosted')) {
                const match = line.match(/(\d+)/);
                if (match) document.getElementById('statHostedSites').textContent = match[1];
            }
            if (line.includes('Published')) {
                const match = line.match(/(\d+)/);
                if (match) document.getElementById('statPublished').textContent = match[1];
            }
            if (line.includes('Storage')) {
                const match = line.match(/[\d.]+\s*\w+/);
                if (match) document.getElementById('statStorageUsed').textContent = match[0];
            }
            if (line.includes('Peers')) {
                const match = line.match(/(\d+)/);
                if (match) document.getElementById('statPeers').textContent = match[1];
            }
        }
    }

    async viewSite(siteId) {
        // Open in local gateway or browser
        const port = await this.getGatewayPort();
        window.grabAPI.openExternal(`http://localhost:${port}/${siteId}/`);
    }

    copySiteId(siteId) {
        navigator.clipboard.writeText(siteId);
        // Could show a toast notification here
    }

    async unhostSite(siteId) {
        if (confirm(`Are you sure you want to stop hosting site ${siteId}?`)) {
            await window.grabAPI.unhost(siteId);
            await this.loadHostedSites();
        }
    }

    async getGatewayPort() {
        const settings = await window.grabAPI.getSettings();
        return settings.gatewayPort || 8080;
    }

    // ========================================
    // PIN SITE
    // ========================================

    async pinSite() {
        const siteId = document.getElementById('pinSiteId').value;
        const peerAddress = document.getElementById('pinPeerAddress').value || null;

        if (!siteId) {
            alert('Please enter a site ID');
            return;
        }

        try {
            const result = await window.grabAPI.pin(siteId, peerAddress);
            
            if (result.success) {
                alert('Site pinned successfully!');
                document.getElementById('pinSiteId').value = '';
                document.getElementById('pinPeerAddress').value = '';
                this.navigateTo('hosting');
            } else {
                alert(`Failed to pin site: ${result.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    // ========================================
    // GATEWAY
    // ========================================

    async startGateway() {
        const port = parseInt(document.getElementById('gatewayPort').value) || 8080;
        const defaultSite = document.getElementById('gatewayDefaultSite').value || null;

        const statusEl = document.getElementById('gatewayStatus');
        statusEl.innerHTML = '<span class="loading"></span> Starting gateway...';

        try {
            const result = await window.grabAPI.gatewayStart(port, defaultSite);
            
            if (result.success) {
                statusEl.innerHTML = `
                    <div style="color: var(--p-green);">
                        ✓ Gateway running at <a href="#" onclick="window.grabAPI.openExternal('http://localhost:${port}')" style="color: var(--p-cyan);">http://localhost:${port}</a>
                    </div>
                `;
            } else {
                statusEl.innerHTML = `<div style="color: var(--p-red);">✗ ${result.error}</div>`;
            }
        } catch (error) {
            statusEl.innerHTML = `<div style="color: var(--p-red);">✗ ${error.message}</div>`;
        }
    }

    // ========================================
    // KEYS
    // ========================================

    async loadKeys() {
        try {
            const result = await window.grabAPI.keysList();
            
            if (result.success) {
                this.renderKeys(result.output);
            }
        } catch (error) {
            console.error('Failed to load keys:', error);
        }
    }

    renderKeys(output) {
        const container = document.getElementById('keysList');
        const keys = this.parseKeysList(output);

        if (keys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🔑</div>
                    <h3>No keys found</h3>
                    <p>Generate a key to publish and update sites</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="site-list">
                ${keys.map(key => `
                    <div class="site-item">
                        <div class="site-info">
                            <div class="site-name">🔑 ${this.escapeHtml(key.name)}</div>
                            <div class="site-id">${this.escapeHtml(key.publicKey || '')}</div>
                        </div>
                        <div class="site-actions">
                            <button class="btn btn-sm" onclick="app.copyKey('${key.publicKey}')">Copy Public Key</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    parseKeysList(output) {
        const keys = [];
        const lines = output.split('\n');
        
        for (const line of lines) {
            const match = line.match(/^\s*(\S+)\s+(\S+)/);
            if (match) {
                keys.push({
                    name: match[1],
                    publicKey: match[2]
                });
            }
        }
        
        return keys;
    }

    copyKey(key) {
        navigator.clipboard.writeText(key);
    }

    // ========================================
    // SETTINGS
    // ========================================

    async loadSettings() {
        try {
            const settings = await window.grabAPI.getSettings();
            
            if (settings.grabBinaryPath) {
                document.getElementById('settingsGrabPath').value = settings.grabBinaryPath;
            }
            document.getElementById('settingsGatewayPort').value = settings.gatewayPort || 8080;
            document.getElementById('settingsAutoStartNode').checked = settings.autoStartNode !== false;

            // Load app version
            const appInfo = await window.grabAPI.getAppInfo();
            document.getElementById('appVersion').textContent = appInfo.version;
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async saveSettings() {
        const grabPath = document.getElementById('settingsGrabPath').value;
        const gatewayPort = parseInt(document.getElementById('settingsGatewayPort').value) || 8080;
        const autoStartNode = document.getElementById('settingsAutoStartNode').checked;

        if (grabPath) {
            await window.grabAPI.setSetting('grabBinaryPath', grabPath);
        }
        await window.grabAPI.setSetting('gatewayPort', gatewayPort);
        await window.grabAPI.setSetting('autoStartNode', autoStartNode);

        alert('Settings saved!');
    }

    async checkGrabBinary() {
        const result = await window.grabAPI.checkBinary();
        const statusEl = document.getElementById('grabPathStatus');
        
        if (result.found) {
            statusEl.innerHTML = `<span style="color: var(--p-green);">✓ Found at: ${result.path}</span>`;
            document.getElementById('settingsGrabPath').value = result.path;
        } else {
            statusEl.innerHTML = `<span style="color: var(--p-red);">✗ GrabNet binary not found. Please install or configure path.</span>`;
        }
    }

    // ========================================
    // UTILITIES
    // ========================================

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    }
}

// Initialize app
const app = new GrabNetApp();
