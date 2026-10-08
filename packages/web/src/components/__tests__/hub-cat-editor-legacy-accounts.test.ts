import { describe, expect, it } from 'vitest';
import type { ProfileItem } from '../hub-accounts.types';
import { filterAccounts } from '../hub-cat-editor.model';

function legacyAccount(family: string): ProfileItem {
  const id = `${family}-subscription-default`;
  return {
    id,
    name: id,
    displayName: id,
    authType: 'oauth',
    mode: 'subscription',
    kind: 'builtin',
    builtin: true,
    hasApiKey: false,
    createdAt: '',
    updatedAt: '',
  };
}

describe('legacy default authentication accounts', () => {
  it.each(['anthropic', 'openai', 'google'] as const)('shows the %s default account without clientId', (client) => {
    const account = legacyAccount(client);
    expect(filterAccounts(client, [account])).toEqual([account]);
  });

  it('shows the Anthropic default for CatAgent', () => {
    const account = legacyAccount('anthropic');
    expect(filterAccounts('catagent', [account])).toEqual([account]);
  });

  it('keeps explicit client identity authoritative', () => {
    const account = { ...legacyAccount('anthropic'), clientId: 'openai' as const };
    expect(filterAccounts('anthropic', [account])).toEqual([]);
    expect(filterAccounts('openai', [account])).toEqual([account]);
  });

  it('does not offer another family default or an unknown OAuth account', () => {
    expect(filterAccounts('openai', [legacyAccount('anthropic'), legacyAccount('unknown')])).toEqual([]);
  });
});
