/** Host deployment opt-in; never derived from an agent or plugin's environment. */
export function isTrustedHostCompatibilityEnabled(): boolean {
  return process.env.CAT_CAFE_TRUSTED_HOST_COMPATIBILITY === '1';
}
