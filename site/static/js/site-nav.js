/**
 * Rooted Revival — Shared Site Navigation
 * Include this script on every page (except admin/scholar/grab landing pages).
 * It replaces the header content with a unified nav and handles auth state.
 */
(function() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const isIndex = page === 'index.html' || page === '' || page === '/';

  const links = [
    { label: 'Home',     href: 'index.html',    page: 'index.html' },
    { label: 'Browse',   href: 'browse.html',   page: 'browse.html' },
    { label: 'Upload',   href: 'upload.html',   page: 'upload.html' },
    { label: 'Search',   href: 'search.html',   page: 'search.html' },
    { label: 'About',    href: isIndex ? '#about' : 'about.html', page: 'about.html' },
    { label: 'Help',     href: 'help.html',     page: 'help.html' },
    { label: 'GrabNet',  href: 'grab.html',     page: 'grab.html',    style: 'color:var(--purple,#9966ff)' },
    { label: 'Scholar',  href: 'scholar.html',  page: 'scholar.html', style: 'color:var(--amber,#ffb000)' },
  ];

  const header = document.querySelector('header.header');
  if (!header) return;

  // Build nav HTML
  const navLinks = links.map(function(l) {
    const active = (l.page === page && !isIndex) || (isIndex && l.page === 'index.html') ? ' class="active"' : '';
    const style = l.style ? ' style="' + l.style + '"' : '';
    return '<a href="' + l.href + '"' + active + style + '>' + l.label + '</a>';
  }).join('');

  header.innerHTML =
    '<div class="header-inner">' +
      '<a href="index.html" class="logo">' +
        '<span class="logo-icon">🌱</span>' +
        '<span>ROOTED_REVIVAL</span>' +
      '</a>' +
      '<nav class="nav">' +
        navLinks +
        '<a href="login.html" id="authLink">Log In</a>' +
      '</nav>' +
    '</div>';

  // Auth-aware nav: swap Login → username/Profile
  var API_BASE = location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://scholar.rootedrevival.us/api';

  // Quick update from localStorage
  try {
    var user = JSON.parse(localStorage.getItem('user'));
    if (user && user.username) {
      var link = document.getElementById('authLink');
      if (link) { link.textContent = user.username; link.href = 'profile.html'; }
    }
  } catch(e) {}

  // Quick admin link from localStorage
  try {
    var stored = JSON.parse(localStorage.getItem('user'));
    if (stored && (stored.is_admin || stored.isAdmin)) {
      var nav = document.querySelector('header.header .nav');
      if (nav) {
        var adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.id = 'adminLink';
        adminLink.style.cssText = 'color:var(--accent,#00ff88);font-weight:600';
        adminLink.textContent = '⚙ Admin';
        nav.insertBefore(adminLink, document.getElementById('authLink'));
      }
    }
  } catch(e) {}

  // Verify with server
  fetch(API_BASE + '/auth/me', { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data && data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
        var link = document.getElementById('authLink');
        if (link) {
          link.textContent = data.user.username;
          link.href = 'profile.html';
        }
        // Show admin link if admin
        if (data.user.is_admin || data.user.isAdmin) {
          var existing = document.getElementById('adminLink');
          if (!existing) {
            var nav = document.querySelector('header.header .nav');
            if (nav) {
              var adminLink = document.createElement('a');
              adminLink.href = 'admin.html';
              adminLink.id = 'adminLink';
              adminLink.style.cssText = 'color:var(--accent,#00ff88);font-weight:600';
              adminLink.textContent = '⚙ Admin';
              nav.insertBefore(adminLink, document.getElementById('authLink'));
            }
          }
        } else {
          // Not admin — remove admin link if present
          var adminEl = document.getElementById('adminLink');
          if (adminEl) adminEl.remove();
        }
      } else {
        // Session expired — clear stale local data
        localStorage.removeItem('user');
        var link = document.getElementById('authLink');
        if (link) { link.textContent = 'Log In'; link.href = 'login.html'; }
        var adminEl = document.getElementById('adminLink');
        if (adminEl) adminEl.remove();
      }
    })
    .catch(function() {});
})();
