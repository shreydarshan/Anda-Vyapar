/**
 * preload.js - Anda Vyapar
 * Secure bridge between Electron main process (Node.js) and renderer (HTML)
 * Exposes only safe, specific APIs via contextBridge.
 * Never exposes ipcRenderer, fs, child_process, or Node.js directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Public runtime config (Supabase URL + publishable key only)
  getConfig: () => ipcRenderer.invoke('av-config'),

  // Load all data from hard drive (account-scoped: 'guest' or a user id)
  loadData:   (accountKey) => ipcRenderer.invoke('av-load', accountKey),

  // Save all data to hard drive (called automatically on every change)
  saveData:   (data, accountKey) => ipcRenderer.invoke('av-save', data, accountKey),

  // Get the data folder path (shown in Settings)
  getFolder:  (accountKey) => ipcRenderer.invoke('av-folder', accountKey),

  // Open data folder in Windows Explorer
  openFolder: (accountKey) => ipcRenderer.invoke('av-open-folder', accountKey),

  // Export backup using native Save dialog
  exportJSON: (data)   => ipcRenderer.invoke('av-export', data),

  // Import backup using native Open dialog
  importJSON: ()       => ipcRenderer.invoke('av-import'),

  // List installed printers (for the Printer settings dropdown)
  getPrinters: ()      => ipcRenderer.invoke('av-get-printers'),

  // Print a receipt natively via the selected thermal printer, or via
  // the OS print dialog if showDialog is true.
  printReceipt: (html, printerName, showDialog) => ipcRenderer.invoke('av-print-receipt', html, printerName, showDialog),

  // Flag so index.html knows it's running in Electron
  isElectron: true,

  // Flush-before-close (spec section 2 fix): main.js delays the actual
  // window close and asks the renderer to flush any debounced pending
  // save first, so "close app right after an action" can never lose
  // that action (e.g. Reset Everything) the way the previous 400ms
  // fire-and-forget debounce could. onFlushRequest's callback must
  // call ackFlushDone() when done (or immediately, if nothing was
  // pending) so main.js knows it's safe to actually close.
  onFlushRequest: (cb) => ipcRenderer.on('av-flush-before-close', cb),
  ackFlushDone:   () => ipcRenderer.send('av-flush-done')
});
