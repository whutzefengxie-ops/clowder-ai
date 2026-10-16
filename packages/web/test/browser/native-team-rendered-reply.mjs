export async function waitForRenderedReply(page, messageId, marker, { timeout = 20000 } = {}) {
  if (!/^[\w-]+$/.test(messageId)) throw new Error('Invalid persisted message identity');
  const reply = page.locator(`[data-message-id="${messageId}"]`).first();
  await reply.getByText(marker, { exact: false }).first().waitFor({ state: 'visible', timeout });
}
