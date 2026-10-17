/**
 * Decide how a second launch should recover the visible desktop surface.
 * This pure decision keeps startup/splash/ready behavior testable without
 * importing Electron. It never starts a second service owner.
 */
function resolveWindowRecoveryAction({ phase, hasMainWindow, hasSplashWindow, isQuitting }) {
  if (isQuitting || phase === 'quitting') return 'ignore';
  if (hasMainWindow) return 'focus-main';
  if (phase !== 'ready') return hasSplashWindow ? 'show-splash' : 'ignore';
  return 'recreate-main';
}

module.exports = { resolveWindowRecoveryAction };
