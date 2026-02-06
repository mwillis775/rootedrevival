/**
 * Open Scholar - Theming System
 * 
 * Handles theme switching, user preferences, and profile customization.
 * Old internet vibes: let users express themselves!
 */

(function() {
    'use strict';

    const THEMES = [
        { id: 'terminal', name: 'Terminal', icon: '💻' },
        { id: 'vapor', name: 'Vaporwave', icon: '🌴' },
        { id: 'paper', name: 'Paper', icon: '📜' },
        { id: 'midnight', name: 'Midnight', icon: '🌙' },
        { id: 'solar', name: 'Solar', icon: '☀️' },
        { id: 'y2k', name: 'Y2K', icon: '💾' },
        { id: 'contrast', name: 'High Contrast', icon: '◐' },
        { id: 'matrix', name: 'Matrix', icon: '🟢' },
        { id: 'sepia', name: 'Sepia', icon: '📷' }
    ];

    const DENSITIES = ['compact', 'normal', 'comfortable'];
    
    const FONTS = [
        { id: 'system', name: 'System Default', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
        { id: 'mono', name: 'Monospace', value: '"Share Tech Mono", "Courier New", monospace' },
        { id: 'serif', name: 'Serif', value: 'Georgia, "Times New Roman", serif' },
        { id: 'comic', name: 'Comic', value: '"Comic Sans MS", "Trebuchet MS", sans-serif' },
        { id: 'terminal', name: 'Terminal', value: '"Courier New", monospace' }
    ];

    const PATTERNS = ['none', 'dots', 'grid', 'diagonal', 'crosses'];

    // ========================================
    // STORAGE
    // ========================================

    function getPreferences() {
        try {
            const stored = localStorage.getItem('scholar_prefs');
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    }

    function savePreferences(prefs) {
        try {
            const current = getPreferences();
            const updated = { ...current, ...prefs };
            localStorage.setItem('scholar_prefs', JSON.stringify(updated));
            return updated;
        } catch {
            return prefs;
        }
    }

    // ========================================
    // THEME APPLICATION
    // ========================================

    function applyTheme(themeId) {
        document.documentElement.setAttribute('data-theme', themeId);
        savePreferences({ theme: themeId });
        updateThemePickerUI(themeId);
    }

    function applyDensity(density) {
        document.documentElement.setAttribute('data-density', density);
        savePreferences({ density });
        updateDensityUI(density);
    }

    function applyFontSize(size) {
        document.documentElement.style.fontSize = `${size}%`;
        savePreferences({ fontSize: size });
    }

    function applyCustomColors(colors) {
        const root = document.documentElement;
        if (colors.primary) root.style.setProperty('--primary', colors.primary);
        if (colors.bg) root.style.setProperty('--bg', colors.bg);
        if (colors.text) root.style.setProperty('--text', colors.text);
        savePreferences({ customColors: colors });
    }

    function resetCustomColors() {
        const root = document.documentElement;
        root.style.removeProperty('--primary');
        root.style.removeProperty('--bg');
        root.style.removeProperty('--text');
        savePreferences({ customColors: null });
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    function initThemeSystem() {
        const prefs = getPreferences();
        
        // Apply saved preferences
        if (prefs.theme) applyTheme(prefs.theme);
        if (prefs.density) applyDensity(prefs.density);
        if (prefs.fontSize) applyFontSize(prefs.fontSize);
        if (prefs.customColors) applyCustomColors(prefs.customColors);
        
        // Create theme picker widget
        createThemePicker();
    }

    // ========================================
    // THEME PICKER WIDGET
    // ========================================

    function createThemePicker() {
        // Don't create if already exists
        if (document.querySelector('.theme-picker')) return;

        const picker = document.createElement('div');
        picker.className = 'theme-picker';
        picker.innerHTML = `
            <button class="theme-toggle" type="button">
                <span>🎨</span>
                <span>Theme</span>
            </button>
            <div class="theme-panel">
                <h4>Choose Theme</h4>
                <div class="theme-grid">
                    ${THEMES.map(t => `
                        <div class="theme-swatch-container">
                            <div class="theme-swatch" data-theme="${t.id}" title="${t.name}"></div>
                            <div class="theme-swatch-label">${t.icon}</div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="custom-theme-section">
                    <h5>Custom Colors</h5>
                    <div class="color-row">
                        <label>Accent</label>
                        <input type="color" id="customPrimary" value="#33ff33">
                    </div>
                    <div class="color-row">
                        <label>Background</label>
                        <input type="color" id="customBg" value="#0a0a0a">
                    </div>
                    <div class="color-row">
                        <label>Text</label>
                        <input type="color" id="customText" value="#33ff33">
                    </div>
                    <button class="btn btn-sm" id="applyCustomColors" style="margin-top: 10px; width: 100%;">Apply</button>
                    <button class="btn btn-sm btn-ghost" id="resetColors" style="margin-top: 5px; width: 100%;">Reset</button>
                </div>
                
                <div class="font-size-controls">
                    <label>Font Size</label>
                    <input type="range" id="fontSizeSlider" min="80" max="140" value="100" step="5">
                    <span id="fontSizeValue">100%</span>
                </div>
                
                <div class="density-controls">
                    <label>Layout Density</label>
                    <div class="density-buttons">
                        ${DENSITIES.map(d => `
                            <button class="density-btn" data-density="${d}">${d.charAt(0).toUpperCase() + d.slice(1)}</button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(picker);
        
        // Event listeners
        const toggle = picker.querySelector('.theme-toggle');
        const panel = picker.querySelector('.theme-panel');
        
        toggle.addEventListener('click', () => {
            panel.classList.toggle('open');
        });
        
        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!picker.contains(e.target)) {
                panel.classList.remove('open');
            }
        });
        
        // Theme swatches
        picker.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                applyTheme(swatch.dataset.theme);
                resetCustomColors();
            });
        });
        
        // Custom colors
        picker.querySelector('#applyCustomColors').addEventListener('click', () => {
            applyCustomColors({
                primary: picker.querySelector('#customPrimary').value,
                bg: picker.querySelector('#customBg').value,
                text: picker.querySelector('#customText').value
            });
        });
        
        picker.querySelector('#resetColors').addEventListener('click', resetCustomColors);
        
        // Font size
        const fontSlider = picker.querySelector('#fontSizeSlider');
        const fontValue = picker.querySelector('#fontSizeValue');
        
        fontSlider.addEventListener('input', () => {
            fontValue.textContent = `${fontSlider.value}%`;
            applyFontSize(parseInt(fontSlider.value));
        });
        
        // Density buttons
        picker.querySelectorAll('.density-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                applyDensity(btn.dataset.density);
            });
        });
        
        // Initialize with current values
        const prefs = getPreferences();
        if (prefs.fontSize) {
            fontSlider.value = prefs.fontSize;
            fontValue.textContent = `${prefs.fontSize}%`;
        }
        updateThemePickerUI(prefs.theme || 'terminal');
        updateDensityUI(prefs.density || 'normal');
    }

    function updateThemePickerUI(themeId) {
        document.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.classList.toggle('active', swatch.dataset.theme === themeId);
        });
    }

    function updateDensityUI(density) {
        document.querySelectorAll('.density-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.density === density);
        });
    }

    // ========================================
    // PROFILE CUSTOMIZATION (OWNER ONLY)
    // ========================================

    const profileCustomizer = {
        isOwner: false,
        profileData: null,

        init(userId, isOwner, profileData) {
            this.isOwner = isOwner;
            this.profileData = profileData;
            
            if (isOwner) {
                this.createCustomizerPanel();
            }
            
            this.applyProfileTheme(profileData);
        },

        applyProfileTheme(data) {
            const page = document.querySelector('.profile-page');
            if (!page) return;

            // Apply custom colors
            if (data.custom_bg_color) {
                page.style.setProperty('--profile-bg', data.custom_bg_color);
            }
            if (data.custom_text_color) {
                page.style.setProperty('--profile-text', data.custom_text_color);
            }
            if (data.custom_accent_color) {
                page.style.setProperty('--profile-accent', data.custom_accent_color);
            }
            
            // Apply font
            if (data.custom_font) {
                const font = FONTS.find(f => f.id === data.custom_font);
                if (font) {
                    page.style.setProperty('--profile-font', font.value);
                }
            }
            
            // Apply background image
            if (data.bg_image_url) {
                page.classList.add('has-bg-image');
                page.style.backgroundImage = `url(${data.bg_image_url})`;
            }
            
            // Apply pattern
            if (data.bg_pattern && data.bg_pattern !== 'none') {
                page.classList.add('has-bg-pattern');
                page.classList.add(`pattern-${data.bg_pattern}`);
            }

            // Banner
            if (data.banner_url) {
                const banner = page.querySelector('.profile-banner');
                if (banner) {
                    banner.classList.add('custom-banner');
                    banner.style.backgroundImage = `url(${data.banner_url})`;
                }
            }
        },

        createCustomizerPanel() {
            const panel = document.createElement('div');
            panel.className = 'profile-customizer';
            panel.innerHTML = `
                <h3>Customize Your Profile</h3>
                
                <div class="customizer-section">
                    <h4>Colors</h4>
                    <div class="customizer-row">
                        <label>Background Color</label>
                        <input type="color" id="profileBgColor" value="${this.profileData.custom_bg_color || '#0a0a0a'}">
                    </div>
                    <div class="customizer-row">
                        <label>Text Color</label>
                        <input type="color" id="profileTextColor" value="${this.profileData.custom_text_color || '#33ff33'}">
                    </div>
                    <div class="customizer-row">
                        <label>Accent Color</label>
                        <input type="color" id="profileAccentColor" value="${this.profileData.custom_accent_color || '#33ff33'}">
                    </div>
                </div>
                
                <div class="customizer-section">
                    <h4>Background</h4>
                    <div class="customizer-row">
                        <label>Background Image URL</label>
                        <input type="url" id="profileBgImage" placeholder="https://..." value="${this.profileData.bg_image_url || ''}">
                    </div>
                    <div class="customizer-row">
                        <label>Pattern</label>
                        <div class="pattern-grid">
                            ${PATTERNS.map(p => `
                                <div class="pattern-swatch ${p} ${this.profileData.bg_pattern === p ? 'active' : ''}" data-pattern="${p}" title="${p}"></div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <div class="customizer-section">
                    <h4>Font</h4>
                    <div class="customizer-row">
                        <select id="profileFont">
                            ${FONTS.map(f => `
                                <option value="${f.id}" ${this.profileData.custom_font === f.id ? 'selected' : ''}>${f.name}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
                
                <div class="customizer-section">
                    <h4>Banner</h4>
                    <div class="customizer-row">
                        <label>Banner Image URL</label>
                        <input type="url" id="profileBanner" placeholder="https://..." value="${this.profileData.banner_url || ''}">
                    </div>
                </div>
                
                <div class="customizer-section">
                    <h4>Profile Song 🎵</h4>
                    <div class="customizer-row">
                        <label>Song ID (from your uploads)</label>
                        <input type="text" id="profileSongId" placeholder="Song UUID" value="${this.profileData.profile_song_id || ''}">
                    </div>
                    <div class="customizer-row">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="profileAutoplay" ${this.profileData.autoplay_music ? 'checked' : ''}>
                            Autoplay for visitors
                        </label>
                    </div>
                </div>
                
                <div class="customizer-section">
                    <h4>Visibility</h4>
                    <div class="customizer-row">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="showGuestbook" ${this.profileData.show_guestbook !== 0 ? 'checked' : ''}>
                            Show Guestbook
                        </label>
                    </div>
                    <div class="customizer-row">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="showFriends" ${this.profileData.show_friends !== 0 ? 'checked' : ''}>
                            Show Friends
                        </label>
                    </div>
                    <div class="customizer-row">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="showActivity" ${this.profileData.show_activity !== 0 ? 'checked' : ''}>
                            Show Recent Activity
                        </label>
                    </div>
                </div>
                
                <div style="margin-top: 20px;">
                    <button class="btn btn-primary" id="saveProfile" style="width: 100%;">Save Changes</button>
                </div>
                <div style="margin-top: 10px;">
                    <button class="btn btn-ghost" id="previewProfile" style="width: 100%;">Preview</button>
                </div>
            `;

            // Toggle button
            const toggle = document.createElement('button');
            toggle.className = 'customizer-toggle';
            toggle.textContent = '✏️ Customize';
            toggle.addEventListener('click', () => {
                panel.classList.toggle('open');
            });

            document.body.appendChild(panel);
            document.body.appendChild(toggle);

            // Event listeners
            this.attachCustomizerEvents(panel);
        },

        attachCustomizerEvents(panel) {
            // Pattern selection
            panel.querySelectorAll('.pattern-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    panel.querySelectorAll('.pattern-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                    this.previewChanges();
                });
            });

            // Live preview on color changes
            ['profileBgColor', 'profileTextColor', 'profileAccentColor'].forEach(id => {
                panel.querySelector(`#${id}`).addEventListener('input', () => this.previewChanges());
            });

            // Font change
            panel.querySelector('#profileFont').addEventListener('change', () => this.previewChanges());

            // Save button
            panel.querySelector('#saveProfile').addEventListener('click', () => this.saveChanges());

            // Preview button
            panel.querySelector('#previewProfile').addEventListener('click', () => this.previewChanges());
        },

        previewChanges() {
            const panel = document.querySelector('.profile-customizer');
            const data = {
                custom_bg_color: panel.querySelector('#profileBgColor').value,
                custom_text_color: panel.querySelector('#profileTextColor').value,
                custom_accent_color: panel.querySelector('#profileAccentColor').value,
                custom_font: panel.querySelector('#profileFont').value,
                bg_image_url: panel.querySelector('#profileBgImage').value,
                bg_pattern: panel.querySelector('.pattern-swatch.active')?.dataset.pattern || 'none',
                banner_url: panel.querySelector('#profileBanner').value
            };
            this.applyProfileTheme(data);
        },

        async saveChanges() {
            const panel = document.querySelector('.profile-customizer');
            const data = {
                custom_bg_color: panel.querySelector('#profileBgColor').value,
                custom_text_color: panel.querySelector('#profileTextColor').value,
                custom_accent_color: panel.querySelector('#profileAccentColor').value,
                custom_font: panel.querySelector('#profileFont').value,
                bg_image_url: panel.querySelector('#profileBgImage').value,
                bg_pattern: panel.querySelector('.pattern-swatch.active')?.dataset.pattern || 'none',
                banner_url: panel.querySelector('#profileBanner').value,
                profile_song_id: panel.querySelector('#profileSongId').value || null,
                autoplay_music: panel.querySelector('#profileAutoplay').checked ? 1 : 0,
                show_guestbook: panel.querySelector('#showGuestbook').checked ? 1 : 0,
                show_friends: panel.querySelector('#showFriends').checked ? 1 : 0,
                show_activity: panel.querySelector('#showActivity').checked ? 1 : 0
            };

            try {
                const response = await fetch('/api/profile/customize', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    this.profileData = { ...this.profileData, ...data };
                    alert('Profile saved!');
                } else {
                    alert('Failed to save. Please try again.');
                }
            } catch (error) {
                console.error('Save error:', error);
                alert('Failed to save. Please try again.');
            }
        }
    };

    // ========================================
    // EXPORTS
    // ========================================

    window.ScholarThemes = {
        init: initThemeSystem,
        applyTheme,
        applyDensity,
        applyFontSize,
        getPreferences,
        savePreferences,
        profileCustomizer,
        THEMES,
        FONTS,
        PATTERNS
    };

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initThemeSystem);
    } else {
        initThemeSystem();
    }

})();
