import assert from 'node:assert/strict';

export async function observePageFaults(page, record) {
  record.consoleErrors ??= [];
  record.networkErrors ??= [];
  record.documentTransitions ??= [];
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
  const session = await page.context().newCDPSession(page);
  const requests = new Map();
  const documents = new Map();
  const visit = (tree) => {
    documents.set(tree.frame.id, tree.frame.loaderId);
    for (const child of tree.childFrames ?? []) visit(child);
  };
  await session.send('Page.enable');
  visit((await session.send('Page.getFrameTree')).frameTree);
  session.on('Page.frameNavigated', ({ frame }) => {
    record.documentTransitions.push({ frameId: frame.id, previous: documents.get(frame.id), current: frame.loaderId });
    documents.set(frame.id, frame.loaderId);
  });
  session.on('Page.frameDetached', ({ frameId }) => {
    record.documentTransitions.push({ frameId, previous: documents.get(frameId), current: null });
    documents.delete(frameId);
  });
  session.on('Network.requestWillBeSent', (event) => {
    requests.set(event.requestId, {
      method: event.request.method,
      path: new URL(event.request.url).pathname,
      document: event.loaderId,
      frameId: event.frameId,
    });
  });
  session.on('Network.loadingFinished', ({ requestId }) => requests.delete(requestId));
  session.on('Network.loadingFailed', (event) => {
    record.networkErrors.push({
      ...requests.get(event.requestId),
      failure: event.errorText,
      canceled: event.canceled === true,
    });
    requests.delete(event.requestId);
  });
  await session.send('Network.enable');
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
  const retired = new Set(record.documentTransitions?.map((transition) => transition.previous).filter(Boolean));
  record.expectedDocumentCancellations = [];
  record.unexpectedNetworkErrors = [];
  for (const error of record.networkErrors ?? []) {
    // Keep every raw failure. Only the browser's exact canceled request from a
    // retired document is expected; HTTP/current/unidentified failures still fail.
    const navigation =
      error.canceled && error.failure === 'net::ERR_ABORTED' && error.document && retired.has(error.document);
    (navigation ? record.expectedDocumentCancellations : record.unexpectedNetworkErrors).push(error);
  }
  for (const field of ['pageErrors', 'dialogs', 'consoleErrors', 'networkErrors', 'documentTransitions']) {
    assert.ok(Array.isArray(record[field]), `Missing live observer: ${field}`);
  }
  for (const field of ['pageErrors', 'dialogs', 'consoleErrors', 'unexpectedNetworkErrors'])
    assert.deepEqual(record[field], [], `Unexpected renderer faults: ${field}`);
}
