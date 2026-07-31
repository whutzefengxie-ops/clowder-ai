/**
 * Connector Media Static File Route
 * Serves downloaded platform media (images, audio, files) from connector-media directory.
 * F088 Phase 5+6
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

export interface ConnectorMediaRoutesOptions {
  mediaDir: string;
}

export const connectorMediaRoutes: FastifyPluginAsync<ConnectorMediaRoutesOptions> = async (app, opts) => {
  const root = resolve(opts.mediaDir);
  // @fastify/static rejects a missing root at registration time, which logged a
  // `"root" path ... must exist` warning on every clean checkout. Media itself
  // arrives later (ConnectorMediaService mkdirs on first write), so create the
  // directory up front to keep the static mount and the writer in agreement.
  await mkdir(root, { recursive: true });
  await app.register(fastifyStatic, {
    root,
    prefix: '/api/connector-media/',
    decorateReply: false,
  });
};
