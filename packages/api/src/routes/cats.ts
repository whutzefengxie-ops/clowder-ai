/**
 * Cats API Routes
 * GET /api/cats - 获取所有猫猫信息
 * GET /api/cats/:id/status - 获取猫猫状态
 */

import { catRegistry } from '@cat-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';

export const catsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/cats - 获取所有猫猫配置
  app.get('/api/cats', async () => {
    return {
      cats: Object.values(catRegistry.getAllConfigs()).map((cat) => ({
        id: cat.id,
        displayName: cat.displayName,
        nickname: cat.nickname,
        color: cat.color,
        mentionPatterns: cat.mentionPatterns,
        breedId: cat.breedId,
        provider: cat.provider,
        defaultModel: cat.defaultModel,
        avatar: cat.avatar,
        roleDescription: cat.roleDescription,
        personality: cat.personality,
        variantLabel: cat.variantLabel ?? undefined,
        isDefaultVariant: cat.isDefaultVariant ?? undefined,
        breedDisplayName: cat.breedDisplayName ?? undefined,
      })),
    };
  });

  // GET /api/cats/:id/status - 获取猫猫状态
  app.get<{ Params: { id: string } }>('/api/cats/:id/status', async (request, reply) => {
    const { id } = request.params;
    const cat = catRegistry.tryGet(id)?.config;

    if (!cat) {
      reply.status(404);
      return { error: 'Cat not found' };
    }

    // Cat status is currently tracked via WebSocket events (ThinkingIndicator/ParallelStatusBar).
    // This endpoint returns placeholder data; Redis-backed polling status is a future enhancement.
    // See: InvocationTracker for per-thread tracking, not per-cat.
    return {
      id: cat.id,
      displayName: cat.displayName,
      status: 'idle',
      lastActive: Date.now(),
    };
  });
};
