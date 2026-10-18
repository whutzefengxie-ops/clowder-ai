// Decide what a window close request means before touching Electron state.

function decideWindowClose({ platform, isQuitting, trayAvailable }) {
  if (platform !== 'win32') return { action: 'allow', reason: 'non-windows' };
  if (isQuitting) return { action: 'allow', reason: 'quit-requested' };
  if (trayAvailable) return { action: 'hide', reason: 'manual-close' };
  return { action: 'keep-visible', reason: 'tray-unavailable' };
}

module.exports = { decideWindowClose };
