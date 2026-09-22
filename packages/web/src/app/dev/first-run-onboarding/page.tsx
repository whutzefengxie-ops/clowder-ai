'use client';

import { FirstRunQuestWizard } from '@/components/FirstRunQuestWizard';

export default function FirstRunOnboardingTestPage() {
  return (
    <main className="min-h-screen bg-cafe-surface p-8">
      <FirstRunQuestWizard open onClose={() => undefined} onCreated={() => undefined} />
    </main>
  );
}
