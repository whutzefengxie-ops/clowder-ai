import type { CatData } from '@/hooks/useCatData';
import { autoSlug, type HubCatEditorFormState } from '../hub-cat-editor.model';
import { matchesRuntime, type RuntimeChoice } from '../settings/members/member-runtime-draft';
import type { NativePartner } from './native-onboarding';

/** Roles decorate a recommendation, never the ordinary tool catalog. */
export function nativeRuntimeRecommendations(runtimes: RuntimeChoice[]): RuntimeChoice[] {
  return runtimes.flatMap((runtime) => {
    if (runtime.kind === 'binding') return [];
    return runtime.roleTemplates?.length
      ? runtime.roleTemplates.map((role) => ({ ...runtime, roleTemplateId: role.id, priority: role.priority }))
      : [runtime];
  });
}

export function preferredNativeBinding(
  candidate: RuntimeChoice,
  runtimes: RuntimeChoice[],
  cats: CatData[],
  form: HubCatEditorFormState,
): RuntimeChoice | undefined {
  if (!candidate.harnessId) return undefined;
  const roleId =
    candidate.roleTemplateId && candidate.harnessId === 'codeagent'
      ? `codeagent-${candidate.roleTemplateId}`
      : autoSlug(candidate.label);
  return runtimes.find(
    (binding) =>
      binding.kind === 'binding' &&
      binding.harnessId === candidate.harnessId &&
      binding.acp &&
      cats.some(
        (cat) =>
          cat.id === binding.sourceCatId &&
          cat.configurationSource === 'native_tool' &&
          (cat.nickname === form.nickname || cat.id === roleId),
      ),
  );
}

export function restoredNativeLead(partners: NativePartner[], previous: NativePartner[] = [], lead?: string): string {
  const exact = partners.find((partner) => partner.id === lead);
  if (exact) return exact.id;
  const old = previous.find((partner) => partner.id === lead);
  return (
    partners.find(
      (partner) =>
        old?.form &&
        old.runtime.roleTemplateId === partner.runtime.roleTemplateId &&
        matchesRuntime(old.form, partner.runtime),
    )?.id ??
    partners.find((partner) => partner.selected)?.id ??
    ''
  );
}
