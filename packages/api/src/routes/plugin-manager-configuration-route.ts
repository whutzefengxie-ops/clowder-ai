import type { PluginManagerConfigureRequest } from '@cat-cafe/shared';
import type { FastifyInstance } from 'fastify';
import type { EventAuditLog } from '../domains/cats/services/orchestration/EventAuditLog.js';
import { pluginAccessError, requirePluginWriteAccess } from './plugin-access-guards.js';
import {
  appendConfigurationAudit,
  configureSchema,
  invalidRequest,
  pluginIdSchema,
  sendManagerError,
} from './plugin-manager-route-contract.js';
import type { PluginManagerRouteOptions } from './plugin-manager-routes.js';

export function registerPluginManagerConfigurationRoute(
  app: FastifyInstance,
  options: PluginManagerRouteOptions,
  auditLog: Pick<EventAuditLog, 'append'>,
): void {
  const accessOptions = { allowVerifiedCallbackPrincipal: true } as const;
  app.post<{ Params: { pluginId: string } }>(
    '/api/plugin-manager/plugins/:pluginId/contributions/configuration',
    async (request, reply) => {
      const access = requirePluginWriteAccess(request, accessOptions);
      if ('error' in access) return pluginAccessError(reply, access);
      const parsedId = pluginIdSchema.safeParse(request.params.pluginId);
      const parsed = configureSchema.safeParse(request.body);
      if (!parsedId.success || !parsed.success) return invalidRequest(reply);
      const mutation = parsed.data as PluginManagerConfigureRequest;
      try {
        await appendConfigurationAudit(auditLog, {
          operator: access.operator,
          pluginId: parsedId.data,
          expectedRevision: mutation.expectedRevision,
          keys: mutation.updates.map((update) => update.key),
        });
      } catch {
        return reply.status(503).send({ error: 'Plugin audit log is unavailable', code: 'AUDIT_UNAVAILABLE' });
      }
      try {
        const result = await options.manager.configure(parsedId.data, mutation);
        return result;
      } catch (error) {
        return sendManagerError(reply, error);
      }
    },
  );
}
