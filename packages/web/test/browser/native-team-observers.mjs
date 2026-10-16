export function observePageFaults(page, record) {
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
