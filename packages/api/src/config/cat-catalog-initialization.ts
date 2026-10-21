/** New installs enroll members only after the owner confirms a selection. */
export const USER_SELECTED_INITIALIZATION = 'user_selected_v1';

/** Absence is a legacy install, never evidence of a first run or permission to rewrite it. */
export function isUserSelectedCatalog(catalog: unknown): boolean {
  return (
    catalog !== null &&
    typeof catalog === 'object' &&
    'memberInitialization' in catalog &&
    catalog.memberInitialization === USER_SELECTED_INITIALIZATION
  );
}
