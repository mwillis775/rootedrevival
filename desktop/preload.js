/**
 * Rooted Revival OS - Preload Script
 * 
 * Exposes safe IPC methods to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer
contextBridge.exposeInMainWorld('rootedAPI', {
    // App info
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    
    // Navigation
    navigateTo: (route) => ipcRenderer.invoke('navigate-to', route),
    loadScholar: () => ipcRenderer.invoke('load-scholar'),
    loadRevival: () => ipcRenderer.invoke('load-revival'),
    loadGrabNet: () => ipcRenderer.invoke('load-grabnet'),
    loadLauncher: () => ipcRenderer.invoke('load-launcher'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    
    // IPFS
    getIPFSStatus: () => ipcRenderer.invoke('get-ipfs-status'),
    startIPFS: () => ipcRenderer.invoke('start-ipfs'),
    stopIPFS: () => ipcRenderer.invoke('stop-ipfs'),
    ipfsAdd: (content) => ipcRenderer.invoke('ipfs-add', content),
    ipfsPin: (cid) => ipcRenderer.invoke('ipfs-pin', cid),
    
    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    
    // Events
    onSettingsOpen: (callback) => {
        ipcRenderer.on('open-settings', callback);
    },
    onViewPins: (callback) => {
        ipcRenderer.on('view-pins', callback);
    }
});

// Expose platform info
contextBridge.exposeInMainWorld('platform', {
    isElectron: true,
    os: process.platform,
    arch: process.arch
});
