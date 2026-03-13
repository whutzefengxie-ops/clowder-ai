import type { CatId } from '@cat-cafe/shared';

export type TaskProgressStatus = 'running' | 'completed' | 'interrupted';

export interface TaskProgressItem {
  id: string;
  subject: string;
  status: string;
  activeForm?: string;
}

export interface TaskProgressSnapshot {
  threadId: string;
  catId: CatId;
  tasks: TaskProgressItem[];
  status: TaskProgressStatus;
  updatedAt: number;
  lastInvocationId?: string;
  interruptReason?: string;
}

export interface TaskProgressStore {
  getSnapshot(threadId: string, catId: CatId): Promise<TaskProgressSnapshot | null>;
  setSnapshot(snapshot: TaskProgressSnapshot, options?: { ttlSeconds?: number }): Promise<void>;
  deleteSnapshot(threadId: string, catId: CatId): Promise<void>;
  getThreadSnapshots(threadId: string): Promise<Record<string, TaskProgressSnapshot>>;
  deleteThread(threadId: string): Promise<void>;
}
