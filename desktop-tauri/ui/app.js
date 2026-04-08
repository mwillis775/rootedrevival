/* ═══════════════════════════════════════════════════════════════
   Rooted Revival — Desktop Node
   Frontend: login, archive browser, node management, heartbeat
   ═══════════════════════════════════════════════════════════════ */

let invoke;
try {
  invoke = window.__TAURI__.core.invoke;
} catch (_) {
  invoke = async (cmd, args) => {
    console.warn('[RR] Tauri not available, stub for:', cmd);
    if (cmd === 'check_auth') return { logged_in: false, user: null, server_url: 'https://scholar.rootedrevival.us' };
    if (cmd === 'get_node_status') return { grabnet_running: false, grabnet_available: false, grab_bin_found: false, peer_id: null, hosted_sites: [], pinning_archive: false };
    if (cmd === 'get_settings') return { server_url: 'https://scholar.rootedrevival.us', auto_pin: false, data_dir: '' };
    if (cmd === 'get_system_info') return { version: '0.1.0', grab_bin: null, data_dir: '', os: 'unknown' };
    if (cmd === 'browse_archive') return [];
    if (cmd === 'search_archive') return [];
    if (cmd === 'get_my_files') return [];
    if (cmd === 'get_tags') return [];
    return {};
  };
}

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════

const state = {
  user: null,
  serverUrl: 'https://scholar.rootedrevival.us',
  nodeRunning: false,
  archivePage: 1,
  heartbeatTimer: null,
  refreshTimer: null,
};

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  try {
    const auth = await invoke('check_auth');
    if (auth.logged_in && auth.user) {
      state.user = auth.user;
      state.serverUrl = auth.server_url;
      showApp();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('Auth check failed:', e);
    showLogin();
  }
});

// ════════════════════════════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════════════════════════════

function bindEvents() {
  // Login
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchView(el.dataset.view);
    });
  });

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.nav));
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-settings-logout').addEventListener('click', handleLogout);

  // Dashboard quick actions
  document.getElementById('btn-toggle-node').addEventListener('click', toggleNode);
  document.getElementById('btn-pin-archive').addEventListener('click', () => pinSite('rootedrevival'));
  document.getElementById('btn-open-site').addEventListener('click', () => {
    window.open('https://rootedrevival.us', '_blank');
  });

  // Archive
  document.getElementById('btn-archive-search').addEventListener('click', searchArchive);
  document.getElementById('archive-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchArchive();
  });

  // Node
  document.getElementById('btn-start-node').addEventListener('click', startNode);
  document.getElementById('btn-stop-node').addEventListener('click', stopNode);
  document.getElementById('btn-pin-site').addEventListener('click', () => {
    const name = document.getElementById('pin-site-name').value.trim();
    if (name) pinSite(name);
  });

  // Settings
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('settings-auto-pin').addEventListener('change', saveSettings);

  // Activity log
  document.getElementById('btn-clear-log').addEventListener('click', clearLog);
}

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Connecting...';

  try {
    const result = await invoke('login', {
      request: {
        server_url: document.getElementById('login-server').value.trim(),
        username: document.getElementById('login-username').value.trim(),
        password: document.getElementById('login-password').value,
      }
    });

    if (result.success && result.user) {
      state.user = result.user;
      state.serverUrl = document.getElementById('login-server').value.trim();
      showApp();
    } else {
      err.textContent = result.error || 'Login failed';
    }
  } catch (ex) {
    err.textContent = typeof ex === 'string' ? ex : 'Connection failed';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

async function handleLogout() {
  try { await invoke('logout'); } catch (_) {}
  state.user = null;
  stopTimers();
  showLogin();
}

// ════════════════════════════════════════════════════════════════
// SCREEN MANAGEMENT
// ════════════════════════════════════════════════════════════════

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('app-hidden');
  document.getElementById('login-password').value = '';
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('app-hidden');

  // Populate user info
  const u = state.user;
  document.getElementById('sidebar-user').textContent = u ? (u.display_name || u.username) : '';

  // Load initial data
  refreshAll();

  // Start periodic refresh + heartbeat
  startTimers();
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById('view-' + view);
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (target) target.classList.add('active');
  if (nav) nav.classList.add('active');

  document.getElementById('view-title').textContent = {
    dashboard: 'Dashboard',
    archive: 'Knowledge Archive',
    node: 'Node Management',
    settings: 'Settings',
  }[view] || view;

  // Load view-specific data
  if (view === 'archive') loadArchive();
  if (view === 'node') refreshNodeStatus();
  if (view === 'settings') loadSettings();
}

// ════════════════════════════════════════════════════════════════
// REFRESH
// ════════════════════════════════════════════════════════════════

function startTimers() {
  stopTimers();
  // Refresh node status every 30s
  state.refreshTimer = setInterval(refreshNodeUI, 30000);
  // Send heartbeat every 60s
  state.heartbeatTimer = setInterval(sendHeartbeat, 60000);
  // Send first heartbeat after a short delay
  setTimeout(sendHeartbeat, 5000);
}

function stopTimers() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
}

async function refreshAll() {
  refreshNodeUI();
  loadSystemInfo();
  loadMyFileCount();
}

async function refreshNodeUI() {
  try {
    const ns = await invoke('get_node_status');
    state.nodeRunning = ns.grabnet_running;

    // Sidebar
    const dot = document.getElementById('sidebar-dot');
    const text = document.getElementById('sidebar-status-text');
    dot.className = 'status-dot ' + (ns.grabnet_running ? 'online' : 'offline');
    text.textContent = ns.grabnet_running ? 'Node Online' : 'Node Offline';

    // Dashboard stats
    document.getElementById('stat-node').textContent = ns.grabnet_running ? 'Online' : 'Offline';
    document.getElementById('stat-node').style.color = ns.grabnet_running ? 'var(--accent)' : 'var(--text-muted)';
    document.getElementById('stat-pinned').textContent = ns.hosted_sites.length;
    document.getElementById('stat-archive').textContent = ns.pinning_archive ? 'Active' : 'Not Pinned';

    // Dashboard system
    document.getElementById('dash-grabnet').textContent = ns.grabnet_running ? '● Online' : '○ Offline';
    document.getElementById('dash-grabnet').style.color = ns.grabnet_running ? 'var(--accent)' : 'var(--text-muted)';
    document.getElementById('dash-peer-id').textContent = ns.peer_id ? truncate(ns.peer_id, 24) : '—';
    document.getElementById('dash-peer-id').title = ns.peer_id || '';

    // Toggle button text
    const toggleBtn = document.getElementById('btn-toggle-node');
    if (toggleBtn) {
      toggleBtn.querySelector('span:last-child').textContent = ns.grabnet_running ? 'Stop Node' : 'Start Node';
    }
  } catch (e) {
    console.error('Node status refresh failed:', e);
  }
}

async function loadSystemInfo() {
  try {
    const info = await invoke('get_system_info');
    document.getElementById('dash-server').textContent = state.serverUrl;
    document.getElementById('dash-data-dir').textContent = info.data_dir || '—';
    document.getElementById('dash-data-dir').title = info.data_dir || '';
    document.getElementById('dash-version').textContent = 'v' + info.version;
  } catch (_) {}
}

async function loadMyFileCount() {
  try {
    const resp = await invoke('get_my_files');
    const files = extractFiles(resp);
    document.getElementById('stat-my-files').textContent = files.length;
  } catch (_) {
    document.getElementById('stat-my-files').textContent = '—';
  }
}

// ════════════════════════════════════════════════════════════════
// ARCHIVE
// ════════════════════════════════════════════════════════════════

async function loadArchive() {
  const container = document.getElementById('archive-results');
  const fileType = document.getElementById('archive-type').value;

  try {
    const resp = await invoke('browse_archive', { page: state.archivePage, fileType: fileType || null });
    renderFiles(container, extractFiles(resp));
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Failed to load archive: ${escapeHtml(String(e))}</p></div>`;
  }
}

async function searchArchive() {
  const query = document.getElementById('archive-search').value.trim();
  const fileType = document.getElementById('archive-type').value;
  const container = document.getElementById('archive-results');

  if (!query) {
    loadArchive();
    return;
  }

  try {
    const resp = await invoke('search_archive', { query, fileType: fileType || null });
    renderFiles(container, extractFiles(resp));
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Search failed: ${escapeHtml(String(e))}</p></div>`;
  }
}

function renderFiles(container, files) {
  if (!files || files.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">◫</span><p>No files found</p></div>';
    return;
  }

  container.innerHTML = files.map(f => `
    <div class="file-card" data-uuid="${escapeHtml(f.uuid || '')}" onclick="showFileDetail('${escapeHtml(f.uuid || '')}')">
      <div class="file-card-title">${escapeHtml(f.title || f.filename || 'Untitled')}</div>
      <div class="file-card-meta">
        <span>${escapeHtml(f.uploader_name || 'Unknown')}</span>
        <span>${formatSize(f.size || f.file_size || 0)}</span>
        <span>${formatDate(f.created_at)}</span>
      </div>
      ${f.file_type || f.paper_type ? `<span class="file-card-type">${escapeHtml(f.file_type || f.paper_type)}</span>` : ''}
    </div>
  `).join('');
}

async function showFileDetail(uuid) {
  if (!uuid) return;
  try {
    const file = await invoke('get_file_detail', { uuid });
    // Create a simple modal
    let overlay = document.querySelector('.modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h2 id="modal-title"></h2>
            <button class="modal-close" onclick="closeModal()">&times;</button>
          </div>
          <div class="modal-body" id="modal-body"></div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    }

    overlay.classList.remove('hidden');
    const detail = file.paper || file;
    document.getElementById('modal-title').textContent = detail.title || detail.filename || 'File Detail';
    document.getElementById('modal-body').innerHTML = `
      <div class="status-list">
        ${detail.abstract ? `<div class="status-row"><span class="status-label">Abstract</span><span class="status-value">${escapeHtml(detail.abstract)}</span></div>` : ''}
        <div class="status-row"><span class="status-label">Type</span><span class="status-value">${escapeHtml(detail.paper_type || detail.file_type || '—')}</span></div>
        <div class="status-row"><span class="status-label">Uploaded by</span><span class="status-value">${escapeHtml(detail.uploader_name || '—')}</span></div>
        ${detail.authors && detail.authors.length ? `<div class="status-row"><span class="status-label">Authors</span><span class="status-value">${escapeHtml(detail.authors.join(', '))}</span></div>` : ''}
        <div class="status-row"><span class="status-label">Views</span><span class="status-value">${detail.view_count || 0}</span></div>
        <div class="status-row"><span class="status-label">Downloads</span><span class="status-value">${detail.download_count || 0}</span></div>
        <div class="status-row"><span class="status-label">Date</span><span class="status-value">${formatDate(detail.created_at)}</span></div>
      </div>
      ${detail.description ? `<p class="muted" style="margin-top:12px">${escapeHtml(detail.description)}</p>` : ''}
      <div style="margin-top:16px; display:flex; gap:8px;">
        <button class="btn-primary btn-sm" onclick="downloadFile('${escapeHtml(uuid)}', '${escapeHtml(detail.title || 'file')}')">Download</button>
        <button class="btn-ghost btn-sm" onclick="window.open('${state.serverUrl}/view?id=${encodeURIComponent(uuid)}', '_blank')">View on Site</button>
      </div>`;
  } catch (e) {
    log('Failed to load file detail: ' + e, 'err');
  }
}

window.showFileDetail = showFileDetail;

async function downloadFile(uuid, filename) {
  try {
    const destination = ''; // Let Rust pick the download directory
    const result = await invoke('download_file', { uuid, destination });
    log('Downloaded: ' + (result || filename), 'ok');
    closeModal();
  } catch (e) {
    log('Download failed: ' + e, 'err');
  }
}

window.downloadFile = downloadFile;

function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

window.closeModal = closeModal;

// ════════════════════════════════════════════════════════════════
// NODE
// ════════════════════════════════════════════════════════════════

async function refreshNodeStatus() {
  try {
    const ns = await invoke('get_node_status');
    state.nodeRunning = ns.grabnet_running;

    // Big status
    const dot = document.getElementById('node-dot');
    const text = document.getElementById('node-status-text');
    dot.className = 'node-dot' + (ns.grabnet_running ? ' online' : '');
    text.textContent = ns.grabnet_running ? 'Node Running' : 'Node Stopped';

    // Buttons
    document.getElementById('btn-start-node').disabled = ns.grabnet_running;
    document.getElementById('btn-stop-node').disabled = !ns.grabnet_running;

    // Details
    document.getElementById('node-bin').textContent = ns.grab_bin_found ? '✓ Found' : '✗ Not found';
    document.getElementById('node-bin').style.color = ns.grab_bin_found ? 'var(--accent)' : 'var(--red)';
    document.getElementById('node-gateway').textContent = ns.grabnet_available ? '✓ Reachable' : '✗ Unreachable';
    document.getElementById('node-gateway').style.color = ns.grabnet_available ? 'var(--accent)' : 'var(--text-muted)';
    document.getElementById('node-peer-id').textContent = ns.peer_id || '—';
    document.getElementById('node-peer-id').title = ns.peer_id || '';
    document.getElementById('node-pinning').textContent = ns.pinning_archive ? '✓ rootedrevival' : '✗ No';
    document.getElementById('node-pinning').style.color = ns.pinning_archive ? 'var(--accent)' : 'var(--text-muted)';

    // Hosted sites list
    const list = document.getElementById('hosted-sites-list');
    if (ns.hosted_sites.length > 0) {
      list.innerHTML = ns.hosted_sites.map(s =>
        `<div class="hosted-item"><span>${escapeHtml(s)}</span><span class="site-badge">pinned</span></div>`
      ).join('');
    } else {
      list.innerHTML = '<div class="empty-state small">No sites pinned yet.</div>';
    }
  } catch (e) {
    console.error('Node status failed:', e);
  }
}

async function toggleNode() {
  if (state.nodeRunning) {
    await stopNode();
  } else {
    await startNode();
  }
}

async function startNode() {
  log('Starting GrabNet node...', 'ok');
  try {
    const result = await invoke('start_node');
    log(result || 'Node started', 'ok');
    await refreshNodeUI();
    await refreshNodeStatus();
  } catch (e) {
    log('Failed to start node: ' + e, 'err');
  }
}

async function stopNode() {
  log('Stopping GrabNet node...', 'ok');
  try {
    await invoke('stop_node');
    log('Node stopped', 'ok');
    await refreshNodeUI();
    await refreshNodeStatus();
  } catch (e) {
    log('Failed to stop node: ' + e, 'err');
  }
}

async function pinSite(name) {
  log('Pinning site: ' + name + '...', 'ok');
  try {
    const result = await invoke('pin_site', { siteName: name });
    log(result || 'Pinned ' + name, 'ok');
    document.getElementById('pin-site-name').value = '';
    await refreshNodeUI();
  } catch (e) {
    log('Pin failed: ' + e, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// HEARTBEAT
// ════════════════════════════════════════════════════════════════

async function sendHeartbeat() {
  try {
    await invoke('send_heartbeat');
    const el = document.getElementById('node-heartbeat');
    if (el) el.textContent = '✓ Active';
    const ts = document.getElementById('node-last-heartbeat');
    if (ts) ts.textContent = new Date().toLocaleTimeString();
  } catch (e) {
    const el = document.getElementById('node-heartbeat');
    if (el) {
      el.textContent = '✗ Failed';
      el.style.color = 'var(--red)';
    }
  }
}

// ════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════

async function loadSettings() {
  try {
    const settings = await invoke('get_settings');
    document.getElementById('settings-server').value = settings.server_url || '';
    document.getElementById('settings-auto-pin').checked = settings.auto_pin || false;

    const info = await invoke('get_system_info');
    document.getElementById('info-version').textContent = 'v' + info.version;
    document.getElementById('info-os').textContent = info.os;
    document.getElementById('info-grab-bin').textContent = info.grab_bin || 'Not found';
    document.getElementById('info-data-dir').textContent = info.data_dir || '—';

    if (state.user) {
      document.getElementById('info-username').textContent = state.user.username || '—';
      document.getElementById('info-email').textContent = state.user.email || '—';
    }
  } catch (e) {
    console.error('Settings load failed:', e);
  }
}

async function saveSettings() {
  try {
    const serverUrl = document.getElementById('settings-server').value.trim() || undefined;
    const autoPin = document.getElementById('settings-auto-pin').checked;
    await invoke('update_settings', { serverUrl, autoPin });
    log('Settings saved', 'ok');
  } catch (e) {
    log('Failed to save settings: ' + e, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════════════════════════════

function log(message, type) {
  const container = document.getElementById('activity-log');
  const time = new Date().toLocaleTimeString();
  const cls = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : '';
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span> <span class="${cls}">${escapeHtml(message)}</span>`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;

  // Keep max 100 lines
  while (container.children.length > 100) {
    container.removeChild(container.firstChild);
  }
}

function clearLog() {
  const container = document.getElementById('activity-log');
  container.innerHTML = '<div class="log-line dim">Log cleared.</div>';
}

// ════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════

function extractFiles(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.files)) return data.files;
    if (Array.isArray(data.papers)) return data.papers;
    if (Array.isArray(data.results)) return data.results;
  }
  return [];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str || str.length <= len) return str || '';
  return str.substring(0, len) + '…';
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch (_) {
    return dateStr;
  }
}
