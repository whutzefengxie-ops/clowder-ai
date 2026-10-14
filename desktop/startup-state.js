const fs = require('node:fs');
const path = require('node:path');

/** Written before UI prompts so supervisors can observe failure without inspecting native dialogs. */
function createStartupReporter(logDir) {
  const startedAt = Date.now();
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, 'startup-state.json');
  return (phase, message) => {
    const state = {
      version: 1,
      pid: process.pid,
      phase,
      startedAt,
      updatedAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      ...(message ? { message } : {}),
    };
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, file);
    return state;
  };
}
module.exports = { createStartupReporter };
