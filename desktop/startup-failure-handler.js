const { safeErrorMessage } = require('./update-network-diagnostics');

/** Share the visible startup failure path between first launch and window recovery. */
function createStartupFailureHandler({ isQuitting, setPhase, dbg, reportStartup, sendSplashStatus, stopServices, showFailure, quitApp }) {
  return async (error) => {
    if (isQuitting()) return;
    const message = safeErrorMessage(error);
    setPhase('failed');
    dbg(`Desktop startup FAILED: ${message}`);
    reportStartup('failed', message);
    sendSplashStatus('Startup failed: 请查看启动错误与日志');
    await stopServices();
    await showFailure(message);
    await quitApp();
  };
}

module.exports = { createStartupFailureHandler };
