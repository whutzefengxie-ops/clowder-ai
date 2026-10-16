import assert from 'node:assert/strict';

export function observePageFaults(page, record) {
  record.consoleErrors ??= [];
  record.networkErrors ??= [];
  const requestPath = (request) => new URL(request.url()).pathname;
  page.on('console', (message) => {
    if (message.type() === 'error') record.consoleErrors.push(message.text().slice(0, 400));
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      record.networkErrors.push({
        method: response.request().method(),
        path: requestPath(response.request()),
        status: response.status(),
      });
  });
  page.on('requestfailed', (request) => {
    record.networkErrors.push({
      method: request.method(),
      path: requestPath(request),
      failure: request.failure()?.errorText,
    });
  });
  page.on('pageerror', (error) => record.pageErrors.push(error.message));
  page.on('dialog', (dialog) => {
    const fault = { type: dialog.type(), message: dialog.message().slice(0, 400) };
    record.dialogs.push(fault);
    // Release the test runner, but the unexpected dialog still fails acceptance.
    void dialog.dismiss().catch((error) => {
      fault.dismissError = error.message;
    });
  });
}

export function assertLivePageHealthy(record) {
  for (const field of ['pageErrors', 'dialogs', 'consoleErrors', 'networkErrors']) {
    assert.ok(Array.isArray(record[field]), `Missing live observer: ${field}`);
    assert.deepEqual(record[field], [], `Unexpected renderer faults: ${field}`);
  }
}
