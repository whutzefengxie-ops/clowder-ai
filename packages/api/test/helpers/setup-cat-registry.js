/**
 * F32-a: Auto-populate catRegistry on import.
 *
 * Import this module at the top of any test file that uses route schemas
 * or other code depending on catRegistry being populated.
 *
 * Usage: import './helpers/setup-cat-registry.js';
 */

import { CAT_CONFIGS, catRegistry } from '@cat-cafe/shared';

for (const [id, config] of Object.entries(CAT_CONFIGS)) {
  if (!catRegistry.has(id)) {
    catRegistry.register(id, config);
  }
}
