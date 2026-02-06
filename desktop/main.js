/**
 * Rooted Revival OS - Electron Main Process
 * 
 * Cross-platform desktop application integrating:
 * - Rooted Revival sustainability platform
 * - OpenSource Scholar open access academia
 * - Built-in IPFS node for decentralized content hosting
 */

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Persistent storage for user settings
const store = new Store({
    defaults: {
        ipfsEnabled: true,
        ipfsAutoStart: true,
        theme: 'dark',
        windowBounds: { width: 1400, height: 900 }
    }
});

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let ipfsNode = null;
let scholarServer = null;

// ========================================
// WINDOW MANAGEMENT
// ========================================

function createMainWindow() {
    const bounds = store.get('windowBounds');
    
    mainWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: '#000000',
        titleBarStyle: 'hiddenInset',
        frame: process.platform !== 'darwin',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'build', 'icon.png')
    });

    // Load the launcher
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));

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

// ========================================
// IPFS NODE MANAGEMENT
// ========================================

async function startIPFSNode() {
    if (ipfsNode) return ipfsNode;
    
    try {
        const IPFS = require('ipfs-core');
        
        ipfsNode = await IPFS.create({
            repo: path.join(app.getPath('userData'), 'ipfs-repo'),
            config: {
                Addresses: {
                    Swarm: [
                        '/ip4/0.0.0.0/tcp/4002',
                        '/ip4/0.0.0.0/tcp/4003/ws'
                    ],
                    API: '/ip4/127.0.0.1/tcp/5002',
                    Gateway: '/ip4/127.0.0.1/tcp/8081'
                },
                Bootstrap: [
                    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
                    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
                ]
            }
        });

        const nodeId = await ipfsNode.id();
        console.log('IPFS node started:', nodeId.id);
        
        return ipfsNode;
    } catch (error) {
        console.error('Failed to start IPFS node:', error);
        return null;
    }
}

async function stopIPFSNode() {
    if (ipfsNode) {
        await ipfsNode.stop();
        ipfsNode = null;
        console.log('IPFS node stopped');
    }
}

// ========================================
// OPEN SCHOLAR SERVER
// ========================================

async function startScholarServer() {
    if (scholarServer) return scholarServer;
    
    try {
        const express = require('express');
        const scholarApp = express();
        
        // Serve the scholar app
        scholarApp.use(express.static(path.join(__dirname, '..', 'server', 'public')));
        
        // TODO: Integrate actual scholar routes
        scholarApp.get('/api/health', (req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });
        
        scholarServer = scholarApp.listen(3847, () => {
            console.log('OpenSource Scholar running on http://localhost:3847');
        });
        
        return scholarServer;
    } catch (error) {
        console.error('Failed to start Scholar server:', error);
        return null;
    }
}

// ========================================
// IPC HANDLERS
// ========================================

ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData')
}));

ipcMain.handle('get-ipfs-status', async () => {
    if (!ipfsNode) {
        return { running: false };
    }
    
    try {
        const id = await ipfsNode.id();
        const peers = await ipfsNode.swarm.peers();
        const stats = await ipfsNode.stats.repo();
        
        return {
            running: true,
            peerId: id.id,
            peerCount: peers.length,
            repoSize: stats.repoSize.toString()
        };
    } catch {
        return { running: false };
    }
});

ipcMain.handle('start-ipfs', async () => {
    const node = await startIPFSNode();
    return { success: !!node };
});

ipcMain.handle('stop-ipfs', async () => {
    await stopIPFSNode();
    return { success: true };
});

ipcMain.handle('ipfs-add', async (event, content) => {
    if (!ipfsNode) throw new Error('IPFS node not running');
    const result = await ipfsNode.add(content);
    return { cid: result.cid.toString() };
});

ipcMain.handle('ipfs-pin', async (event, cid) => {
    if (!ipfsNode) throw new Error('IPFS node not running');
    await ipfsNode.pin.add(cid);
    return { success: true };
});

ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('navigate-to', (event, route) => {
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, 'renderer', route));
    }
});

ipcMain.handle('load-scholar', async () => {
    await startScholarServer();
    if (mainWindow) {
        mainWindow.loadURL('http://localhost:3847');
    }
});

ipcMain.handle('load-revival', () => {
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'revival.html'));
    }
});

ipcMain.handle('load-grabnet', () => {
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, '..', 'grabnet-gui', 'renderer', 'index.html'));
    }
});

ipcMain.handle('load-launcher', () => {
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
    }
});

ipcMain.handle('get-settings', () => {
    return store.store;
});

ipcMain.handle('set-setting', (event, key, value) => {
    store.set(key, value);
    return { success: true };
});

// ========================================
// APP LIFECYCLE
// ========================================

app.whenReady().then(async () => {
    createMainWindow();
    
    // Auto-start IPFS if enabled
    if (store.get('ipfsAutoStart')) {
        await startIPFSNode();
    }
    
    // Create tray icon
    createTray();
    
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
    await stopIPFSNode();
    if (scholarServer) {
        scholarServer.close();
    }
});

// ========================================
// SYSTEM TRAY
// ========================================

function createTray() {
    // Tray icon will show IPFS status
    const iconPath = path.join(__dirname, 'build', 'tray-icon.png');
    
    try {
        tray = new Tray(nativeImage.createFromPath(iconPath));
        
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Open Rooted Revival OS', click: () => mainWindow?.show() },
            { type: 'separator' },
            { label: 'IPFS Status', enabled: false },
            { label: 'Start IPFS', click: () => startIPFSNode() },
            { label: 'Stop IPFS', click: () => stopIPFSNode() },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() }
        ]);
        
        tray.setToolTip('Rooted Revival OS');
        tray.setContextMenu(contextMenu);
    } catch (error) {
        console.log('Tray creation skipped (icon not found)');
    }
}

// ========================================
// MENU
// ========================================

const menuTemplate = [
    {
        label: 'Rooted Revival',
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', click: () => {
                mainWindow?.webContents.send('open-settings');
            }},
            { type: 'separator' },
            { role: 'quit' }
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
        label: 'Navigate',
        submenu: [
            { label: 'Launcher', accelerator: 'CmdOrCtrl+1', click: () => {
                mainWindow?.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
            }},
            { label: 'Rooted Revival', accelerator: 'CmdOrCtrl+2', click: () => {
                mainWindow?.loadFile(path.join(__dirname, 'renderer', 'revival.html'));
            }},
            { label: 'OpenSource Scholar', accelerator: 'CmdOrCtrl+3', click: async () => {
                await startScholarServer();
                mainWindow?.loadURL('http://localhost:3847');
            }},
            { type: 'separator' },
            { role: 'back' },
            { role: 'forward' }
        ]
    },
    {
        label: 'IPFS',
        submenu: [
            { label: 'Start Node', click: () => startIPFSNode() },
            { label: 'Stop Node', click: () => stopIPFSNode() },
            { type: 'separator' },
            { label: 'View Pinned Content', click: () => {
                mainWindow?.webContents.send('view-pins');
            }}
        ]
    }
];

app.whenReady().then(() => {
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
});
