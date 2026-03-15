/* ═══════════════════════════════════════════════════════════════
   Rooted Revival — Open Scholar Desktop
   Frontend application logic · Tauri IPC bridge
   ═══════════════════════════════════════════════════════════════ */

const { invoke } = window.__TAURI__.core;

class OpenScholarApp {
  constructor() {
    this.currentView = 'dashboard';
    this.status = {};
    this.files = [];
    this.searchType = '';
    this.libraryMode = 'grid';
    this.pollInterval = null;

    this.init();
  }

  async init() {
    this.setupNavigation();
    this.setupSearch();
    this.setupUpload();
    this.setupServiceButtons();
    this.setupViewToggle();
    this.setupFilterChips();

    await this.refreshStatus();
    await this.refreshAll();

    // Poll status every 5 seconds
    this.pollInterval = setInterval(() => this.refreshStatus(), 5000);
  }

  // ════════════════════════════════════════════════════════════
  // Navigation
  // ════════════════════════════════════════════════════════════

  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        if (view) this.switchView(view);
      });
    });
  }

  switchView(name) {
    this.currentView = name;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-view="${name}"]`);
    if (navItem) navItem.classList.add('active');

    // Update views
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const view = document.getElementById(`view-${name}`);
    if (view) view.classList.add('active');

    // Update title
    const titles = {
      dashboard: 'Dashboard', library: 'Library', search: 'Discover',
      publish: 'Publish', pinning: 'Pinning', network: 'Network', settings: 'Settings'
    };
    document.getElementById('view-title').textContent = titles[name] || name;

    // Refresh data for the view
    this.refreshViewData(name);
  }

  async refreshViewData(name) {
    switch (name) {
      case 'dashboard': await this.refreshDashboard(); break;
      case 'library': await this.refreshLibrary(); break;
      case 'network': await this.refreshNetwork(); break;
      case 'settings': await this.refreshSettings(); break;
      case 'pinning': await this.refreshPinning(); break;
    }
  }

  // ════════════════════════════════════════════════════════════
  // Status & Polling
  // ════════════════════════════════════════════════════════════

  async refreshStatus() {
    try {
      this.status = await invoke('get_status');
    } catch (e) {
      this.status = {
        scholar_running: false, grabnet_running: false,
        offline_mode: false, peer_id: null, connected_peers: 0,
        scholar_available: false, grabnet_available: false,
      };
    }
    this.updateStatusUI();
  }

  updateStatusUI() {
    const s = this.status;

    // Sidebar node status
    const dot = document.querySelector('#node-status .status-dot');
    const text = document.querySelector('#node-status .status-text');
    if (s.grabnet_running) {
      dot.className = 'status-dot online';
      text.textContent = 'Online';
    } else if (s.offline_mode) {
      dot.className = 'status-dot offline';
      text.textContent = 'Offline Mode';
    } else {
      dot.className = 'status-dot offline';
      text.textContent = 'Offline';
    }

    document.getElementById('peer-count-num').textContent = s.connected_peers || 0;

    // Service dots
    document.getElementById('dot-scholar').className =
      'svc-dot' + (s.scholar_running ? ' running' : '');
    document.getElementById('dot-grabnet').className =
      'svc-dot' + (s.grabnet_running ? ' running' : '');

    // Dashboard stats
    document.getElementById('stat-peers').textContent = s.connected_peers || 0;
  }

  // ════════════════════════════════════════════════════════════
  // Service Controls
  // ════════════════════════════════════════════════════════════

  setupServiceButtons() {
    document.getElementById('btn-scholar').addEventListener('click', () => this.toggleScholar());
    document.getElementById('btn-grabnet').addEventListener('click', () => this.toggleGrabNet());
  }

  async toggleScholar() {
    try {
      if (this.status.scholar_running) {
        await invoke('stop_scholar');
        this.toast('Scholar stopped', 'info');
      } else {
        this.toast('Starting Scholar...', 'info');
        await invoke('start_scholar');
        this.toast('Scholar started', 'success');
      }
    } catch (e) {
      this.toast(e, 'error');
    }
    await this.refreshStatus();
  }

  async toggleGrabNet() {
    try {
      if (this.status.grabnet_running) {
        await invoke('stop_grabnet');
        this.toast('GrabNet stopped', 'info');
      } else {
        this.toast('Starting GrabNet...', 'info');
        await invoke('start_grabnet');
        this.toast('GrabNet started', 'success');
      }
    } catch (e) {
      this.toast(e, 'error');
    }
    await this.refreshStatus();
  }

  // ════════════════════════════════════════════════════════════
  // Dashboard
  // ════════════════════════════════════════════════════════════

  async refreshAll() {
    await Promise.all([
      this.refreshDashboard(),
      this.loadStorageStats(),
    ]);
  }

  async refreshDashboard() {
    // Scholar status
    const scholEl = document.getElementById('dash-scholar-status');
    scholEl.textContent = this.status.scholar_running ? 'Running' : (this.status.scholar_available ? 'Stopped' : 'Not Installed');
    scholEl.className = 'status-value' + (this.status.scholar_running ? ' running' : ' stopped');

    const grabEl = document.getElementById('dash-grabnet-status');
    grabEl.textContent = this.status.grabnet_running ? 'Running' : (this.status.grabnet_available ? 'Stopped' : 'Not Installed');
    grabEl.className = 'status-value' + (this.status.grabnet_running ? ' running' : ' stopped');

    document.getElementById('dash-peer-id').textContent =
      this.status.peer_id ? this.truncateId(this.status.peer_id) : 'Not connected';

    // Get storage stats
    try {
      const storage = await invoke('get_storage_stats');
      document.getElementById('dash-data-dir').textContent = storage.data_dir || '—';
      document.getElementById('dash-storage').textContent = this.formatBytes(storage.total_size_bytes);
      document.getElementById('stat-files').textContent = storage.total_files;
    } catch (_) {}

    // Get network stats
    try {
      const net = await invoke('get_network_stats');
      document.getElementById('stat-published').textContent = net.published_sites;
      document.getElementById('stat-pinned').textContent = net.hosted_sites;
      document.getElementById('badge-pinning').textContent = net.hosted_sites;
    } catch (_) {}

    // Load recent works
    await this.loadRecentWorks();
  }

  async loadRecentWorks() {
    const container = document.getElementById('recent-works');
    try {
      this.files = await invoke('get_files');
      document.getElementById('badge-library').textContent = this.files.length;
      if (this.files.length === 0) {
        container.innerHTML = `<div class="empty-state small"><p>No works yet. ${this.status.scholar_running ? 'Browse the network to find content.' : 'Start Scholar to see your library.'}</p></div>`;
        return;
      }
      container.innerHTML = this.files.slice(0, 5).map(f => this.renderWorkRow(f)).join('');
    } catch (_) {
      container.innerHTML = '<div class="empty-state small"><p>Start Scholar to view works.</p></div>';
    }
  }

  async loadStorageStats() {
    try {
      const stats = await invoke('get_storage_stats');
      document.getElementById('stat-files').textContent = stats.total_files;
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════
  // Library
  // ════════════════════════════════════════════════════════════

  setupViewToggle() {
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.libraryMode = btn.dataset.mode;
        this.renderLibrary();
      });
    });

    document.getElementById('lib-type-filter').addEventListener('change', () => this.renderLibrary());
    document.getElementById('lib-sort').addEventListener('change', () => this.renderLibrary());
  }

  async refreshLibrary() {
    try {
      this.files = await invoke('get_files');
    } catch (_) {
      this.files = [];
    }
    this.renderLibrary();
  }

  renderLibrary() {
    const container = document.getElementById('library-content');
    let items = [...this.files];

    // Filter
    const typeFilter = document.getElementById('lib-type-filter').value;
    if (typeFilter) {
      items = items.filter(f => f.work_type === typeFilter);
    }

    // Sort
    const sort = document.getElementById('lib-sort').value;
    switch (sort) {
      case 'newest': items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); break;
      case 'oldest': items.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); break;
      case 'name': items.sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename)); break;
      case 'size': items.sort((a, b) => b.size - a.size); break;
    }

    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon">◫</span><p>No works match your filters.</p></div>';
      return;
    }

    container.className = this.libraryMode === 'list' ? 'works-grid list-mode' : 'works-grid';

    if (this.libraryMode === 'grid') {
      container.innerHTML = items.map(f => this.renderWorkCard(f)).join('');
    } else {
      container.innerHTML = '<div class="works-list">' + items.map(f => this.renderWorkRow(f)).join('') + '</div>';
    }
  }

  // ════════════════════════════════════════════════════════════
  // Search
  // ════════════════════════════════════════════════════════════

  setupSearch() {
    document.getElementById('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doSearch();
    });
  }

  setupFilterChips() {
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.searchType = chip.dataset.type;
        // Re-run search if there's a query
        const q = document.getElementById('search-input').value.trim();
        if (q) this.doSearch();
      });
    });
  }

  async doSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    const container = document.getElementById('search-results');
    container.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Searching the network...</p></div>';

    try {
      const result = await invoke('search_content', {
        request: { query, work_type: this.searchType || null, page: 1 }
      });
      if (result.results.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">⊕</span><p>No results found. Try a different query.</p></div>';
        return;
      }
      container.innerHTML = result.results.map(f => this.renderWorkCard(f)).join('');
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">⊕</span><p>${this.status.scholar_running ? 'Search failed: ' + e : 'Start Scholar to search the network.'}</p></div>`;
    }
  }

  // ════════════════════════════════════════════════════════════
  // Publish
  // ════════════════════════════════════════════════════════════

  setupUpload() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        this.handleFiles(e.dataTransfer.files);
      }
    });

    input.addEventListener('change', () => {
      if (input.files.length) {
        this.handleFiles(input.files);
        input.value = '';
      }
    });
  }

  handleFiles(fileList) {
    const queue = document.getElementById('upload-queue');
    queue.hidden = false;

    for (const file of fileList) {
      const item = document.createElement('div');
      item.className = 'upload-item';
      item.innerHTML = `
        <span class="upload-item-name">${this.escapeHtml(file.name)}</span>
        <span class="upload-item-size">${this.formatBytes(file.size)}</span>
        <span class="upload-item-status pending">Ready</span>
      `;
      item.dataset.path = file.path || file.name;
      queue.appendChild(item);
    }
  }

  async publishWork() {
    const title = document.getElementById('pub-title').value.trim();
    const description = document.getElementById('pub-description').value.trim();
    const workType = document.getElementById('pub-type').value;
    const tagsRaw = document.getElementById('pub-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    const queue = document.getElementById('upload-queue');
    const items = queue.querySelectorAll('.upload-item');

    if (items.length === 0) {
      this.toast('Add files to publish', 'error');
      return;
    }

    if (!title) {
      this.toast('Title is required', 'error');
      return;
    }

    for (const item of items) {
      const statusEl = item.querySelector('.upload-item-status');
      statusEl.textContent = 'Uploading...';
      statusEl.className = 'upload-item-status uploading';

      try {
        await invoke('upload_file', {
          request: {
            path: item.dataset.path,
            title,
            description: description || null,
            work_type: workType,
            tags: tags.length ? tags : null,
          }
        });
        statusEl.textContent = 'Published';
        statusEl.className = 'upload-item-status done';
      } catch (e) {
        statusEl.textContent = 'Failed';
        statusEl.className = 'upload-item-status error';
        this.toast(`Upload failed: ${e}`, 'error');
      }
    }

    this.toast('Work published to network!', 'success');

    // Clear form
    document.getElementById('pub-title').value = '';
    document.getElementById('pub-description').value = '';
    document.getElementById('pub-tags').value = '';
    setTimeout(() => { queue.innerHTML = ''; queue.hidden = true; }, 2000);
  }

  // ════════════════════════════════════════════════════════════
  // Pinning
  // ════════════════════════════════════════════════════════════

  async pinSite() {
    const input = document.getElementById('pin-site-id');
    const siteId = input.value.trim();
    if (!siteId) {
      this.toast('Enter a site ID to pin', 'error');
      return;
    }

    try {
      await invoke('pin_site', { request: { site_id: siteId } });
      this.toast('Site pinned successfully!', 'success');
      input.value = '';
      await this.refreshPinning();
    } catch (e) {
      this.toast(`Pin failed: ${e}`, 'error');
    }
  }

  async unpinSite(siteId) {
    try {
      await invoke('unpin_site', { request: { site_id: siteId } });
      this.toast('Site unpinned', 'info');
      await this.refreshPinning();
    } catch (e) {
      this.toast(`Unpin failed: ${e}`, 'error');
    }
  }

  async refreshPinning() {
    const container = document.getElementById('pinned-list');
    try {
      const sites = await invoke('get_published_sites');
      document.getElementById('pinned-count').textContent = sites.length;
      document.getElementById('badge-pinning').textContent = sites.length;
      if (sites.length === 0) {
        container.innerHTML = '<div class="empty-state small"><p>No pinned sites. Pin content to help the network.</p></div>';
        return;
      }
      container.innerHTML = sites.map(id => `
        <div class="site-row">
          <span class="site-id" title="${this.escapeHtml(id)}">${this.escapeHtml(id)}</span>
          <button class="btn-danger" onclick="app.unpinSite('${this.escapeHtml(id)}')">Unpin</button>
        </div>
      `).join('');
    } catch (_) {
      container.innerHTML = '<div class="empty-state small"><p>Start GrabNet to view pinned sites.</p></div>';
    }
  }

  // ════════════════════════════════════════════════════════════
  // Network
  // ════════════════════════════════════════════════════════════

  async refreshNetwork() {
    try {
      const stats = await invoke('get_network_stats');
      document.getElementById('net-peers').textContent = stats.connected_peers;
      document.getElementById('net-published').textContent = stats.published_sites;
      document.getElementById('net-hosted').textContent = stats.hosted_sites;
      document.getElementById('net-bandwidth').textContent =
        this.formatBytes(stats.bytes_sent + stats.bytes_received);
    } catch (_) {}

    // Peer ID
    document.getElementById('net-peer-id').textContent =
      this.status.peer_id || 'Not connected';

    // Peers list
    const peersContainer = document.getElementById('peers-list');
    try {
      const peers = await invoke('get_connected_peers');
      if (peers.length === 0) {
        peersContainer.innerHTML = '<div class="empty-state small"><p>No peers connected.</p></div>';
        return;
      }
      peersContainer.innerHTML = peers.map(p => `
        <div class="peer-row">
          <span class="peer-dot"></span>
          <span class="peer-id" title="${this.escapeHtml(p)}">${this.escapeHtml(p)}</span>
        </div>
      `).join('');
    } catch (_) {
      peersContainer.innerHTML = '<div class="empty-state small"><p>Start GrabNet to see peers.</p></div>';
    }
  }

  // ════════════════════════════════════════════════════════════
  // Settings
  // ════════════════════════════════════════════════════════════

  async refreshSettings() {
    try {
      const config = await invoke('get_config');
      document.getElementById('set-scholar-bin').textContent = config.scholar_bin || 'Not found';
      document.getElementById('set-grab-bin').textContent = config.grabnet_bin || 'Not found';
      document.getElementById('set-scholar-url').textContent = config.scholar_url;
      document.getElementById('set-grabnet-url').textContent = config.grabnet_url;
      document.getElementById('set-data-dir').textContent = config.data_dir;
      document.getElementById('set-offline').checked = config.offline_mode;
    } catch (_) {}
  }

  async toggleOffline(enabled) {
    try {
      await invoke('set_offline_mode', { enabled });
      this.toast(enabled ? 'Offline mode enabled' : 'Online mode restored', 'info');
      await this.refreshStatus();
    } catch (e) {
      this.toast(e, 'error');
    }
  }

  async exportIdentity() {
    const password = prompt('Enter a password to encrypt your identity backup:');
    if (!password) return;
    try {
      const data = await invoke('export_identity', { password });
      // Create a downloadable file
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rooted-revival-identity.json';
      a.click();
      URL.revokeObjectURL(url);
      this.toast('Identity exported', 'success');
    } catch (e) {
      this.toast(`Export failed: ${e}`, 'error');
    }
  }

  async importIdentity() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      const text = await input.files[0].text();
      const password = prompt('Enter the backup password:');
      if (!password) return;
      try {
        await invoke('import_identity', { data: text, password });
        this.toast('Identity imported. Restart GrabNet to use it.', 'success');
      } catch (e) {
        this.toast(`Import failed: ${e}`, 'error');
      }
    });
    input.click();
  }

  // ════════════════════════════════════════════════════════════
  // Modal
  // ════════════════════════════════════════════════════════════

  showWorkDetail(work) {
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const footer = document.getElementById('modal-footer');

    title.textContent = work.title || work.filename;

    body.innerHTML = `
      <div class="status-list">
        ${work.work_type ? `<div class="status-row"><span class="status-label">Type</span><span class="work-card-type type-${work.work_type}">${work.work_type}</span></div>` : ''}
        <div class="status-row"><span class="status-label">Filename</span><span class="status-value mono">${this.escapeHtml(work.filename)}</span></div>
        <div class="status-row"><span class="status-label">Content Type</span><span class="status-value mono">${this.escapeHtml(work.content_type)}</span></div>
        <div class="status-row"><span class="status-label">Size</span><span class="status-value">${this.formatBytes(work.size)}</span></div>
        ${work.grabnet_cid ? `<div class="status-row"><span class="status-label">GrabNet CID</span><span class="status-value mono" style="font-size:10px">${this.escapeHtml(work.grabnet_cid)}</span></div>` : ''}
        <div class="status-row"><span class="status-label">Created</span><span class="status-value">${work.created_at || '—'}</span></div>
        <div class="status-row"><span class="status-label">UUID</span><span class="status-value mono" style="font-size:10px">${this.escapeHtml(work.uuid)}</span></div>
      </div>
    `;

    footer.innerHTML = `
      <button class="btn-ghost" onclick="app.closeModal()">Close</button>
      <button class="btn-primary" onclick="app.downloadWork('${this.escapeHtml(work.uuid)}', '${this.escapeHtml(work.filename)}')">Download</button>
    `;

    overlay.hidden = false;
  }

  closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  }

  async downloadWork(uuid, filename) {
    const dest = prompt('Save to (full path):', `${this.homeDir()}/${filename}`);
    if (!dest) return;
    try {
      await invoke('download_file', { request: { uuid, destination: dest } });
      this.toast(`Downloaded to ${dest}`, 'success');
    } catch (e) {
      this.toast(`Download failed: ${e}`, 'error');
    }
  }

  homeDir() {
    // Best-effort home dir for Linux
    return '/home/' + (window.__TAURI__?.path?.homeDir || 'user');
  }

  // ════════════════════════════════════════════════════════════
  // Rendering helpers
  // ════════════════════════════════════════════════════════════

  renderWorkCard(work) {
    const typeClass = work.work_type ? `type-${work.work_type}` : '';
    const title = work.title || work.filename || 'Untitled';
    return `
      <div class="work-card" onclick='app.showWorkDetail(${JSON.stringify(work)})'>
        ${work.work_type ? `<span class="work-card-type ${typeClass}">${work.work_type}</span>` : ''}
        <div class="work-card-title">${this.escapeHtml(title)}</div>
        <div class="work-card-meta">
          <span>${this.formatBytes(work.size)}</span>
          <span>${work.content_type || ''}</span>
        </div>
        ${work.grabnet_cid ? `<div class="work-card-cid">cid: ${this.escapeHtml(work.grabnet_cid)}</div>` : ''}
      </div>
    `;
  }

  renderWorkRow(work) {
    const title = work.title || work.filename || 'Untitled';
    return `
      <div class="work-row" onclick='app.showWorkDetail(${JSON.stringify(work)})'>
        <span class="work-row-type">${work.work_type || '—'}</span>
        <span class="work-row-title">${this.escapeHtml(title)}</span>
        <span class="work-row-size">${this.formatBytes(work.size)}</span>
        <span class="work-row-date">${work.created_at ? work.created_at.split('T')[0] : ''}</span>
      </div>
    `;
  }

  // ════════════════════════════════════════════════════════════
  // Toast
  // ════════════════════════════════════════════════════════════

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = typeof message === 'string' ? message : JSON.stringify(message);
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = 'all 300ms ease';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  // ════════════════════════════════════════════════════════════
  // Utils
  // ════════════════════════════════════════════════════════════

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  truncateId(id) {
    if (!id || id.length <= 16) return id || '—';
    return id.slice(0, 8) + '...' + id.slice(-8);
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) app.closeModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') app.closeModal();
});

// Boot
const app = new OpenScholarApp();
