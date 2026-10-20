// One-launch consent for the desktop memory-store fallback.
//
// The launcher must never decide on its own to run the API without Redis:
// storage guards treat in-memory mode as an explicit degraded choice. When the
// user picks "use temporary memory for this launch" in the startup failure
// dialog, the consent is written here and consumed exactly once by the next
// ServiceManager startup. The file is deleted on read, so the next ordinary
// launch fails closed again.
const fs = require('node:fs');
const path = require('node:path');

const CONSENT_FILE = 'startup-memory-fallback.once';

function consentPath(userDataRoot) {
  return path.join(userDataRoot, CONSENT_FILE);
}

function requestMemoryFallbackOnce(userDataRoot) {
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(
    consentPath(userDataRoot),
    `${JSON.stringify({ scope: 'single-launch', requestedAt: new Date().toISOString() })}\n`,
  );
}

/** Returns true only when a valid one-launch consent existed; always removes it. */
function consumeMemoryFallbackConsent(userDataRoot) {
  let raw;
  try {
    raw = fs.readFileSync(consentPath(userDataRoot), 'utf8');
  } catch {
    return false;
  }
  try {
    fs.rmSync(consentPath(userDataRoot), { force: true });
  } catch {}
  try {
    return JSON.parse(raw)?.scope === 'single-launch';
  } catch {
    return false;
  }
}

module.exports = { requestMemoryFallbackOnce, consumeMemoryFallbackConsent, consentPath, CONSENT_FILE };
