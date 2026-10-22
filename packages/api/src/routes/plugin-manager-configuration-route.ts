import type { PluginManagerConfigureRequest } from '@cat-cafe/shared';
import type { FastifyInstance } from 'fastify';
import { isTrustedHostCompatibilityEnabled } from '../config/trusted-host-compatibility.js';
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
      let auditWarning: string | undefined;
      try {
        await appendConfigurationAudit(auditLog, {
          operator: access.operator,
          pluginId: parsedId.data,
          expectedRevision: mutation.expectedRevision,
          keys: mutation.updates.map((update) => update.key),
        });
      } catch {
        if (!isTrustedHostCompatibilityEnabled()) {
          return reply.status(503).send({ error: 'Plugin audit log is unavailable', code: 'AUDIT_UNAVAILABLE' });
        }
        auditWarning = '配置已保存，但插件审计写入失败（可信主机兼容模式）。请检查 AUDIT_LOG_DIR。';
        request.log.warn(
          { pluginId: parsedId.data, code: 'AUDIT_UNAVAILABLE' },
          'Trusted-host compatibility: configuration audit unavailable',
        );
      }
      try {
        const result = await options.manager.configure(parsedId.data, mutation);
        return auditWarning ? { ...result, warning: auditWarning } : result;
      } catch (error) {
        return sendManagerError(reply, error);
      }
    },
  );
}
