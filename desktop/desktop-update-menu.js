// Desktop tray and application-menu wiring for updater entry points.

function presentWindow(window) {
  if (!window || window.isDestroyed?.()) return;
  if (window.isMinimized?.()) window.restore();
  window.show();
  window.focus?.();
}

function createManualUpdateHandler({ getUpdatePrompt, getUpdater }) {
  return () => {
    if (getUpdatePrompt()?.presentPending()) return 'presented';
    void getUpdater()?.checkForUpdates({ manual: true });
    return 'started';
  };
}

function showAboutDialog({ app, dialog, onManualUpdate }) {
  const version = app.getVersion();
  void dialog
    .showMessageBox({
      type: 'info',
      buttons: ['Check for Updates', 'OK'],
      defaultId: 1,
      cancelId: 1,
      title: 'About Clowder AI',
      message: `Clowder AI v${version}`,
      detail: [
        'Multi-Agent Collaboration Platform',
        '',
        `Version: ${version}`,
        `Electron: ${process.versions.electron}`,
        `Node: ${process.versions.node}`,
        '',
        'License: AGPL-3.0',
        'https://github.com/zts212653/clowder-ai',
      ].join('\n'),
    })
    .then((result) => {
      if (result.response === 0) onManualUpdate();
    });
}

function serializeTrayError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack,
  };
}

function createDesktopTray({ Menu, Tray, iconPath, getMainWindow, onManualUpdate, onQuit, showAbout }) {
  let tray = null;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('Clowder AI');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Clowder AI', click: () => presentWindow(getMainWindow()) },
        { type: 'separator' },
        { label: 'About', click: showAbout },
        { label: 'Check for Updates', click: onManualUpdate },
        { type: 'separator' },
        { label: 'Quit', click: onQuit },
      ]),
    );
    tray.on('double-click', () => presentWindow(getMainWindow()));
    return { status: 'created', tray, error: null };
  } catch (error) {
    try {
      tray?.destroy?.();
    } catch {}
    return { status: 'failed', tray: null, error: serializeTrayError(error) };
  }
}

function installMacApplicationMenu({ app, Menu, onManualUpdate, showAbout }) {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { label: 'About Clowder AI', click: showAbout },
          { label: 'Check for Updates…', click: onManualUpdate },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]),
  );
}

module.exports = {
  createDesktopTray,
  createManualUpdateHandler,
  installMacApplicationMenu,
  showAboutDialog,
};
