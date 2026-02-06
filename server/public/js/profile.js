/**
 * Open Scholar - User Profile Page
 * 
 * Profile pages are customizable by the owner (like MySpace!)
 * Visitors see the owner's custom theme; owner can edit their page.
 */

(function() {
    'use strict';

    // ========================================
    // PROFILE PAGE TEMPLATE
    // ========================================

    function renderProfilePage(user, isOwner, profileData) {
        const prefs = profileData || {};
        const sections = parseSectionOrder(prefs.section_order);
        
        return `
            <div class="profile-page" id="profilePage">
                <!-- Banner -->
                <div class="profile-banner ${prefs.banner_url ? 'custom-banner' : ''}" 
                     style="${prefs.banner_url ? `background-image: url(${prefs.banner_url})` : ''}">
                </div>
                
                <!-- Profile Card -->
                <div class="profile-card">
                    <div class="profile-header-row" style="display: flex; gap: 30px; align-items: flex-start; flex-wrap: wrap;">
                        <div class="profile-avatar">
                            ${prefs.avatar_url 
                                ? `<img src="${prefs.avatar_url}" alt="${escapeHtml(user.display_name || user.username)}">` 
                                : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 4rem; background: var(--bg-alt);">${getInitials(user.display_name || user.username)}</div>`
                            }
                        </div>
                        
                        <div class="profile-info" style="flex: 1;">
                            <h1 class="profile-name">${escapeHtml(user.display_name || user.username)}</h1>
                            <p class="profile-username">@${escapeHtml(user.username)}</p>
                            
                            ${user.bio ? `<p class="profile-bio">${escapeHtml(user.bio)}</p>` : ''}
                            
                            <div class="profile-meta" style="display: flex; gap: 20px; margin-top: 15px; flex-wrap: wrap;">
                                ${user.affiliation ? `<span>🏛️ ${escapeHtml(user.affiliation)}</span>` : ''}
                                ${user.orcid ? `<a href="https://orcid.org/${user.orcid}" target="_blank">ORCID: ${user.orcid}</a>` : ''}
                                <span>📅 Joined ${formatJoinDate(user.created_at)}</span>
                            </div>
                            
                            <div class="profile-stats" style="display: flex; gap: 25px; margin-top: 15px;">
                                <span><strong>${user.upload_count || 0}</strong> uploads</span>
                                <span><strong>${user.follower_count || 0}</strong> followers</span>
                                <span><strong>${user.following_count || 0}</strong> following</span>
                                <span>👁️ ${prefs.view_count || 0} profile views</span>
                            </div>
                        </div>
                        
                        <div class="profile-actions" style="display: flex; gap: 10px;">
                            ${isOwner 
                                ? `<button class="btn" id="editProfileBtn">✏️ Edit Profile</button>`
                                : `<button class="btn btn-primary" id="followBtn" data-user-id="${user.id}">Follow</button>
                                   <button class="btn" id="messageBtn">💬 Message</button>`
                            }
                        </div>
                    </div>
                    
                    ${prefs.profile_song_id ? renderProfileMusicPlayer(prefs) : ''}
                </div>
                
                <!-- Profile Content -->
                <div class="profile-content" style="max-width: 1200px; margin: 40px auto; padding: 0 20px;">
                    <div class="profile-widgets">
                        ${sections.map(section => renderProfileSection(section, user, prefs, isOwner)).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function parseSectionOrder(sectionOrder) {
        try {
            return JSON.parse(sectionOrder || '["about","uploads","collections","friends","guestbook"]');
        } catch {
            return ['about', 'uploads', 'collections', 'friends', 'guestbook'];
        }
    }

    function renderProfileSection(sectionId, user, prefs, isOwner) {
        switch (sectionId) {
            case 'about':
                return renderAboutSection(user);
            case 'uploads':
                return renderUploadsSection(user);
            case 'collections':
                return prefs.show_collections !== 0 ? renderCollectionsSection(user) : '';
            case 'friends':
                return prefs.show_friends !== 0 ? renderFriendsSection(user) : '';
            case 'guestbook':
                return prefs.show_guestbook !== 0 ? renderGuestbookSection(user, isOwner) : '';
            case 'activity':
                return prefs.show_activity !== 0 ? renderActivitySection(user) : '';
            default:
                return '';
        }
    }

    function renderAboutSection(user) {
        return `
            <div class="profile-section profile-widget" id="section-about">
                <h3 class="profile-section-title">📝 About</h3>
                <div class="about-content">
                    ${user.bio 
                        ? `<p style="line-height: 1.8;">${escapeHtml(user.bio)}</p>` 
                        : `<p style="color: var(--text-muted);">No bio yet.</p>`
                    }
                    
                    ${user.affiliation ? `
                        <div style="margin-top: 15px;">
                            <strong>Affiliation:</strong> ${escapeHtml(user.affiliation)}
                        </div>
                    ` : ''}
                    
                    ${user.interests?.length ? `
                        <div style="margin-top: 15px;">
                            <strong>Interests:</strong>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                ${user.interests.map(i => `<span style="padding: 4px 10px; background: var(--bg-alt); border: 1px solid var(--border); font-size: 0.85rem;">${escapeHtml(i)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function renderUploadsSection(user) {
        return `
            <div class="profile-section profile-widget" id="section-uploads" style="grid-column: 1 / -1;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 class="profile-section-title" style="margin: 0; border: none; padding: 0;">📚 Uploads</h3>
                    <a href="/user/${user.username}/uploads" style="font-size: 0.85rem;">View All →</a>
                </div>
                <div id="userUploads" class="content-grid mixed">
                    <p style="color: var(--text-muted);">Loading...</p>
                </div>
            </div>
        `;
    }

    function renderCollectionsSection(user) {
        return `
            <div class="profile-section profile-widget" id="section-collections">
                <h3 class="profile-section-title">📁 Collections</h3>
                <div id="userCollections">
                    <p style="color: var(--text-muted);">Loading...</p>
                </div>
            </div>
        `;
    }

    function renderFriendsSection(user) {
        return `
            <div class="profile-section profile-widget" id="section-friends">
                <h3 class="profile-section-title">👥 Friends</h3>
                <div id="userFriends" class="friends-grid">
                    <p style="color: var(--text-muted);">Loading...</p>
                </div>
            </div>
        `;
    }

    function renderGuestbookSection(user, isOwner) {
        return `
            <div class="profile-section profile-widget" id="section-guestbook">
                <h3 class="profile-section-title">📓 Guestbook</h3>
                <div class="guestbook" id="guestbookEntries">
                    <p style="color: var(--text-muted);">Loading...</p>
                </div>
                <form class="guestbook-form" id="guestbookForm">
                    <textarea placeholder="Leave a message..." required></textarea>
                    <button type="submit" class="btn btn-primary">Sign Guestbook</button>
                </form>
            </div>
        `;
    }

    function renderActivitySection(user) {
        return `
            <div class="profile-section profile-widget" id="section-activity">
                <h3 class="profile-section-title">📊 Recent Activity</h3>
                <div id="userActivity">
                    <p style="color: var(--text-muted);">Loading...</p>
                </div>
            </div>
        `;
    }

    function renderProfileMusicPlayer(prefs) {
        return `
            <div class="profile-music-player" id="profileMusicPlayer">
                <div class="album-art" id="profileSongArt"></div>
                <div class="track-info">
                    <div class="track-title" id="profileSongTitle">Loading...</div>
                    <div class="track-artist" id="profileSongArtist"></div>
                </div>
                <button class="btn btn-sm" id="profileMusicToggle">▶</button>
                <audio id="profileAudio" ${prefs.autoplay_music ? 'autoplay' : ''}></audio>
            </div>
        `;
    }

    function renderGuestbookEntry(entry) {
        return `
            <div class="guestbook-entry" data-entry-id="${entry.id}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="guestbook-author">
                        ${entry.author_user_id 
                            ? `<a href="/user/${entry.author_username}">@${escapeHtml(entry.author_username)}</a>`
                            : escapeHtml(entry.author_name || 'Anonymous')
                        }
                    </span>
                    <span class="guestbook-date">${timeAgo(entry.created_at)}</span>
                </div>
                <p class="guestbook-message">${escapeHtml(entry.message)}</p>
            </div>
        `;
    }

    function renderFriendItem(user) {
        return `
            <a href="/user/${user.username}" class="friend-item">
                <div class="friend-avatar">
                    ${user.avatar_url 
                        ? `<img src="${user.avatar_url}" alt="${escapeHtml(user.display_name || user.username)}">`
                        : ''
                    }
                </div>
                <div class="friend-name">${escapeHtml(user.display_name || user.username)}</div>
            </a>
        `;
    }

    function renderActivityItem(activity) {
        const icons = {
            upload: '📤',
            like: '❤️',
            follow: '👥',
            comment: '💬',
            collection_add: '📁'
        };
        
        const icon = icons[activity.activity_type] || '📌';
        
        return `
            <div class="activity-item" style="display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border);">
                <span style="font-size: 1.2rem;">${icon}</span>
                <div>
                    <span>${getActivityText(activity)}</span>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${timeAgo(activity.created_at)}</div>
                </div>
            </div>
        `;
    }

    function getActivityText(activity) {
        switch (activity.activity_type) {
            case 'upload':
                return `Uploaded <a href="/content/${activity.content_uuid}">${escapeHtml(activity.content_title)}</a>`;
            case 'like':
                return `Liked <a href="/content/${activity.content_uuid}">${escapeHtml(activity.content_title)}</a>`;
            case 'follow':
                return `Started following <a href="/user/${activity.target_username}">@${escapeHtml(activity.target_username)}</a>`;
            case 'comment':
                return `Commented on <a href="/content/${activity.content_uuid}">${escapeHtml(activity.content_title)}</a>`;
            case 'collection_add':
                return `Added to collection: <a href="/content/${activity.content_uuid}">${escapeHtml(activity.content_title)}</a>`;
            default:
                return 'Did something';
        }
    }

    // ========================================
    // UTILITY FUNCTIONS
    // ========================================

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function timeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        
        const intervals = [
            { label: 'year', seconds: 31536000 },
            { label: 'month', seconds: 2592000 },
            { label: 'week', seconds: 604800 },
            { label: 'day', seconds: 86400 },
            { label: 'hour', seconds: 3600 },
            { label: 'minute', seconds: 60 }
        ];
        
        for (const interval of intervals) {
            const count = Math.floor(seconds / interval.seconds);
            if (count >= 1) {
                return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
            }
        }
        return 'just now';
    }

    function formatJoinDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    }

    // ========================================
    // PROFILE PAGE CONTROLLER
    // ========================================

    const ProfilePage = {
        user: null,
        isOwner: false,
        profileData: null,

        async init(username) {
            try {
                // Fetch user data
                const response = await fetch(`/api/users/${username}/profile`, { credentials: 'include' });
                if (!response.ok) throw new Error('User not found');
                
                const data = await response.json();
                this.user = data.user;
                this.isOwner = data.isOwner;
                this.profileData = data.profile || {};
                
                // Render page
                const container = document.getElementById('main-content');
                container.innerHTML = renderProfilePage(this.user, this.isOwner, this.profileData);
                
                // Apply profile theme
                if (window.ScholarThemes) {
                    window.ScholarThemes.profileCustomizer.init(
                        this.user.id, 
                        this.isOwner, 
                        this.profileData
                    );
                }
                
                // Load dynamic sections
                this.loadUploads();
                if (this.profileData.show_collections !== 0) this.loadCollections();
                if (this.profileData.show_friends !== 0) this.loadFriends();
                if (this.profileData.show_guestbook !== 0) this.loadGuestbook();
                if (this.profileData.show_activity !== 0) this.loadActivity();
                if (this.profileData.profile_song_id) this.loadProfileSong();
                
                // Setup event listeners
                this.attachEventListeners();
                
                // Increment view count (if not owner)
                if (!this.isOwner) {
                    fetch(`/api/users/${username}/view`, { method: 'POST', credentials: 'include' });
                }
                
            } catch (error) {
                console.error('Profile load error:', error);
                const container = document.getElementById('main-content');
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px;">
                        <h1>User Not Found</h1>
                        <p style="color: var(--text-muted);">The user @${escapeHtml(username)} doesn't exist.</p>
                    </div>
                `;
            }
        },

        async loadUploads() {
            try {
                const response = await fetch(`/api/users/${this.user.username}/content?limit=6`);
                const data = await response.json();
                
                const container = document.getElementById('userUploads');
                if (data.content?.length) {
                    container.innerHTML = window.ContentTemplates 
                        ? window.ContentTemplates.renderGrid(data.content, 'mixed')
                        : data.content.map(c => `<div>${c.title}</div>`).join('');
                } else {
                    container.innerHTML = '<p style="color: var(--text-muted);">No uploads yet.</p>';
                }
            } catch (error) {
                console.error('Failed to load uploads:', error);
            }
        },

        async loadCollections() {
            try {
                const response = await fetch(`/api/users/${this.user.username}/collections?limit=4`);
                const data = await response.json();
                
                const container = document.getElementById('userCollections');
                if (data.collections?.length) {
                    container.innerHTML = data.collections.map(c => `
                        <a href="/content/${c.uuid}" style="display: block; padding: 8px 0; border-bottom: 1px solid var(--border);">
                            📁 ${escapeHtml(c.title)} (${c.item_count} items)
                        </a>
                    `).join('');
                } else {
                    container.innerHTML = '<p style="color: var(--text-muted);">No collections yet.</p>';
                }
            } catch (error) {
                console.error('Failed to load collections:', error);
            }
        },

        async loadFriends() {
            try {
                const response = await fetch(`/api/users/${this.user.username}/following?limit=8`);
                const data = await response.json();
                
                const container = document.getElementById('userFriends');
                if (data.following?.length) {
                    container.innerHTML = data.following.map(renderFriendItem).join('');
                } else {
                    container.innerHTML = '<p style="color: var(--text-muted);">Not following anyone yet.</p>';
                }
            } catch (error) {
                console.error('Failed to load friends:', error);
            }
        },

        async loadGuestbook() {
            try {
                const response = await fetch(`/api/users/${this.user.username}/guestbook?limit=10`);
                const data = await response.json();
                
                const container = document.getElementById('guestbookEntries');
                if (data.entries?.length) {
                    container.innerHTML = data.entries.map(renderGuestbookEntry).join('');
                } else {
                    container.innerHTML = '<p style="color: var(--text-muted);">No guestbook entries yet. Be the first!</p>';
                }
            } catch (error) {
                console.error('Failed to load guestbook:', error);
            }
        },

        async loadActivity() {
            try {
                const response = await fetch(`/api/users/${this.user.username}/activity?limit=10`);
                const data = await response.json();
                
                const container = document.getElementById('userActivity');
                if (data.activity?.length) {
                    container.innerHTML = data.activity.map(renderActivityItem).join('');
                } else {
                    container.innerHTML = '<p style="color: var(--text-muted);">No recent activity.</p>';
                }
            } catch (error) {
                console.error('Failed to load activity:', error);
            }
        },

        async loadProfileSong() {
            try {
                const response = await fetch(`/api/content/${this.profileData.profile_song_id}`);
                const data = await response.json();
                
                if (data.content) {
                    document.getElementById('profileSongTitle').textContent = data.content.title;
                    document.getElementById('profileSongArtist').textContent = data.content.metadata?.artist || '';
                    if (data.content.thumbnail_url) {
                        document.getElementById('profileSongArt').innerHTML = `<img src="${data.content.thumbnail_url}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    }
                    
                    const audio = document.getElementById('profileAudio');
                    audio.src = data.content.audio_url || data.content.file_url;
                }
            } catch (error) {
                console.error('Failed to load profile song:', error);
            }
        },

        attachEventListeners() {
            // Guestbook form
            const guestbookForm = document.getElementById('guestbookForm');
            if (guestbookForm) {
                guestbookForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const textarea = guestbookForm.querySelector('textarea');
                    const message = textarea.value.trim();
                    if (!message) return;
                    
                    try {
                        const response = await fetch(`/api/users/${this.user.username}/guestbook`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ message })
                        });
                        
                        if (response.ok) {
                            textarea.value = '';
                            this.loadGuestbook();
                        } else {
                            const data = await response.json();
                            alert(data.error || 'Failed to sign guestbook');
                        }
                    } catch (error) {
                        alert('Failed to sign guestbook');
                    }
                });
            }

            // Follow button
            const followBtn = document.getElementById('followBtn');
            if (followBtn) {
                followBtn.addEventListener('click', async () => {
                    try {
                        const response = await fetch(`/api/users/${this.user.username}/follow`, {
                            method: 'POST',
                            credentials: 'include'
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            followBtn.textContent = data.following ? 'Unfollow' : 'Follow';
                            followBtn.classList.toggle('btn-primary', !data.following);
                        }
                    } catch (error) {
                        alert('Failed to follow user');
                    }
                });
            }

            // Profile music player
            const musicToggle = document.getElementById('profileMusicToggle');
            const audio = document.getElementById('profileAudio');
            if (musicToggle && audio) {
                musicToggle.addEventListener('click', () => {
                    if (audio.paused) {
                        audio.play();
                        musicToggle.textContent = '⏸';
                    } else {
                        audio.pause();
                        musicToggle.textContent = '▶';
                    }
                });
                
                audio.addEventListener('ended', () => {
                    musicToggle.textContent = '▶';
                });
            }

            // Edit profile button
            const editBtn = document.getElementById('editProfileBtn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    const customizer = document.querySelector('.profile-customizer');
                    if (customizer) {
                        customizer.classList.toggle('open');
                    }
                });
            }
        }
    };

    // ========================================
    // EXPORTS
    // ========================================

    window.ProfilePage = ProfilePage;
    window.ProfileTemplates = {
        renderProfilePage,
        renderGuestbookEntry,
        renderFriendItem,
        renderActivityItem
    };

})();
