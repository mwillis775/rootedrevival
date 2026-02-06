/**
 * Open Scholar - Content Templates
 * 
 * Render functions for different content types: papers, videos, art, music, collections
 */

(function() {
    'use strict';

    // ========================================
    // CONTENT TYPE BADGES
    // ========================================

    const TYPE_CONFIG = {
        paper: { icon: '📄', label: 'Paper', badge: 'badge-paper' },
        book: { icon: '📚', label: 'Book', badge: 'badge-book' },
        thesis: { icon: '🎓', label: 'Thesis', badge: 'badge-paper' },
        preprint: { icon: '📝', label: 'Preprint', badge: 'badge-paper' },
        dataset: { icon: '📊', label: 'Dataset', badge: 'badge-dataset' },
        video: { icon: '🎬', label: 'Video', badge: 'badge-video' },
        lecture: { icon: '🎤', label: 'Lecture', badge: 'badge-video' },
        tutorial: { icon: '📺', label: 'Tutorial', badge: 'badge-video' },
        documentary: { icon: '🎥', label: 'Documentary', badge: 'badge-video' },
        art: { icon: '🎨', label: 'Art', badge: 'badge-art' },
        photography: { icon: '📷', label: 'Photo', badge: 'badge-art' },
        music: { icon: '🎵', label: 'Music', badge: 'badge-music' },
        album: { icon: '💿', label: 'Album', badge: 'badge-music' },
        podcast: { icon: '🎙️', label: 'Podcast', badge: 'badge-music' },
        collection: { icon: '📁', label: 'Collection', badge: 'badge-collection' }
    };

    // ========================================
    // UTILITY FUNCTIONS
    // ========================================

    function formatDuration(seconds) {
        if (!seconds) return '';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function truncate(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    // ========================================
    // CARD TEMPLATES
    // ========================================

    const templates = {
        
        // Paper card (existing style, enhanced)
        paper(content) {
            const config = TYPE_CONFIG[content.content_type] || TYPE_CONFIG.paper;
            const authors = content.creators?.map(c => c.creator_name).join(', ') || 'Unknown';
            
            return `
                <article class="content-card paper-card">
                    <a href="/content/${content.uuid}" class="content-card-link" data-route="/content/${content.uuid}">
                        <div class="paper-header">
                            <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                        </div>
                        <h3 class="paper-title">${escapeHtml(content.title)}</h3>
                        <p class="paper-authors">${escapeHtml(authors)}</p>
                        ${content.description ? `<p class="paper-abstract">${escapeHtml(truncate(content.description, 200))}</p>` : ''}
                        <div class="paper-footer">
                            <div class="content-meta">
                                ${content.published_at ? `<span class="content-meta-item">📅 ${formatDate(content.published_at)}</span>` : ''}
                                <span class="content-meta-item">👁️ ${formatNumber(content.view_count || 0)}</span>
                                <span class="content-meta-item">📥 ${formatNumber(content.download_count || 0)}</span>
                            </div>
                            ${content.primary_discipline ? `<span class="paper-discipline">${escapeHtml(content.primary_discipline)}</span>` : ''}
                        </div>
                    </a>
                </article>
            `;
        },

        // Video card
        video(content) {
            const config = TYPE_CONFIG[content.content_type] || TYPE_CONFIG.video;
            const meta = content.metadata || {};
            const thumbnail = content.thumbnail_url || '/img/video-placeholder.png';
            
            return `
                <article class="content-card video-card">
                    <a href="/content/${content.uuid}" class="content-card-link" data-route="/content/${content.uuid}">
                        <div class="video-thumbnail">
                            <img src="${thumbnail}" alt="${escapeHtml(content.title)}" loading="lazy">
                            <div class="play-overlay">
                                <span class="play-icon">▶</span>
                            </div>
                            ${meta.duration ? `<span class="video-duration">${formatDuration(meta.duration)}</span>` : ''}
                        </div>
                        <div class="video-info">
                            <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                            <h3 class="video-title">${escapeHtml(content.title)}</h3>
                            <p class="video-creator">${escapeHtml(content.creator_name || 'Unknown')}</p>
                            <div class="video-stats">
                                <span>${formatNumber(content.view_count || 0)} views</span>
                                <span>•</span>
                                <span>${timeAgo(content.published_at || content.created_at)}</span>
                            </div>
                        </div>
                    </a>
                </article>
            `;
        },

        // Art / Image card
        art(content) {
            const config = TYPE_CONFIG[content.content_type] || TYPE_CONFIG.art;
            const meta = content.metadata || {};
            const image = content.thumbnail_url || content.image_url || '/img/art-placeholder.png';
            
            return `
                <article class="content-card art-card">
                    <a href="/content/${content.uuid}" class="content-card-link" data-route="/content/${content.uuid}">
                        <div class="art-image">
                            <img src="${image}" alt="${escapeHtml(content.title)}" loading="lazy">
                        </div>
                        <div class="art-info">
                            <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                            <h3 class="art-title">${escapeHtml(content.title)}</h3>
                            <p class="art-artist">${escapeHtml(meta.artist || content.creator_name || 'Unknown')}</p>
                            ${meta.medium ? `<span class="art-medium">${escapeHtml(meta.medium)}</span>` : ''}
                            <div class="content-meta" style="margin-top: 8px;">
                                <span class="content-meta-item">❤️ ${formatNumber(content.like_count || 0)}</span>
                                <span class="content-meta-item">👁️ ${formatNumber(content.view_count || 0)}</span>
                            </div>
                        </div>
                    </a>
                </article>
            `;
        },

        // Music / Audio card
        music(content) {
            const config = TYPE_CONFIG[content.content_type] || TYPE_CONFIG.music;
            const meta = content.metadata || {};
            const artwork = content.thumbnail_url || '/img/music-placeholder.png';
            
            return `
                <article class="content-card music-card" data-content-id="${content.uuid}">
                    <div class="music-artwork">
                        <img src="${artwork}" alt="${escapeHtml(content.title)}" loading="lazy">
                        <div class="music-play-btn" data-action="play">
                            <span>▶</span>
                        </div>
                    </div>
                    <div class="music-info">
                        <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                        <h3 class="music-title">
                            <a href="/content/${content.uuid}" data-route="/content/${content.uuid}">${escapeHtml(content.title)}</a>
                        </h3>
                        <p class="music-artist">${escapeHtml(meta.artist || content.creator_name || 'Unknown')}</p>
                        ${meta.album_name ? `<p class="music-album">${escapeHtml(meta.album_name)}</p>` : ''}
                    </div>
                    <span class="music-duration">${formatDuration(meta.duration)}</span>
                </article>
            `;
        },

        // Album card
        album(content) {
            const config = TYPE_CONFIG.album;
            const meta = content.metadata || {};
            const artwork = content.thumbnail_url || '/img/album-placeholder.png';
            
            return `
                <article class="content-card album-card">
                    <a href="/content/${content.uuid}" class="content-card-link" data-route="/content/${content.uuid}">
                        <div class="album-cover">
                            <img src="${artwork}" alt="${escapeHtml(content.title)}" loading="lazy">
                        </div>
                        <div class="album-info">
                            <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                            <h3 class="album-title">${escapeHtml(content.title)}</h3>
                            <p class="album-artist">${escapeHtml(meta.artist || content.creator_name || 'Unknown')}</p>
                            ${meta.track_count ? `<p class="album-tracks">${meta.track_count} tracks</p>` : ''}
                        </div>
                    </a>
                </article>
            `;
        },

        // Collection / Playlist card
        collection(content) {
            const config = TYPE_CONFIG.collection;
            const items = content.items || [];
            const previewImages = items.slice(0, 4).map(i => i.thumbnail_url || '/img/placeholder.png');
            
            return `
                <article class="content-card collection-card">
                    <a href="/content/${content.uuid}" class="content-card-link" data-route="/content/${content.uuid}">
                        <div class="collection-cover-grid">
                            ${previewImages.map(img => `<div class="cover-item" style="background-image: url(${img})"></div>`).join('')}
                            ${previewImages.length < 4 ? Array(4 - previewImages.length).fill('<div class="cover-item"></div>').join('') : ''}
                        </div>
                        <div class="collection-info">
                            <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                            <h3 class="collection-title">${escapeHtml(content.title)}</h3>
                            <p class="collection-creator">by ${escapeHtml(content.creator_name || 'Unknown')}</p>
                            <p class="collection-count">${content.item_count || items.length} items</p>
                        </div>
                    </a>
                </article>
            `;
        },

        // Generic fallback
        generic(content) {
            const config = TYPE_CONFIG[content.content_type] || { icon: '📄', label: 'Content', badge: 'badge-paper' };
            
            return `
                <article class="content-card paper-card">
                    <a href="/content/${content.uuid}" class="content-card-link" data-route="/content/${content.uuid}">
                        <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                        <h3 class="paper-title">${escapeHtml(content.title)}</h3>
                        <p class="paper-authors">${escapeHtml(content.creator_name || 'Unknown')}</p>
                        ${content.description ? `<p class="paper-abstract">${escapeHtml(truncate(content.description, 200))}</p>` : ''}
                        <div class="content-meta">
                            <span class="content-meta-item">👁️ ${formatNumber(content.view_count || 0)}</span>
                            <span class="content-meta-item">${timeAgo(content.created_at)}</span>
                        </div>
                    </a>
                </article>
            `;
        },

        // List view item (for all types)
        listItem(content) {
            const config = TYPE_CONFIG[content.content_type] || { icon: '📄', label: 'Content', badge: 'badge-paper' };
            const thumbnail = content.thumbnail_url || '/img/placeholder.png';
            
            return `
                <article class="content-list-item">
                    <div class="content-list-thumb">
                        <img src="${thumbnail}" alt="" loading="lazy">
                    </div>
                    <div class="content-list-info">
                        <span class="content-type-badge ${config.badge}">${config.icon} ${config.label}</span>
                        <h3 class="content-list-title">
                            <a href="/content/${content.uuid}" data-route="/content/${content.uuid}">${escapeHtml(content.title)}</a>
                        </h3>
                        <div class="content-list-meta">
                            <span>${escapeHtml(content.creator_name || 'Unknown')}</span>
                            <span>•</span>
                            <span>${timeAgo(content.published_at || content.created_at)}</span>
                            <span>•</span>
                            <span>${formatNumber(content.view_count || 0)} views</span>
                        </div>
                    </div>
                </article>
            `;
        }
    };

    // ========================================
    // DETAIL PAGE TEMPLATES
    // ========================================

    const detailTemplates = {
        
        video(content) {
            const meta = content.metadata || {};
            const videoUrl = content.video_url || content.file_url;
            
            return `
                <div class="video-detail">
                    <div class="video-player-container">
                        <video controls preload="metadata" poster="${content.thumbnail_url || ''}">
                            <source src="${videoUrl}" type="${content.mime_type || 'video/mp4'}">
                            Your browser does not support video playback.
                        </video>
                    </div>
                    
                    <div class="video-detail-info">
                        <div class="video-detail-main">
                            <h1 class="video-detail-title">${escapeHtml(content.title)}</h1>
                            
                            <div class="content-meta" style="margin-bottom: 15px;">
                                <span class="content-meta-item">👁️ ${formatNumber(content.view_count || 0)} views</span>
                                <span class="content-meta-item">📅 ${formatDate(content.published_at)}</span>
                                <span class="content-meta-item">❤️ ${formatNumber(content.like_count || 0)}</span>
                            </div>
                            
                            <div class="video-detail-actions">
                                <button class="btn" data-action="like">❤️ Like</button>
                                <button class="btn" data-action="save">📁 Save</button>
                                <button class="btn" data-action="share">🔗 Share</button>
                                <button class="btn" data-action="download">📥 Download</button>
                            </div>
                            
                            <div class="video-detail-creator" style="display: flex; align-items: center; gap: 15px; padding: 20px 0; border-bottom: 1px solid var(--border);">
                                <div class="creator-avatar" style="width: 50px; height: 50px; border-radius: 50%; background: var(--bg-alt);"></div>
                                <div>
                                    <a href="/user/${content.uploader_username}" class="creator-name" style="font-weight: 600;">${escapeHtml(content.creator_name || content.uploader_username)}</a>
                                </div>
                                <button class="btn btn-primary" style="margin-left: auto;">Follow</button>
                            </div>
                            
                            <div class="video-detail-description" style="padding: 20px 0;">
                                ${escapeHtml(content.description || 'No description provided.')}
                            </div>
                            
                            ${meta.chapters ? this.renderChapters(meta.chapters) : ''}
                        </div>
                        
                        <div class="video-detail-sidebar">
                            <h3 style="margin-bottom: 15px;">Related</h3>
                            <div id="relatedContent"></div>
                        </div>
                    </div>
                </div>
            `;
        },

        renderChapters(chapters) {
            if (!chapters || !chapters.length) return '';
            return `
                <div class="video-chapters" style="margin-top: 20px;">
                    <h4>Chapters</h4>
                    <div class="chapters-list">
                        ${chapters.map(ch => `
                            <div class="chapter-item" data-time="${ch.time}" style="display: flex; gap: 10px; padding: 8px 0; cursor: pointer;">
                                <span style="color: var(--primary); font-family: monospace;">${formatDuration(ch.time)}</span>
                                <span>${escapeHtml(ch.title)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        },

        art(content) {
            const meta = content.metadata || {};
            const imageUrl = content.image_url || content.file_url;
            
            return `
                <div class="art-detail">
                    <div class="art-detail-viewer">
                        <img src="${imageUrl}" alt="${escapeHtml(content.title)}">
                    </div>
                    
                    <div class="art-detail-info">
                        <h1 class="art-detail-title">${escapeHtml(content.title)}</h1>
                        <p class="art-detail-artist">
                            by <a href="/user/${content.uploader_username}">${escapeHtml(meta.artist || content.creator_name)}</a>
                        </p>
                        
                        <div class="art-detail-meta">
                            ${meta.medium ? `<div class="art-meta-item"><label>Medium</label><span>${escapeHtml(meta.medium)}</span></div>` : ''}
                            ${meta.dimensions ? `<div class="art-meta-item"><label>Dimensions</label><span>${escapeHtml(meta.dimensions)}</span></div>` : ''}
                            ${meta.year_created ? `<div class="art-meta-item"><label>Year</label><span>${meta.year_created}</span></div>` : ''}
                            ${meta.location ? `<div class="art-meta-item"><label>Location</label><span>${escapeHtml(meta.location)}</span></div>` : ''}
                            <div class="art-meta-item"><label>Views</label><span>${formatNumber(content.view_count || 0)}</span></div>
                            <div class="art-meta-item"><label>Likes</label><span>${formatNumber(content.like_count || 0)}</span></div>
                        </div>
                        
                        ${content.description ? `<div class="art-detail-description">${escapeHtml(content.description)}</div>` : ''}
                        
                        <div style="margin-top: 20px; display: flex; gap: 10px;">
                            <button class="btn" data-action="like">❤️ Like</button>
                            <button class="btn" data-action="save">📁 Save</button>
                            <button class="btn" data-action="download">📥 Download</button>
                        </div>
                    </div>
                </div>
            `;
        },

        music(content) {
            const meta = content.metadata || {};
            const audioUrl = content.audio_url || content.file_url;
            const artwork = content.thumbnail_url || '/img/music-placeholder.png';
            
            return `
                <div class="music-detail">
                    <div class="music-detail-header">
                        <div class="music-detail-cover">
                            <img src="${artwork}" alt="${escapeHtml(content.title)}">
                        </div>
                        <div class="music-detail-info">
                            <span class="music-detail-type">${meta.album_name ? 'Track' : 'Single'}</span>
                            <h1 class="music-detail-title">${escapeHtml(content.title)}</h1>
                            <p class="music-detail-artist">
                                <a href="/user/${content.uploader_username}">${escapeHtml(meta.artist || content.creator_name)}</a>
                            </p>
                            ${meta.album_name ? `<p style="color: var(--text-muted);">from <a href="/content/${meta.album_id}">${escapeHtml(meta.album_name)}</a></p>` : ''}
                            
                            <div class="content-meta" style="margin-top: 15px;">
                                ${meta.genre ? `<span class="content-meta-item">🎸 ${escapeHtml(meta.genre)}</span>` : ''}
                                ${meta.bpm ? `<span class="content-meta-item">🥁 ${meta.bpm} BPM</span>` : ''}
                                ${meta.key ? `<span class="content-meta-item">🎹 ${escapeHtml(meta.key)}</span>` : ''}
                            </div>
                            
                            <div style="margin-top: 20px; display: flex; gap: 10px;">
                                <button class="btn btn-primary" data-action="play">▶ Play</button>
                                <button class="btn" data-action="like">❤️ Like</button>
                                <button class="btn" data-action="save">📁 Save</button>
                                <button class="btn" data-action="download">📥 Download</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="audio-player" style="margin: 30px 0;">
                        <audio id="audioPlayer" src="${audioUrl}" preload="metadata"></audio>
                        <div class="audio-player-controls">
                            <button class="audio-player-btn" id="playPauseBtn">▶</button>
                        </div>
                        <div class="audio-player-progress">
                            <span class="audio-player-time" id="currentTime">0:00</span>
                            <div class="audio-player-bar" id="progressBar">
                                <div class="audio-player-bar-fill" id="progressFill"></div>
                            </div>
                            <span class="audio-player-time" id="duration">${formatDuration(meta.duration)}</span>
                        </div>
                    </div>
                    
                    ${meta.lyrics ? `
                        <div class="music-lyrics" style="margin-top: 30px;">
                            <h3>Lyrics</h3>
                            <pre style="white-space: pre-wrap; line-height: 1.8; font-family: inherit;">${escapeHtml(meta.lyrics)}</pre>
                        </div>
                    ` : ''}
                    
                    ${content.description ? `
                        <div style="margin-top: 30px;">
                            <h3>About</h3>
                            <p style="line-height: 1.8;">${escapeHtml(content.description)}</p>
                        </div>
                    ` : ''}
                </div>
            `;
        },

        album(content) {
            const meta = content.metadata || {};
            const artwork = content.thumbnail_url || '/img/album-placeholder.png';
            const tracks = content.tracks || [];
            
            return `
                <div class="music-detail">
                    <div class="music-detail-header">
                        <div class="music-detail-cover">
                            <img src="${artwork}" alt="${escapeHtml(content.title)}">
                        </div>
                        <div class="music-detail-info">
                            <span class="music-detail-type">Album</span>
                            <h1 class="music-detail-title">${escapeHtml(content.title)}</h1>
                            <p class="music-detail-artist">
                                <a href="/user/${content.uploader_username}">${escapeHtml(meta.artist || content.creator_name)}</a>
                            </p>
                            
                            <div class="content-meta" style="margin-top: 15px;">
                                <span class="content-meta-item">💿 ${tracks.length} tracks</span>
                                ${meta.genre ? `<span class="content-meta-item">🎸 ${escapeHtml(meta.genre)}</span>` : ''}
                                ${meta.year ? `<span class="content-meta-item">📅 ${meta.year}</span>` : ''}
                            </div>
                            
                            <div style="margin-top: 20px; display: flex; gap: 10px;">
                                <button class="btn btn-primary" data-action="play-all">▶ Play All</button>
                                <button class="btn" data-action="like">❤️ Like</button>
                                <button class="btn" data-action="save">📁 Save</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="tracklist" style="margin-top: 30px;">
                        ${tracks.map((track, i) => `
                            <div class="track-item" data-track-id="${track.uuid}">
                                <span class="track-number">${i + 1}</span>
                                <span class="track-play-icon">▶</span>
                                <span class="track-title">${escapeHtml(track.title)}</span>
                                <span class="track-duration">${formatDuration(track.duration)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        },

        collection(content) {
            const items = content.items || [];
            
            return `
                <div class="collection-detail">
                    <div class="collection-header">
                        <div class="collection-cover">
                            <!-- Grid of first 4 items -->
                        </div>
                        <div class="collection-header-info">
                            <span style="color: var(--text-muted); text-transform: uppercase; font-size: 0.8rem;">Collection</span>
                            <h1 class="collection-detail-title">${escapeHtml(content.title)}</h1>
                            <p style="color: var(--text-muted);">
                                by <a href="/user/${content.uploader_username}">${escapeHtml(content.creator_name)}</a>
                            </p>
                            <p class="collection-description">${escapeHtml(content.description || '')}</p>
                            <div class="content-meta" style="margin-top: 15px;">
                                <span class="content-meta-item">📁 ${items.length} items</span>
                                <span class="content-meta-item">👁️ ${formatNumber(content.view_count || 0)} views</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="collection-items">
                        ${items.map(item => `
                            <div class="collection-item">
                                <div class="collection-item-thumb">
                                    <img src="${item.thumbnail_url || '/img/placeholder.png'}" alt="" loading="lazy">
                                </div>
                                <div class="collection-item-info">
                                    <h4 class="collection-item-title">
                                        <a href="/content/${item.uuid}" data-route="/content/${item.uuid}">${escapeHtml(item.title)}</a>
                                    </h4>
                                    <div class="collection-item-meta">
                                        <span>${TYPE_CONFIG[item.content_type]?.icon || '📄'} ${TYPE_CONFIG[item.content_type]?.label || 'Content'}</span>
                                        <span>•</span>
                                        <span>${escapeHtml(item.creator_name || 'Unknown')}</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    };

    // ========================================
    // RENDER FUNCTIONS
    // ========================================

    function renderCard(content, viewMode = 'grid') {
        if (viewMode === 'list') {
            return templates.listItem(content);
        }

        const type = content.content_type || 'paper';
        
        // Map content type to template
        if (['paper', 'book', 'thesis', 'preprint', 'dataset'].includes(type)) {
            return templates.paper(content);
        }
        if (['video', 'lecture', 'tutorial', 'documentary'].includes(type)) {
            return templates.video(content);
        }
        if (['art', 'photography'].includes(type)) {
            return templates.art(content);
        }
        if (['music', 'podcast'].includes(type)) {
            return templates.music(content);
        }
        if (type === 'album') {
            return templates.album(content);
        }
        if (type === 'collection') {
            return templates.collection(content);
        }
        
        return templates.generic(content);
    }

    function renderGrid(contents, gridType = 'mixed', viewMode = 'grid') {
        const containerClass = viewMode === 'list' ? 'content-list' : `content-grid ${gridType}`;
        
        return `
            <div class="${containerClass}">
                ${contents.map(c => renderCard(c, viewMode)).join('')}
            </div>
        `;
    }

    function renderDetail(content) {
        const type = content.content_type || 'paper';
        
        if (['video', 'lecture', 'tutorial', 'documentary'].includes(type)) {
            return detailTemplates.video(content);
        }
        if (['art', 'photography'].includes(type)) {
            return detailTemplates.art(content);
        }
        if (['music', 'podcast'].includes(type)) {
            return detailTemplates.music(content);
        }
        if (type === 'album') {
            return detailTemplates.album(content);
        }
        if (type === 'collection') {
            return detailTemplates.collection(content);
        }
        
        // Default to paper detail (existing functionality)
        return null;
    }

    function renderViewToggle(currentView) {
        return `
            <div class="view-toggle">
                <button class="view-toggle-btn ${currentView === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">▦</button>
                <button class="view-toggle-btn ${currentView === 'list' ? 'active' : ''}" data-view="list" title="List view">☰</button>
            </div>
        `;
    }

    function renderContentFilter(currentType) {
        const types = [
            { id: 'all', label: 'All', icon: '📚' },
            { id: 'paper', label: 'Papers', icon: '📄' },
            { id: 'video', label: 'Videos', icon: '🎬' },
            { id: 'art', label: 'Art', icon: '🎨' },
            { id: 'music', label: 'Music', icon: '🎵' },
            { id: 'collection', label: 'Collections', icon: '📁' }
        ];

        return `
            <div class="content-filter" style="display: flex; gap: 10px; flex-wrap: wrap;">
                ${types.map(t => `
                    <button class="btn btn-sm ${currentType === t.id ? 'btn-primary' : ''}" data-filter="${t.id}">
                        ${t.icon} ${t.label}
                    </button>
                `).join('')}
            </div>
        `;
    }

    // ========================================
    // EXPORTS
    // ========================================

    window.ContentTemplates = {
        renderCard,
        renderGrid,
        renderDetail,
        renderViewToggle,
        renderContentFilter,
        templates,
        detailTemplates,
        TYPE_CONFIG,
        formatDuration,
        formatNumber,
        formatDate,
        timeAgo,
        escapeHtml,
        truncate
    };

})();
