/** Host deployment opt-in; never derived from an agent or plugin's environment. */
export function isTrustedHostCompatibilityEnabled(): boolean {
  const mode = process.env.CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE;
  if (mode !== undefined) {
    if (mode !== 'strict' && mode !== 'trusted-host')
      throw new Error('CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE must be strict or trusted-host');
    return mode === 'trusted-host';
  }
  return process.env.CAT_CAFE_TRUSTED_HOST_COMPATIBILITY === '1';
}
