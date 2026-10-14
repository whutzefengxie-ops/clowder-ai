import type { UserPreferences } from '@cat-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readUserPreferencesStrict, updateUserPreferences } from '../config/user-preferences-store.js';
import { resolveSessionUserId } from '../utils/request-identity.js';

const GUIDE_VERSION = 'collaboration-v1';
const inputSchema = z.object({ status: z.enum(['dismissed', 'completed']) }).strict();

/** Personal receipts share the existing atomic preference owner, not the transient F155 session. */
export const configOnboardingRoutes: FastifyPluginAsync<{ projectRoot: string }> = async (app, { projectRoot }) => {
  const snapshot = (userId: string, preferences: UserPreferences) => ({
    userId,
    version: GUIDE_VERSION,
    status: preferences.onboardingGuides?.[`${encodeURIComponent(userId)}:${GUIDE_VERSION}`]?.status ?? 'not_started',
  });
  app.get('/api/config/onboarding', async (request, reply) => {
    const userId = resolveSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });
    try {
      return snapshot(userId, readUserPreferencesStrict(projectRoot));
    } catch (error) {
      request.log.warn({ err: error }, 'Onboarding preferences unavailable');
      return reply
        .code(503)
        .send({ code: 'preferences_unavailable', error: 'Unable to read preferences; retry later' });
    }
  });
  app.put('/api/config/onboarding', async (request, reply) => {
    const userId = resolveSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid onboarding receipt' });
    const key = `${encodeURIComponent(userId)}:${GUIDE_VERSION}`;
    try {
      const next = updateUserPreferences(projectRoot, (current) => ({
        ...current,
        onboardingGuides: {
          ...current.onboardingGuides,
          [key]: {
            status: current.onboardingGuides?.[key]?.status === 'completed' ? 'completed' : parsed.data.status,
            updatedAt: Date.now(),
          },
        },
      }));
      return snapshot(userId, next);
    } catch (error) {
      request.log.warn({ err: error }, 'Onboarding preferences unavailable');
      return reply
        .code(503)
        .send({ code: 'preferences_unavailable', error: 'Unable to save preferences; retry later' });
    }
  });
};
