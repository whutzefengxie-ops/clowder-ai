import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { PLUGIN_HOST_ENTRIES } from '../host-inventory/plugin-host-layout.js';
import type { DormantPluginRuntimeComposition, PluginManagerRuntimeComposition } from '../runtime-composition.js';
import {
  type InitialPluginInstallationOptions,
  prepareInitialPluginInstallation,
} from './initial-plugin-installation.js';
import { parseOfflinePluginBundle } from './offline-plugin-bundle-schema.js';

export function resolveOfflinePluginBundlePath(
  explicit: string | undefined,
  preset: string | undefined,
  runtimeRoot: string,
) {
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) throw new Error('CAT_CAFE_OFFLINE_PLUGIN_BUNDLE must be an absolute path');
    return explicit;
  }
  return preset === undefined ? undefined : join(runtimeRoot, preset);
}

export async function prepareOfflineHostInitialPlugins(options: {
  readonly bundlePath: string;
  readonly runtime: DormantPluginRuntimeComposition;
  readonly managerRuntime: PluginManagerRuntimeComposition;
  readonly onFailure: InitialPluginInstallationOptions['onFailure'];
}) {
  // Read once per startup; retries within this operation keep the same metadata and journal pins.
  const raw = await readFile(options.bundlePath, 'utf8');
  if (Buffer.byteLength(raw) > 65536) throw new Error('Offline plugin bundle metadata is too large');
  const bundle = parseOfflinePluginBundle(JSON.parse(raw));
  const { runtime, managerRuntime } = options;
  return prepareInitialPluginInstallation({
    statePath: join(dirname(runtime.paths.inventorySnapshotPath), PLUGIN_HOST_ENTRIES.initialInstallation),
    inventory: runtime.inventoryStore,
    loadReleases: async () => bundle.plugins.map((p) => ({ ...p, catalogId: p.pluginId })),
    loadSelection: async () => ({ schemaVersion: 1, plugins: bundle.plugins }),
    installer: {
      install: async (pluginId, pin) => {
        const entry = bundle.plugins.find(
          (p) => p.pluginId === pluginId && p.version === pin?.version && p.packageDigest === pin?.packageDigest,
        );
        if (!entry) throw new Error(`Offline bundle does not contain the journal-pinned release: ${pluginId}`);
        return managerRuntime.localAdmission.install(
          { kind: 'local-archive', path: join(dirname(options.bundlePath), entry.archive) },
          {
            expectedDigest: entry.packageDigest,
            expectedPackage: { pluginId, packageName: entry.packageName, version: entry.version },
          },
        );
      },
    },
    reconcile: (pluginId, instanceId) => managerRuntime.configuration.reconcile(pluginId, instanceId),
    activate: async (pluginId, instanceId, expectedRevision) => {
      const instance = (await runtime.inventoryStore.snapshot()).instances.find(
        (i) => i.pluginInstanceId === instanceId,
      );
      if (instance?.configReadiness === 'ready')
        await managerRuntime.manager.setEnabled(pluginId, { enabled: true, expectedRevision });
    },
    onFailure: options.onFailure,
  });
}
