import { z } from 'zod';

const bundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    plugins: z
      .array(
        z
          .object({
            pluginId: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
            packageName: z
              .string()
              .min(1)
              .max(214)
              .regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/),
            version: z.string().min(1).max(128),
            packageDigest: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
            archive: z
              .string()
              .max(200)
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

/** Shared by build staging and admission; metadata cannot declare code or grants. */
export function parseOfflinePluginBundle(input: unknown) {
  const bundle = bundleSchema.parse(input);
  if (new Set(bundle.plugins.map((p) => p.pluginId)).size !== bundle.plugins.length)
    throw new Error('Duplicate offline plugin identity');
  if (
    bundle.plugins.some(
      (p) => `sha512-${Buffer.from(p.packageDigest.slice(7), 'base64').toString('base64')}` !== p.packageDigest,
    )
  )
    throw new Error('Invalid offline plugin digest encoding');
  return bundle;
}
