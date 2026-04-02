/**
 * Rooted Revival — Shared Site Navigation
 * Include this script on every page (except admin/scholar/grab landing pages).
 * It replaces the header content with a unified nav and handles auth state.
 */
(function() {
  var page = location.pathname.split('/').pop() || 'index.html';
  var isIndex = page === 'index.html' || page === '' || page === '/';

  var primary = [
    { label: 'Home',     href: 'index.html',    page: 'index.html' },
    { label: 'Services', href: 'services.html', page: 'services.html' },
    { label: 'Shop',     href: 'products.html', page: 'products.html' },
    { label: 'About',    href: isIndex ? '#about' : 'about.html', page: 'about.html' },
  ];

  var more = [
    { label: 'Browse',   href: 'browse.html',   page: 'browse.html' },
    { label: 'Upload',   href: 'upload.html',   page: 'upload.html' },
    { label: 'Search',   href: 'search.html',   page: 'search.html' },
    { label: 'Help',     href: 'help.html',     page: 'help.html' },
    { label: 'GrabNet',  href: 'grab.html',     page: 'grab.html' },
    { label: 'Scholar',  href: 'scholar.html',  page: 'scholar.html' },
  ];

  var header = document.querySelector('header.header');
  if (!header) return;

  function linkHtml(l) {
    var active = (l.page === page && !isIndex) || (isIndex && l.page === 'index.html') ? ' class="active"' : '';
    return '<a href="' + l.href + '"' + active + '>' + l.label + '</a>';
  }

  var primaryHtml = primary.map(linkHtml).join('');
  var moreHtml = more.map(linkHtml).join('');
  var moreActive = more.some(function(l) { return l.page === page; });

  // Inject scoped styles once
  if (!document.getElementById('rr-nav-style')) {
    var style = document.createElement('style');
    style.id = 'rr-nav-style';
    style.textContent =
      '.rr-more { position:relative; }' +
      '.rr-more-btn { background:none; border:none; color:var(--text,#e0e0e0); font-size:0.9rem; cursor:pointer; font-family:inherit; padding:0; transition:color 0.2s; }' +
      '.rr-more-btn:hover, .rr-more-btn.active { color:var(--accent,#33ff33); }' +
      '.rr-more-drop { display:none; position:absolute; top:calc(100% + 10px); right:0; background:var(--bg-surface,#111); border:1px solid var(--border,#333); border-radius:var(--radius,6px); min-width:160px; padding:6px 0; z-index:1100; box-shadow:0 8px 24px rgba(0,0,0,0.5); }' +
      '.rr-more-drop.open { display:block; }' +
      '.rr-more-drop a { display:block; padding:8px 16px; color:var(--text,#e0e0e0); font-size:0.9rem; transition:background 0.15s,color 0.15s; }' +
      '.rr-more-drop a:hover, .rr-more-drop a.active { background:var(--accent-dim,rgba(51,255,51,0.15)); color:var(--accent,#33ff33); }' +
      /* Hamburger: 3 bars via spans, no unicode */
      '.menu-toggle { display:none; background:none; border:1px solid var(--border,#333); border-radius:var(--radius,6px); padding:7px 8px; cursor:pointer; flex-direction:column; gap:4px; align-items:center; justify-content:center; width:38px; height:34px; -webkit-tap-highlight-color:transparent; }' +
      '.menu-toggle:hover { border-color:var(--accent,#33ff33); }' +
      '.menu-toggle .bar { display:block; width:18px; height:2px; background:var(--accent,#33ff33); border-radius:1px; transition:transform 0.25s, opacity 0.25s; }' +
      '.menu-toggle.open .bar:nth-child(1) { transform:translateY(6px) rotate(45deg); }' +
      '.menu-toggle.open .bar:nth-child(2) { opacity:0; }' +
      '.menu-toggle.open .bar:nth-child(3) { transform:translateY(-6px) rotate(-45deg); }' +
      '.rr-logo-img { height:28px; width:auto; vertical-align:middle; margin-right:8px; }' +
      '@media(max-width:768px){' +
        '.menu-toggle { display:flex; }' +
        '.rr-more { display:none; }' + /* dropdown integrated in mobile nav */
        'header.header .nav { display:none; position:absolute; top:100%; left:0; right:0; background:rgba(10,10,10,0.98); border-bottom:1px solid var(--border,#333); flex-direction:column; padding:8px 0; gap:0; z-index:1050; }' +
        'header.header .nav.open { display:flex; }' +
        'header.header .nav a { padding:10px 20px; border-bottom:1px solid var(--border,#333); font-size:1rem; }' +
        'header.header .nav a:last-child { border-bottom:none; }' +
      '}';
    document.head.appendChild(style);
  }

  var isShop = page === 'products.html';
  var cartHtml = isShop
    ? '<button class="cart-toggle" onclick="toggleCart()" aria-label="Cart">&#128722;<span class="cart-badge" id="cartBadge"></span></button>'
    : '';

  header.innerHTML =
    '<div class="header-inner">' +
      '<a href="index.html" class="logo">' +
        '<img src="/favi.png" alt="Rooted Revival" class="rr-logo-img">' +
        '<span>ROOTED_REVIVAL</span>' +
      '</a>' +
      '<nav class="nav" id="mainNav">' +
        primaryHtml +
        '<span class="rr-more">' +
          '<button class="rr-more-btn' + (moreActive ? ' active' : '') + '" id="moreBtn" aria-expanded="false">More ▾</button>' +
          '<div class="rr-more-drop" id="moreDrop">' + moreHtml + '</div>' +
        '</span>' +
        '<a href="login.html" id="authLink">Log In</a>' +
      '</nav>' +
      cartHtml +
      '<button class="menu-toggle" id="menuToggle" aria-label="Menu">' +
        '<span class="bar"></span><span class="bar"></span><span class="bar"></span>' +
      '</button>' +
    '</div>';

  // Build mobile-specific link list (includes "more" links inline)
  var allMobileLinks = primary.concat(more);

  // More dropdown toggle (desktop)
  var moreBtn = document.getElementById('moreBtn');
  var moreDrop = document.getElementById('moreDrop');
  if (moreBtn && moreDrop) {
    moreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = moreDrop.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', function() {
      moreDrop.classList.remove('open');
      moreBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Mobile hamburger toggle — uses CSS bars, no text replacement
  var toggleBtn = document.getElementById('menuToggle');
  var nav = document.getElementById('mainNav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var isOpen = nav.classList.toggle('open');
      toggleBtn.classList.toggle('open', isOpen);
      toggleBtn.setAttribute('aria-expanded', isOpen);
      // On mobile, inject the "more" links into the main nav if not yet there
      if (isOpen && !nav.querySelector('.rr-mobile-extra')) {
        var frag = document.createDocumentFragment();
        var marker = document.createElement('span');
        marker.className = 'rr-mobile-extra';
        marker.style.display = 'contents';
        more.forEach(function(l) {
          var a = document.createElement('a');
          a.href = l.href;
          a.textContent = l.label;
          if (l.page === page) a.className = 'active';
          marker.appendChild(a);
        });
        // Insert before authLink
        var authEl = document.getElementById('authLink');
        if (authEl) { nav.insertBefore(marker, authEl); }
        else { nav.appendChild(marker); }
      }
    });
  }

  // Auth-aware nav
  var API_BASE = location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://scholar.rootedrevival.us/api';

  function setAuth(username) {
    var link = document.getElementById('authLink');
    if (link) { link.textContent = username; link.href = 'profile.html'; }
  }
  function clearAuth() {
    localStorage.removeItem('user');
    var link = document.getElementById('authLink');
    if (link) { link.textContent = 'Log In'; link.href = 'login.html'; }
    var adminEl = document.getElementById('adminLink');
    if (adminEl) adminEl.remove();
  }
  function addAdminLink() {
    if (document.getElementById('adminLink')) return;
    var n = document.getElementById('mainNav');
    if (!n) return;
    var a = document.createElement('a');
    a.href = 'admin.html';
    a.id = 'adminLink';
    a.style.cssText = 'color:var(--accent,#33ff33);font-weight:600';
    a.textContent = '⚙ Admin';
    if (page === 'admin.html') a.className = 'active';
    var authEl = document.getElementById('authLink');
    if (authEl) n.insertBefore(a, authEl);
    else n.appendChild(a);
  }

  // Quick update from localStorage
  try {
    var user = JSON.parse(localStorage.getItem('user'));
    if (user && user.username) setAuth(user.username);
    if (user && (user.is_admin || user.isAdmin)) addAdminLink();
  } catch(e) {}

  // Verify with server
  fetch(API_BASE + '/auth/me', { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data && data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
        setAuth(data.user.username);
        if (data.user.is_admin || data.user.isAdmin) addAdminLink();
        else { var el = document.getElementById('adminLink'); if (el) el.remove(); }
      } else {
        clearAuth();
      }
    })
    .catch(function() {});
})();
