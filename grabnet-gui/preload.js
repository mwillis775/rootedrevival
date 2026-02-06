/**
 * GrabNet Desktop - Preload Script
 * 
 * Exposes safe APIs to the renderer process via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grabAPI', {
    // App info
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),

    // GrabNet binary
    checkBinary: () => ipcRenderer.invoke('grab-check-binary'),

    // Node management
    nodeStatus: () => ipcRenderer.invoke('grab-node-status'),
    nodeStart: () => ipcRenderer.invoke('grab-node-start'),
    nodeStop: () => ipcRenderer.invoke('grab-node-stop'),

    // Publishing
    publish: (options) => ipcRenderer.invoke('grab-publish', options),
    list: () => ipcRenderer.invoke('grab-list'),
    info: (siteId) => ipcRenderer.invoke('grab-info', siteId),

    // Hosting
    pin: (siteId, peerAddress) => ipcRenderer.invoke('grab-pin', siteId, peerAddress),
    unhost: (siteId) => ipcRenderer.invoke('grab-unhost', siteId),

    // Gateway
    gatewayStart: (port, defaultSite) => ipcRenderer.invoke('grab-gateway-start', port, defaultSite),

    // Stats & Keys
    stats: () => ipcRenderer.invoke('grab-stats'),
    keysList: () => ipcRenderer.invoke('grab-keys-list'),
    keysGenerate: (name) => ipcRenderer.invoke('grab-keys-generate', name),

    // Project management
    getProjects: () => ipcRenderer.invoke('get-projects'),
    addProject: (project) => ipcRenderer.invoke('add-project', project),
    removeProject: (projectId) => ipcRenderer.invoke('remove-project', projectId),
    updateProject: (projectId, updates) => ipcRenderer.invoke('update-project', projectId, updates),

    // File system
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    openInExplorer: (path) => ipcRenderer.invoke('open-in-explorer', path),

    // Events from main
    onNavigate: (callback) => {
        ipcRenderer.on('navigate', (event, route) => callback(route));
    },
    onAction: (callback) => {
        ipcRenderer.on('action', (event, action) => callback(action));
    },
    onOpenProject: (callback) => {
        ipcRenderer.on('open-project', (event, path) => callback(path));
    }
});
