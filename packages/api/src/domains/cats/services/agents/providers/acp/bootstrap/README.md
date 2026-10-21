# ACP Bootstrap Policy System

## Overview

This directory implements the Windows ACP bootstrap startup policy system, which replaced hardcoded build-specific constants with a structured, auditable policy framework.

**Related**: Issue #1667, Technical Plan in `docs/design/2026-10-22-issue-1667-dsh-bootstrap-policy/`

## Problem

Previously, ACP bootstrap verification hardcoded specific build versions (e.g., DSH 0.2.0-rc.2) directly in TypeScript source code. This created several issues:

1. **Version Lock-in**: Every new build required modifying and redeploying the main application
2. **No Separation of Concerns**: Security policies were embedded in business logic
3. **Limited Auditability**: No clear provenance or evidence trail for policy decisions
4. **Internal Network Blocking**: Custom internal builds couldn't be supported without source code changes

## Solution

The new system separates policy **data** from policy **enforcement logic**:

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Policy Store                              │
│  (acp-startup-policy-store.ts)                              │
│                                                              │
│  ┌──────────────┐  ┌──────────────────────────────────┐    │
│  │   Built-in   │  │   Local (controlled import)      │    │
│  │   Policies   │  │   - Internal builds              │    │
│  │              │  │   - Custom configurations        │    │
│  └──────────────┘  └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ├─ Read only
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 Policy Matcher                               │
│  (acp-startup-policy-matcher.ts)                            │
│                                                              │
│  Evaluates actual startup plans against policies:           │
│  - Launch shape verification                                │
│  - Artifact integrity (SHA-256)                             │
│  - Profile constraints                                      │
│  - Environment safety                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ├─ Policy match result
                              ↓
┌─────────────────────────────────────────────────────────────┐
│           Bootstrap Context & Pool Integration              │
│  (acp-bootstrap-context.ts, acp-pool-signature.ts)         │
│                                                              │
│  - Embeds policy ID/revision in pool signature              │
│  - Enables pool invalidation on policy revocation           │
│  - Verifies policy consistency across cold starts           │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Policy Types (`acp-startup-policy-types.ts`)

Defines the schema for policy records:

```typescript
interface AcpStartupPolicy {
  schemaVersion: 1;
  policyId: string;           // Stable identifier
  revision: number;            // Increment on updates
  label: string;
  provenance: {                // Audit trail
    reviewer: string;
    auditDate: string;
    evidenceRef: string;       // PR URL, ticket, etc.
  };
  launchShape: {...};          // Invocation constraints
  artifacts: [...];            // Files + SHA-256 hashes
  profileConstraints?: {...};  // Profile/config rules
  packageConstraints?: {...};  // Package name/version
  assurance: string;           // Security guarantees
}
```

#### 2. Policy Store (`acp-startup-policy-store.ts`)

- **Canonical reader** for all policies
- Built-in policies ship with the application
- Local policies can be imported by instance owners (W2 - controlled import)
- Policies are **immutable data records**

#### 3. Policy Matcher (`acp-startup-policy-matcher.ts`)

Evaluates startup commands against policies:

- Resolves CLI commands to actual spawn plans
- Verifies artifact integrity (file hashes)
- Checks environment safety (no NODE_OPTIONS injection)
- Validates profile configurations
- Returns structured match result with policy ID/revision

#### 4. Bootstrap Context Integration (`acp-bootstrap-context.ts`)

- Calls policy matcher during bootstrap verification
- Embeds `policyId` and `policyRevision` in verified context
- Ensures policy consistency across process lifecycle

#### 5. Pool Signature Integration (`acp-pool-signature.ts`)

Pool signatures now include:
- `policyId`: Identifies which policy was matched
- `policyRevision`: Tracks policy version

**Why this matters**: When a policy is revoked or updated, the pool signature changes, preventing reuse of pools with outdated policies.

## Security Properties

### 1. Separation of Trust

**Candidate generation ≠ Authorization**

- Scanning files and computing hashes produces "candidates"
- Only explicitly imported policies grant permissions
- No auto-trust from:
  - Project files
  - Agent output  
  - Package self-declarations
  - Provenance strings alone

### 2. Startup Object Binding

Policies bind to the **actual execution plan**:
- Resolved interpreter path
- Entry point and dependencies
- Profile configuration
- Effective environment

Not just the CLI command string.

### 3. Revocation & Pool Invalidation

- Policy changes immediately affect new operations
- Existing pools with old signatures are retired
- No "reuse old permission" window

### 4. Fail-Closed by Default

- Unknown builds: rejected
- Missing policy: rejected  
- Artifact mismatch: rejected
- Unsafe environment: rejected

## Usage Example

### Built-in Pi Bridge

```typescript
// Policy defined in acp-startup-policy-store.ts
{
  policyId: 'builtin-pi-bridge',
  revision: 1,
  launchShape: {
    entryPattern: 'node-absolute',
    requiredArgs: { fixed: ['--pi-command'] },
    forbiddenEnv: ['NODE_OPTIONS', 'NODE_PATH'],
  },
  artifacts: [
    { path: 'pi-acp-bridge.js', sha256: 'dynamic' }
  ],
  assurance: 'Pi bridge does not read ancestor configuration'
}
```

At runtime:
```typescript
const result = matchStartupPolicy('node', ['bridge.js', '--pi-command', 'pi']);
// => { matched: true, policyId: 'builtin-pi-bridge', revision: 1 }
```

### DSH 0.2.0-rc.2

```typescript
{
  policyId: 'dsh-0.2.0-rc.2',
  revision: 1,
  artifacts: [
    { path: 'entry', sha256: '1a03dee...' },
    { path: '@deepseek-ai/dsh-acp', sha256: 'c08ed51...' },
    // ...
  ],
  profileConstraints: {
    allowedBundles: [['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']],
    allowEmpty: true,
    noPatch: true,
  }
}
```

## Migration & Backward Compatibility

The public API (`auditedWindowsAcpStartup`) remains unchanged:

```typescript
// Before (hardcoded)
export function auditedWindowsAcpStartup(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): 'builtin-pi' | 'dsh-0.2.0-rc.2' | undefined

// After (policy-backed, same signature)
export function auditedWindowsAcpStartup(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): 'builtin-pi' | 'dsh-0.2.0-rc.2' | undefined
```

Internally, it now:
1. Calls `matchStartupPolicy()`
2. Maps `policyId` back to legacy string format
3. Returns `undefined` for unknown policies (fail-closed)

All existing tests pass without modification.

## Future Work (W2)

### Controlled Policy Import

Currently stubbed in `acp-startup-policy-store.ts`:

```typescript
export function importPolicy(policy: AcpStartupPolicy): 
  { success: boolean; error?: string }
```

Will implement:
- Policy validation (schema, conflicts)
- Secure storage location with integrity checks
- Access control (instance owner only)
- Revocation mechanism

### Policy Revocation

```typescript
export function revokePolicy(policyId: string, revision?: number):
  { success: boolean; error?: string }
```

Will trigger:
- Removal from active set
- Pool signature invalidation
- Immediate effect on new spawns

## Testing

- `acp-bootstrap-startup-policy.test.js` - Policy matching
- `acp-pool-signature.test.js` - Pool signature integration
- `acp-bootstrap-spawn-recheck.test.js` - Cold-start verification
- `acp-bootstrap-relocation.test.js` - Directory selection with policies

## References

- Issue #1667: https://github.com/zts212653/clowder-ai/issues/1667
- Technical Plan: `docs/design/2026-10-22-issue-1667-dsh-bootstrap-policy/technical-plan.md`
- Plan Review: `docs/design/2026-10-22-issue-1667-dsh-bootstrap-policy/plan-review.md`
- PR #1658: Prior Windows bootstrap fixes
