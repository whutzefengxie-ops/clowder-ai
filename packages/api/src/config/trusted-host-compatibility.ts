import { getAcpHostPolicy } from './acp-host-policy.js';

/** Host deployment opt-in; never derived from an agent or plugin's environment. */
export function isTrustedHostCompatibilityEnabled(): boolean {
  return getAcpHostPolicy().bootstrapMode === 'trusted-host';
}
