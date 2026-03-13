import type { BacklogAuditActor, CreateBacklogItemInput } from '@cat-cafe/shared';

export function makeUserActor(userId: string): BacklogAuditActor {
  return { kind: 'user', id: userId };
}

export function makeCatActor(catId: string): BacklogAuditActor {
  return { kind: 'cat', id: catId };
}

export function makeCreatorActor(input: CreateBacklogItemInput): BacklogAuditActor {
  return input.createdBy === 'user' ? makeUserActor(input.userId) : makeCatActor(input.createdBy);
}
