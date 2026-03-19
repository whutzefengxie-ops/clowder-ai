import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { CatCafeConfig, Roster } from '@cat-cafe/shared';
import { builtinAccountIdForClient, readBootstrapBindingsSync } from './provider-profiles.js';
import type { BootstrapBinding, BuiltinAccountClient } from './provider-profiles.types.js';

const CAT_CAFE_DIR = '.cat-cafe';
const CAT_CATALOG_FILENAME = 'cat-catalog.json';

function safePath(projectRoot: string, ...segments: string[]): string {
  const root = resolve(projectRoot);
  const normalized = resolve(root, ...segments);
  const rel = relative(root, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

function isWithinProjectRoot(projectRoot: string, candidatePath: string): boolean {
  const rel = relative(resolve(projectRoot), resolve(candidatePath));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

function resolveTemplatePath(projectRoot: string): string {
  const envPath = process.env.CAT_TEMPLATE_PATH?.trim();
  if (envPath) {
    const resolvedEnvPath = resolve(envPath);
    if (isWithinProjectRoot(projectRoot, resolvedEnvPath)) return resolvedEnvPath;
  }
  return resolve(projectRoot, 'cat-template.json');
}

function providerToBootstrapClient(provider: unknown): BuiltinAccountClient | null {
  switch (provider) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'google':
      return 'google';
    case 'dare':
      return 'dare';
    case 'opencode':
      return 'opencode';
    default:
      return null;
  }
}

function trimBinding(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveExplicitVariantAccountRef(variant: Record<string, unknown>): string | null {
  return trimBinding(variant.providerProfileId) ?? trimBinding(variant.accountRef);
}

function cloneWithAccountRef(
  variant: Record<string, unknown>,
  accountRef: string,
  options?: { explicit?: boolean },
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...variant, accountRef };
  if (options?.explicit) {
    next.providerProfileId = accountRef;
  } else {
    delete (next as { providerProfileId?: unknown }).providerProfileId;
  }
  return next;
}

function resolveSelectedVariants(
  breed: Record<string, unknown>,
  binding: BootstrapBinding | undefined,
): Record<string, unknown>[] {
  if (!binding || binding.mode === 'skip' || binding.enabled === false) return [];
  const variants = Array.isArray(breed.variants) ? (breed.variants as Record<string, unknown>[]) : [];
  const defaultVariantId = typeof breed.defaultVariantId === 'string' ? breed.defaultVariantId : undefined;
  const accountRef = binding.accountRef?.trim();
  if (!accountRef) return [];

  if (binding.mode === 'api_key') {
    const selected =
      variants.find((variant) => variant.id === defaultVariantId) ??
      variants.find((variant) => providerToBootstrapClient(variant.provider) != null);
    if (!selected) return [];
    const explicitAccountRef = resolveExplicitVariantAccountRef(selected);
    return [
      cloneWithAccountRef(selected, explicitAccountRef ?? accountRef, {
        explicit: explicitAccountRef != null,
      }),
    ];
  }

  return variants.map((variant) => {
    const explicitAccountRef = resolveExplicitVariantAccountRef(variant);
    return cloneWithAccountRef(variant, explicitAccountRef ?? accountRef, {
      explicit: explicitAccountRef != null,
    });
  });
}

function fallbackAccountRefForClient(client: BuiltinAccountClient, binding: BootstrapBinding | undefined): string {
  return binding?.accountRef?.trim() || builtinAccountIdForClient(client);
}

function readSeedMetadata(projectRoot: string): {
  explicitSeedAccountRefs: Map<string, string>;
  seedCatIdsByClient: Map<BuiltinAccountClient, Set<string>>;
} {
  const explicitSeedAccountRefs = new Map<string, string>();
  const seedCatIdsByClient = new Map<BuiltinAccountClient, Set<string>>();

  try {
    const template = JSON.parse(readFileSync(resolveTemplatePath(projectRoot), 'utf-8')) as CatCafeConfig;
    for (const breed of template.breeds as unknown as Record<string, unknown>[]) {
      const variants = Array.isArray(breed.variants) ? (breed.variants as Record<string, unknown>[]) : [];
      for (const variant of variants) {
        const client = providerToBootstrapClient(variant.provider);
        if (!client) continue;
        const catId = typeof variant.catId === 'string' ? variant.catId : typeof breed.catId === 'string' ? breed.catId : null;
        if (!catId) continue;
        const clientSeedCatIds = seedCatIdsByClient.get(client) ?? new Set<string>();
        clientSeedCatIds.add(catId);
        seedCatIdsByClient.set(client, clientSeedCatIds);

        const explicitAccountRef = resolveExplicitVariantAccountRef(variant);
        if (explicitAccountRef) explicitSeedAccountRefs.set(catId, explicitAccountRef);
      }
    }
  } catch {
    // Keep migration best-effort when the template is unavailable.
  }

  return { explicitSeedAccountRefs, seedCatIdsByClient };
}

function resolveLegacySeedBindingBackfill(
  projectRoot: string,
  catalog: CatCafeConfig,
  bootstrapBindings: Record<string, BootstrapBinding | undefined>,
): Map<string, string> {
  const { explicitSeedAccountRefs, seedCatIdsByClient } = readSeedMetadata(projectRoot);
  const backfill = new Map<string, string>();
  const observedSeedBindings = new Map<BuiltinAccountClient, Array<{ catId: string; accountRef: string }>>();

  for (const breed of catalog.breeds as unknown as Record<string, unknown>[]) {
    const variants = Array.isArray(breed.variants) ? (breed.variants as Record<string, unknown>[]) : [];
    for (const variant of variants) {
      const client = providerToBootstrapClient(variant.provider);
      if (!client) continue;

      const catId = typeof variant.catId === 'string' ? variant.catId : typeof breed.catId === 'string' ? breed.catId : null;
      if (!catId) continue;

      const providerProfileId = trimBinding(variant.providerProfileId);
      const accountRef = trimBinding(variant.accountRef);
      if (providerProfileId || !accountRef) continue;

      const templateExplicitAccountRef = explicitSeedAccountRefs.get(catId);
      if (templateExplicitAccountRef && templateExplicitAccountRef === accountRef) {
        backfill.set(catId, accountRef);
        continue;
      }

      if (!seedCatIdsByClient.get(client)?.has(catId)) continue;
      const bindings = observedSeedBindings.get(client) ?? [];
      bindings.push({ catId, accountRef });
      observedSeedBindings.set(client, bindings);
    }
  }

  for (const [client, bindings] of observedSeedBindings) {
    if (bindings.length < 2) continue;
    const uniqueAccountRefs = new Set(bindings.map((binding) => binding.accountRef));
    if (uniqueAccountRefs.size <= 1) continue;

    const inheritedAccountRef = fallbackAccountRefForClient(client, bootstrapBindings[client]);
    for (const binding of bindings) {
      if (binding.accountRef !== inheritedAccountRef) {
        backfill.set(binding.catId, binding.accountRef);
      }
    }
  }

  return backfill;
}

function migrateExistingCatalogBindings(
  projectRoot: string,
  catalog: CatCafeConfig,
): { catalog: CatCafeConfig; dirty: boolean } {
  const bootstrapBindings = readBootstrapBindingsSync(projectRoot);
  const legacySeedBindingBackfill = resolveLegacySeedBindingBackfill(projectRoot, catalog, bootstrapBindings);
  let dirty = false;
  const nextCatalog = structuredClone(catalog) as CatCafeConfig;

  for (const breed of nextCatalog.breeds as unknown as Record<string, unknown>[]) {
    const variants = Array.isArray(breed.variants) ? (breed.variants as Record<string, unknown>[]) : [];
    for (const variant of variants) {
      const client = providerToBootstrapClient(variant.provider);
      if (!client) continue;
      const catId = typeof variant.catId === 'string' ? variant.catId : typeof breed.catId === 'string' ? breed.catId : null;
      const explicitProviderProfileId = trimBinding(variant.providerProfileId);
      const existingAccountRef = typeof variant.accountRef === 'string' ? variant.accountRef.trim() : '';
      const legacyExplicitAccountRef = catId ? legacySeedBindingBackfill.get(catId) : undefined;
      if (!explicitProviderProfileId && existingAccountRef && legacyExplicitAccountRef === existingAccountRef) {
        variant.providerProfileId = existingAccountRef;
        dirty = true;
        continue;
      }
      if (existingAccountRef) continue;
      if (explicitProviderProfileId) {
        variant.accountRef = explicitProviderProfileId;
        dirty = true;
        continue;
      }
      const nextAccountRef = fallbackAccountRefForClient(client, bootstrapBindings[client]);
      if (!nextAccountRef) continue;
      variant.accountRef = nextAccountRef;
      dirty = true;
    }
  }

  return { catalog: nextCatalog, dirty };
}

function filterBootstrapCatalog(template: CatCafeConfig, projectRoot: string): CatCafeConfig {
  const bootstrapBindings = readBootstrapBindingsSync(projectRoot);
  const selectedBreeds: Record<string, unknown>[] = [];
  const selectedCatIds = new Set<string>();

  for (const rawBreed of template.breeds as unknown as Record<string, unknown>[]) {
    const variants = Array.isArray(rawBreed.variants) ? (rawBreed.variants as Record<string, unknown>[]) : [];
    const firstClient = variants.map((variant) => providerToBootstrapClient(variant.provider)).find(Boolean) ?? null;
    if (!firstClient) continue;
    const binding = bootstrapBindings[firstClient];
    const selectedVariants = resolveSelectedVariants(rawBreed, binding);
    if (selectedVariants.length === 0) continue;
    const nextBreed: Record<string, unknown> = {
      ...rawBreed,
      variants: selectedVariants,
      defaultVariantId: selectedVariants.some((variant) => variant.id === rawBreed.defaultVariantId)
        ? rawBreed.defaultVariantId
        : selectedVariants[0]?.id,
    };
    selectedBreeds.push(nextBreed);
    for (const variant of selectedVariants) {
      const catId = typeof variant.catId === 'string' ? variant.catId : rawBreed.catId;
      if (typeof catId === 'string' && catId) selectedCatIds.add(catId);
    }
  }

  const templateRoster = 'roster' in template ? template.roster : {};
  const filteredRoster = Object.fromEntries(
    Object.entries((templateRoster ?? {}) as Record<string, unknown>).filter(([catId]) => selectedCatIds.has(catId)),
  );

  if ('roster' in template) {
    return {
      ...template,
      breeds: selectedBreeds as unknown as typeof template.breeds,
      roster: filteredRoster as Roster,
    };
  }

  return {
    ...template,
    breeds: selectedBreeds as unknown as typeof template.breeds,
  };
}

export function resolveCatCatalogPath(projectRoot: string): string {
  return safePath(projectRoot, CAT_CAFE_DIR, CAT_CATALOG_FILENAME);
}

export function readCatCatalogRaw(projectRoot: string): string | null {
  const catalogPath = resolveCatCatalogPath(projectRoot);
  if (!existsSync(catalogPath)) return null;
  const raw = readFileSync(catalogPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as CatCafeConfig;
    const migrated = migrateExistingCatalogBindings(projectRoot, parsed);
    if (migrated.dirty) {
      const nextRaw = `${JSON.stringify(migrated.catalog, null, 2)}\n`;
      writeFileSync(catalogPath, nextRaw, 'utf-8');
      return nextRaw;
    }
  } catch {
    // Leave invalid JSON handling to the loader so callers see the original parse error.
  }
  return raw;
}

export function readCatCatalog(projectRoot: string): CatCafeConfig | null {
  const raw = readCatCatalogRaw(projectRoot);
  if (raw === null) return null;
  return JSON.parse(raw) as CatCafeConfig;
}

export function bootstrapCatCatalog(projectRoot: string, templatePath: string): string {
  const catalogPath = resolveCatCatalogPath(projectRoot);
  if (existsSync(catalogPath)) {
    readCatCatalogRaw(projectRoot);
    return catalogPath;
  }

  const template = JSON.parse(readFileSync(templatePath, 'utf-8')) as CatCafeConfig;
  const runtimeCatalog = filterBootstrapCatalog(template, projectRoot);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(runtimeCatalog, null, 2)}\n`, 'utf-8');
  return catalogPath;
}

export function writeCatCatalog(projectRoot: string, catalog: CatCafeConfig): string {
  const catalogPath = resolveCatCatalogPath(projectRoot);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
  return catalogPath;
}
