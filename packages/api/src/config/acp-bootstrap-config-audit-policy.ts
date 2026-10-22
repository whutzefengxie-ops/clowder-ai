import { isTrustedHostCompatibilityEnabled } from './trusted-host-compatibility.js';

/** Only a Host deployment setting can opt into the narrow, root-only exception. */
export function allowsAcpBootstrapConfigAuditWarning(): boolean {
  const mode = process.env.CAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE ?? 'required';
  if (mode !== 'required' && mode !== 'warn-bootstrap-root')
    throw new Error('CAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE must be required or warn-bootstrap-root');
  return process.platform === 'win32' && mode === 'warn-bootstrap-root' && isTrustedHostCompatibilityEnabled();
}
