/**
 * GrabNet Desktop - Electron Main Process
 * 
 * A GUI application for publishing and managing websites on GrabNet,
 * the decentralized permanent web.
 */

const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const Store = require('electron-store');

// Persistent storage for user settings and projects
const store = new Store({
    defaults: {
        theme: 'dark',
        windowBounds: { width: 1200, height: 800 },
        grabBinaryPath: null,
        gatewayPort: 8080,
        autoStartNode: true,
        projects: [],
        pinnedSites: []
    }
});

// Keep references to prevent garbage collection
let mainWindow = null;
let grabProcess = null;
let gatewayProcess = null;

// ========================================
// GRAB BINARY MANAGEMENT
// ========================================

function getGrabBinaryPath() {
    // Check user-configured path first
    const configuredPath = store.get('grabBinaryPath');
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }

    // Check bundled binary in resources
    const resourcePath = process.resourcesPath 
        ? path.join(process.resourcesPath, 'bin', 'grab')
        : path.join(__dirname, '..', 'grab', 'target', 'release', 'grab');
    
    if (fs.existsSync(resourcePath)) {
        return resourcePath;
    }

    // Check if grab is in PATH
    const isWindows = process.platform === 'win32';
    const grabName = isWindows ? 'grab.exe' : 'grab';
    
    // Check common locations
    const locations = [
        path.join(__dirname, '..', 'grab', 'target', 'release', grabName),
        path.join(app.getPath('home'), '.cargo', 'bin', grabName),
        '/usr/local/bin/grab',
        '/usr/bin/grab'
    ];

    for (const loc of locations) {
        if (fs.existsSync(loc)) {
            return loc;
        }
    }

    return null;
}

async function runGrabCommand(args) {
    const grabPath = getGrabBinaryPath();
    
    if (!grabPath) {
        throw new Error('GrabNet binary not found. Please install grab or configure the path in settings.');
    }

    return new Promise((resolve, reject) => {
        const proc = spawn(grabPath, args, {
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(stderr || `Command failed with code ${code}`));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

// ========================================
// WINDOW MANAGEMENT
// ========================================

function createMainWindow() {
    const bounds = store.get('windowBounds');
    
    mainWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0a0a0a',
        titleBarStyle: 'hiddenInset',
        frame: process.platform !== 'darwin',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'build', 'icon.png')
    });

    // Load the main UI
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Save window bounds on resize
    mainWindow.on('resize', () => {
        const { width, height } = mainWindow.getBounds();
        store.set('windowBounds', { width, height });
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createMenu() {
    const template = [
        {
            label: 'GrabNet',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                {
                    label: 'Settings',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        mainWindow?.webContents.send('navigate', 'settings');
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Project',
            submenu: [
                {
                    label: 'New Project',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow?.webContents.send('action', 'new-project');
                    }
                },
                {
                    label: 'Open Project Folder...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory']
                        });
                        if (!result.canceled && result.filePaths[0]) {
                            mainWindow?.webContents.send('open-project', result.filePaths[0]);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Publish Current',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => {
                        mainWindow?.webContents.send('action', 'publish');
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => {
                        shell.openExternal('https://grabnet.io/docs');
                    }
                },
                {
                    label: 'GitHub',
                    click: () => {
                        shell.openExternal('https://github.com/grabnet');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ========================================
// IPC HANDLERS - App Info
// ========================================

ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    grabPath: getGrabBinaryPath()
}));

ipcMain.handle('get-settings', () => store.store);

ipcMain.handle('set-setting', (event, key, value) => {
    store.set(key, value);
    return { success: true };
});

// ========================================
// IPC HANDLERS - GrabNet Operations
// ========================================

ipcMain.handle('grab-check-binary', () => {
    const path = getGrabBinaryPath();
    return { found: !!path, path };
});

ipcMain.handle('grab-node-status', async () => {
    try {
        const result = await runGrabCommand(['node', 'status']);
        // Parse the status output
        const lines = result.stdout.split('\n');
        const running = !result.stdout.includes('not running');
        
        return { 
            running,
            output: result.stdout
        };
    } catch (error) {
        return { running: false, error: error.message };
    }
});

ipcMain.handle('grab-node-start', async () => {
    try {
        const result = await runGrabCommand(['node', 'start']);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-node-stop', async () => {
    try {
        const result = await runGrabCommand(['node', 'stop']);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-publish', async (event, options) => {
    try {
        const args = ['publish', options.path];
        
        if (options.name) {
            args.push('--name', options.name);
        }
        if (options.entry) {
            args.push('--entry', options.entry);
        }
        if (options.spa) {
            args.push('--spa', options.spa);
        }
        if (options.cleanUrls) {
            args.push('--clean-urls');
        }
        if (options.noCompress) {
            args.push('--no-compress');
        }

        const result = await runGrabCommand(args);
        
        // Parse the site ID from output
        const siteIdMatch = result.stdout.match(/Site ID:\s*(\S+)/);
        const siteId = siteIdMatch ? siteIdMatch[1] : null;

        return { 
            success: true, 
            output: result.stdout,
            siteId 
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-list', async () => {
    try {
        const result = await runGrabCommand(['list']);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-info', async (event, siteId) => {
    try {
        const result = await runGrabCommand(['info', siteId]);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-pin', async (event, siteId, peerAddress) => {
    try {
        const args = ['pin', siteId];
        if (peerAddress) {
            args.push('--peer', peerAddress);
        }
        const result = await runGrabCommand(args);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-unhost', async (event, siteId) => {
    try {
        const result = await runGrabCommand(['unhost', siteId]);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-gateway-start', async (event, port, defaultSite) => {
    try {
        const args = ['gateway', '--port', String(port || 8080)];
        if (defaultSite) {
            args.push('--default-site', defaultSite);
        }
        
        const grabPath = getGrabBinaryPath();
        if (!grabPath) {
            throw new Error('GrabNet binary not found');
        }

        // Start gateway as background process
        gatewayProcess = spawn(grabPath, args, {
            detached: true,
            stdio: 'ignore'
        });
        
        gatewayProcess.unref();
        
        return { success: true, port: port || 8080 };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-stats', async () => {
    try {
        const result = await runGrabCommand(['stats']);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-keys-list', async () => {
    try {
        const result = await runGrabCommand(['keys', 'list']);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('grab-keys-generate', async (event, name) => {
    try {
        const result = await runGrabCommand(['keys', 'generate', name]);
        return { success: true, output: result.stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// IPC HANDLERS - Project Management
// ========================================

ipcMain.handle('get-projects', () => {
    return store.get('projects');
});

ipcMain.handle('add-project', (event, project) => {
    const projects = store.get('projects');
    const existing = projects.findIndex(p => p.path === project.path);
    
    if (existing >= 0) {
        projects[existing] = { ...projects[existing], ...project };
    } else {
        projects.push({
            id: Date.now().toString(),
            name: project.name || path.basename(project.path),
            path: project.path,
            siteId: project.siteId || null,
            lastPublished: null,
            createdAt: new Date().toISOString()
        });
    }
    
    store.set('projects', projects);
    return { success: true, projects };
});

ipcMain.handle('remove-project', (event, projectId) => {
    const projects = store.get('projects').filter(p => p.id !== projectId);
    store.set('projects', projects);
    return { success: true, projects };
});

ipcMain.handle('update-project', (event, projectId, updates) => {
    const projects = store.get('projects');
    const idx = projects.findIndex(p => p.id === projectId);
    
    if (idx >= 0) {
        projects[idx] = { ...projects[idx], ...updates };
        store.set('projects', projects);
        return { success: true, project: projects[idx] };
    }
    
    return { success: false, error: 'Project not found' };
});

// ========================================
// IPC HANDLERS - File System
// ========================================

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths[0]) {
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
});

ipcMain.handle('read-directory', async (event, dirPath) => {
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return {
            success: true,
            entries: entries.map(e => ({
                name: e.name,
                isDirectory: e.isDirectory(),
                path: path.join(dirPath, e.name)
            }))
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('open-in-explorer', (event, filePath) => {
    shell.showItemInFolder(filePath);
});

// ========================================
// APP LIFECYCLE
// ========================================

app.whenReady().then(async () => {
    createMenu();
    createMainWindow();

    // Auto-start node if configured
    if (store.get('autoStartNode')) {
        try {
            await runGrabCommand(['node', 'start']);
        } catch (e) {
            console.log('Node may already be running:', e.message);
        }
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async () => {
    // Cleanup gateway process if running
    if (gatewayProcess) {
        gatewayProcess.kill();
    }
});
