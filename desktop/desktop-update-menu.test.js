const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { createDesktopTray, createManualUpdateHandler } = require('./desktop-update-menu');

describe('desktop manual update entry point', () => {
  test('re-presents an existing prompt instead of queuing another check behind it', () => {
    let checks = 0;
    let hasPending = true;
    const onManualUpdate = createManualUpdateHandler({
      getUpdatePrompt: () => ({
        presentPending: () => hasPending,
      }),
      getUpdater: () => ({
        checkForUpdates: () => {
          checks += 1;
        },
      }),
    });

    assert.equal(onManualUpdate(), 'presented');
    assert.equal(checks, 0);

    hasPending = false;
    assert.equal(onManualUpdate(), 'started');
    assert.equal(checks, 1);
  });
});

function createMenu() {
  return { buildFromTemplate: (template) => ({ template }) };
}

test('tray creation returns a diagnosable success result', () => {
  const handlers = [];
  const result = createDesktopTray({
    Menu: createMenu(),
    Tray: class {
      setToolTip() {}
      setContextMenu() {}
      on(event, handler) {
        handlers.push([event, handler]);
      }
    },
    iconPath: 'icon.ico',
    getMainWindow: () => null,
    onManualUpdate: () => {},
    onQuit: () => {},
    showAbout: () => {},
  });

  assert.equal(result.status, 'created');
  assert.ok(result.tray);
  assert.deepEqual(
    handlers.map(([event]) => event),
    ['double-click'],
  );
});

test('tray creation returns the native error instead of silently degrading', () => {
  const result = createDesktopTray({
    Menu: createMenu(),
    Tray: class {
      constructor() {
        throw new Error('icon unavailable');
      }
    },
    iconPath: 'missing.ico',
    getMainWindow: () => null,
    onManualUpdate: () => {},
    onQuit: () => {},
    showAbout: () => {},
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.tray, null);
  assert.equal(result.error.message, 'icon unavailable');
  assert.equal(result.error.name, 'Error');
});
