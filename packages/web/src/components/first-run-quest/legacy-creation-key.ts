import type { CatData } from '@/hooks/useCatData';
import { initialState } from '../hub-cat-editor.model';
import { matchesRuntime } from '../settings/members/member-runtime-draft';
import type { NativePartner } from './native-onboarding';

/** Select a pending legacy key without treating roster similarity as a creation receipt. */
export function legacyCreationKey(
  previous: NativePartner,
  recommended: NativePartner,
  savedPartners: NativePartner[],
  cats: CatData[],
): string | undefined {
  const shared = legacySharedKey(previous, savedPartners);
  if (!shared) return previous.creationRequestKey ?? previous.id;
  if (previous.creationRequestKey && previous.creationRequestKey !== shared) return previous.creationRequestKey;
  const siblings = savedPartners.filter((p) => legacySharedKey(p, savedPartners) === shared);
  // A lost response leaves the committed descriptor in the authoritative roster.
  // Preserve its old key/body: the subsequent POST still has to prove request ownership.
  // Other descriptors receive independent keys before POST, irrespective of probe order.
  const committed = siblings.filter((p) =>
    cats.some((cat) => cat.id === p.form.catId && matchesRuntime(initialState(cat), p.runtime)),
  );
  if (committed.length === 1 && committed[0] !== previous) return recommended.creationRequestKey;
  // With no unambiguous committed descriptor, keep the pending identity; never guess
  // ownership or change a key just because a network request failed.
  return shared;
}

export function legacySharedKey(previous: NativePartner, partners: NativePartner[]): string | undefined {
  if (previous.legacySharedRequestKey) return previous.legacySharedRequestKey;
  if (previous.creationRequestKey) return undefined;
  return partners.filter((p) => !p.creationRequestKey && p.id === previous.id).length > 1 ? previous.id : undefined;
}
