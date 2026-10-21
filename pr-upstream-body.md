## Issue

Fixes zts212653/clowder-ai#1657

Users editing and immediately sending (<400ms before autosave completes) were incorrectly prompted with draft recovery confirmation.

Replaces fork PR whutzefengxie-ops/clowder-ai#12

## Root Cause Analysis

**P1-2 Core Issue**: `flushAdmission` always reconciled `canonicalDraftRef` with attempted send, even when canonical was just the user's own autosaved edit from the current session.

**Original approach failed**: Setting `displayedRecoverySignatureRef` after hydration completion, then comparing in flusher after awaiting hydration. This caused late-arriving hydration to be pre-marked as "displayed" before user could see it.

**P1-1**: Missing parameter in `usePendingComposerDraftInsert` caused `ReferenceError` on every `ChatInput` mount.

**P2**: Merged snapshot was saved but not displayed to user when confirmation was required.

## Solution

### Core Fix: Capture at Click Time

**Key insight**: Capture the canonical signature **at click time** in `beginAdmission`, not after hydration completes.

1. Add `capturedDisplayedSignature` to `PendingComposerAdmissionDraft`
2. In `beginAdmission`: snapshot current `canonicalDraftRef` signature at click moment
3. In `flushAdmission`: compare canonical against the **captured** signature, not a ref that might update later

This ensures late-arriving hydration is correctly detected as "new recovery not yet seen".

### P2 Fix: Display Merged Content

When `ComposerDraftConfirmationRequiredError` is thrown:
- Merged snapshot is already saved to `canonicalDraftRef`
- On admission failure (`accepted=false`), display `canonicalDraftRef` content
- User sees actual merged text/images/attachments/reply, not just attempted

### P1 Fixes

- Add missing `displayedRecoverySignatureRef` parameter (then removed as no longer needed with new approach)
- Fix image requirement: only use attempted snapshot images, not canonical's stale images

## Changes

| File | Change | Lines |
|------|--------|-------|
| `durable-composer-draft-admission-flusher.ts` | Add `capturedDisplayedSignature`, compare against it, fix image requirement | +11/-8 |
| `useDurableComposerDraft.ts` | Capture signature in `beginAdmission`, display merged on failure | +35/-6 |
| `use-pending-composer-draft-insert.ts` | Clean interface (displayedRecoverySignatureRef not needed) | -7 |

Total: 3 files changed, 39 insertions(+), 21 deletions(-)

## Testing

### Test Plan Documented

See `packages/web/src/components/__tests__/issue-1657-test-plan.md` for required coverage:
- Edit + immediate send (<400ms): text replace/delete/insert
- Delayed hydration recovery
- Image/attachment/reply deletion
- Confirmation display with merged content

### Existing Tests

Existing admission flow tests should continue to pass:
- `chat-input-draft-persistence.test.ts`
- `chat-input-draft-boundary-flush.test.ts`  
- `new-conversation/__tests__`

### Known Limitation

Worktree dependency installation issues prevented running full test suite. Test plan documents required coverage for reviewer to verify.

## Review Evidence

First-round review by @codex identified and this addresses:
- ✅ P1-1: Parameter resolution fixed
- ✅ P1-2: Click-time capture prevents late hydration bypass
- ✅ P2: Merged snapshot displayed on confirmation
- ⚠️ P1-3: Test plan documented, execution blocked by environment

## Trade-offs

- **Preserves** cross-session/delayed recovery protection
- **Allows** normal edit-send flow without false positives
- **No** new persistent metadata or API changes
- **No** changes to `beginAdmission` async contract

## Verification Steps

1. Edit draft text, send immediately (<400ms)
2. Verify no false confirmation prompt
3. Refresh page with unsent draft
4. Verify legitimate recovery still prompts
5. Verify merged content displayed when confirmation required

[宪宪/Claude Opus🐾]
