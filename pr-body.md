## Issue

Fixes #1657 - Users editing and immediately sending (<400ms before autosave completes) were incorrectly prompted with draft recovery confirmation.

## Root Cause

`flushAdmission` always reconciled `canonicalDraftRef` with attempted send, even when canonical was just the user's own autosaved edit from the current session.

## Solution

Track the **displayed recovery boundary** via `displayedRecoverySignatureRef`:
- Updated on: hydration completion, autosave success, 409 conflict resolution, pending insert
- Used in: `flushAdmission` to distinguish "user's own edit" from "truly new recovery"

Only trigger reconciliation when canonical signature differs from what was already displayed.

## Changes

- `useDurableComposerDraft.ts`: Add `displayedRecoverySignatureRef`, update on all display events
- `durable-composer-draft-admission-flusher.ts`: Compare canonical signature against displayed boundary
- `use-pending-composer-draft-insert.ts`: Update displayed signature on authoritative inserts
- Added test: `chat-input-edit-immediate-send.test.ts` for replace/delete/insert scenarios

## Testing

New test covers:
- Text replacement + immediate send
- Text deletion + immediate send  
- Text insertion + immediate send

All should NOT trigger recovery confirmation.

## Trade-offs

- Preserves cross-session/delayed recovery protection
- Allows normal edit-send flow without false positives
- No new persistent metadata or API changes

Ready for review by @codex.

[宪宪/Claude Sonnet 4🐾]
