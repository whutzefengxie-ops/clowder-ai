# F303 Census: credential_required Error Code

**Feature**: Issue #1668 - ACP native credentials diagnosis  
**Error Code**: `credential_required`  
**Purpose**: Distinguish credential errors from protocol/network errors, enable targeted recovery guidance

## Producers (Sources)

### 1. AcpAgentService.classifyError()
**File**: `packages/api/src/domains/cats/services/agents/providers/acp/AcpAgentService.ts:1026-1091`  
**Patterns**:
- `no\s+API\s+key\s+for\s+provider` (DSH original pattern from Issue #1668)
- `store\s+\w+_API_KEY\s+through` (DSH credential service guidance)
- `credential.*(required|missing|invalid|expired)`
- `api[_\s]?key.*(missing|required|invalid)`
- `token.*(expired|invalid)`
- `auth\s+fail|authentication\s+failed|unauthenticated`

**Guards**:
- MCP errors checked first to avoid misclassification (R3-2 fix)
- Capacity errors (-32000) prioritized over auth patterns
- Conservative auth patterns to avoid false positives

**Output**: `{ errorCode: 'credential_required', errorMsg: string }`  
**Test Coverage**: `test/acp/acp-error-classification.test.js` (5 cases)

### 2. tryPrepareAcpProcessEnv()
**File**: `packages/api/src/domains/cats/services/agents/providers/acp/acp-spawn-env.ts:69-82`  
**Triggers**:
- Missing API key when authType='api_key'
- Pattern detection in thrown errors

**Output**: `{ ok: false, error: Error, errorCode: 'credential_required' }`  
**Test Coverage**: `test/acp/acp-spawn-env.test.js` (assertion on errorCode)

## Consumers (Handlers)

### 1. AcpServiceFactory (Registry Sync)
**File**: `packages/api/src/domains/cats/services/agents/providers/acp/AcpServiceFactory.ts:113-120`  
**Behavior**:
- Receives errorCode from tryPrepareAcpProcessEnv
- Routes 'credential_required' to skipAcpProfile with matching reason
- Other spawn-env errors use 'invalid-spawn-env' reason

**Evidence**: Code path verified through spawn-env integration

### 2. skipAcpProfile (Diagnostic Projection)
**File**: `packages/api/src/domains/cats/services/agents/providers/acp/acp-registration-failure.ts:4-29`  
**Behavior**:
- Receives reason code (including 'credential_required')
- Calls onUnavailable callback with { code, message }
- Projects safe diagnostic to UI (secrets filtered out)

**Evidence**: Existing mechanism, now receives credential_required code

### 3. AcpAgentService.invoke() (Message Stream)
**File**: `packages/api/src/domains/cats/services/agents/providers/acp/AcpAgentService.ts:948-957`  
**Behavior**:
- Emits error message with errorCode field
- Applies user-facing translation via toUserFacingError()
- Includes Chinese guidance: "凭据缺失或无效。请在 Hub > 账号设置中添加 API key"

**Evidence**: Integration test validates full flow

### 4. toUserFacingError() (User Guidance)
**File**: `packages/api/src/domains/cats/services/agents/providers/acp/AcpAgentService.ts:1096-1122`  
**Behavior**:
- case 'credential_required': adds actionable guidance
- Preserves original error message for debugging
- Directs users to Hub account settings or native tool config

**Test Coverage**: `test/acp/acp-credential-flow.test.js` (user guidance assertions)

## Message Persistence

**Mechanism**: Existing message disposition system  
**Fields Preserved**:
- `errorCode: 'credential_required'`
- `error: string` (user-facing with guidance)
- `metadata: { timestamp, ... }`

**Evidence**: AcpAgentService yields typed error messages; disposition system persists all fields

## Guard Against Misclassification

### MCP vs Model Auth (R3-2)
**File**: `AcpAgentService.ts:1038-1040`  
**Priority**: MCP check precedes credential check  
**Test**: `test/acp/acp-error-classification.test.js:145` - MCP Unauthorized → mcp_pollution

### Capacity vs Credential
**File**: `AcpAgentService.ts:1057-1059`  
**Priority**: Explicit -32000 code and 'capacity' keyword  
**Test**: `test/acp/acp-error-classification.test.js:181` - Resource exhausted → model_capacity

### Network vs Credential
**Pattern Specificity**: Broad 'Unauthorized' alone not matched; requires auth fail/unauthenticated context  
**Rationale**: Generic 401/403 could be network, proxy, or MCP issues

## Test Coverage Summary

| Test File | Cases | Focus |
|-----------|-------|-------|
| acp-error-classification.test.js | 5 | Pattern matching, false positive guards |
| acp-spawn-env.test.js | 6 | spawn-env errorCode propagation |
| acp-credential-flow.test.js | 2 | End-to-end integration, user guidance |
| **Total** | **13** | **Detection → Classification → UI** |

## Remaining Gaps (Out of Scope for R3)

1. **Native credential detection**: No probing of DSH .credentials.yaml or Pi auth.json (per R3 guidance: "没有安全探针就 unknown")
2. **UI display**: Member card does not yet render credential_required status badge
3. **@all routing**: Does not yet skip credential_required members
4. **Explicit retry**: No "fix and retry" button in UI

**Current State**: Error flow complete from detection to user-visible message; above gaps are UX enhancements, not blockers for error diagnosis.

---

**Census Date**: 2026-10-22  
**Reviewed By**: Self-census (author: claude-code)  
**Status**: Producers and core consumers verified via tests; UI projection pending
