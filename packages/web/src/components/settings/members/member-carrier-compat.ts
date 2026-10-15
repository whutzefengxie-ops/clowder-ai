import { getCatCarrierOptions } from '@cat-cafe/shared';
import type { HubCatEditorFormState } from '../../hub-cat-editor.model';

type LegacyCarrierFields = Pick<HubCatEditorFormState, 'clientId' | 'configurationSource'> & {
  carrier?: HubCatEditorFormState['carrier'];
  acpEnabled?: boolean;
  codexCarrier?: '' | 'exec_json' | 'app_server';
};

/** Read-only compatibility for drafts saved before main introduced canonical carrier. */
export function resolveDraftCarrier(form: LegacyCarrierFields): HubCatEditorFormState['carrier'] {
  if (form.carrier) return form.carrier;
  if (form.acpEnabled || form.clientId === 'acp') return 'acp';
  if (form.clientId === 'openai') {
    if (form.codexCarrier) return form.codexCarrier === 'app_server' ? 'app_server' : 'cli';
    if (form.configurationSource === 'native_tool') return 'app_server';
  }
  return getCatCarrierOptions(form.clientId)[0] ?? 'cli';
}

export function normalizeMemberDraftForm(form: HubCatEditorFormState): HubCatEditorFormState {
  const {
    acpEnabled: _acpEnabled,
    codexCarrier: _codexCarrier,
    ...canonical
  } = form as HubCatEditorFormState & LegacyCarrierFields;
  return { ...canonical, carrier: resolveDraftCarrier(form) };
}
