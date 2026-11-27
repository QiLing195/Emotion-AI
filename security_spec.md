# Emotion-AI Firestore Security Specification (Phase 0 & Phase 2)

## 1. Relationship Mapping & Master Source of Truth
- **Master Source of Truth**: `/users/{userId}` is the root workspace anchor for every authenticated user.
- **Strict Per-User Isolation**: Every subcollection (`annotations`, `dynamicConcerns`, `personaStates`, `personaPreferences`, `personaLogs`) belongs exclusively to `/users/{userId}`.
- **No Cross-User Sharing & No Blanket Reads**: No collection permits blanket reads (`isSignedIn()`). There is no `allow list` on `/users` or `/users/{userId}/personaStates`. All subcollection `list` queries enforce `userId == request.auth.uid && resource.data.userId == request.auth.uid` without `get()` lookups.
- **PII Minimization**: User email addresses and raw OAuth credentials are never stored in Firestore documents; `/users/{userId}` stores only `userId`, `displayName`, and server timestamps, strictly readable and writable by the verified owner.

## 2. Data Invariants
1. **Verified Ownership on Writes**: Every write requires `request.auth != null && request.auth.token.email_verified == true && request.auth.uid == userId`.
2. **Parent Existence (Master Gate)**: Single-document subcollection operations (`get`, `create`, `update`, `delete`) verify that `/users/{userId}` exists and its `userId` matches `request.auth.uid`.
3. **Immutable Identity & Timestamps**: `userId` and `createdAt` can never be mutated after creation; `createdAt == request.time` on `create` and `updatedAt == request.time` on both `create` and `update`.
4. **Path ID Hardening**: Every single-document path variable (`userId`, `annotationId`, `concernId`, `stateId`, `prefKey`, `logId`) must satisfy `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars). `personaStates` further restricts `stateId == 'current'`, and `personaPreferences` restricts `prefKey == incoming().key`.
5. **Bounded Types & Volumes**: Every string has explicit `.size()` bounds; every array has `.size() <= MAX` plus `[0]` type validation; coordinates (`valence`, `arousal`) are strictly in `[-1, 1]`; traits and confidences are strictly in `[0, 1]`.
6. **Action-Based Updates & Terminal State Locking**: Every `update` invokes `isValid[Entity](incoming())` first and enumerates explicit allowed `affectedKeys().hasOnly(...)` action branches. In `personaLogs`, once `reverted == true`, the document is terminally locked against any further updates.

## 3. The "Dirty Dozen" Adversarial Payloads (All Must Be Rejected)
1. **DD-01 (Identity Spoofing on Create)**: Authenticated user `uid_attacker` creates `/users/uid_victim/annotations/ann-1` with `userId: "uid_victim"`.
2. **DD-02 (Owner Mismatch in Payload)**: Authenticated user `uid_alice` creates `/users/uid_alice/annotations/ann-1` with `userId: "uid_bob"`.
3. **DD-03 (Unverified Email Write)**: Authenticated user with `email_verified: false` attempts to create `/users/uid_alice/annotations/ann-1`.
4. **DD-04 (Shadow/Ghost Field Injection)**: Authenticated user includes extra undeclared key `isAdmin: true` or `role: "superadmin"` in `UserProfile` or `Annotation`.
5. **DD-05 (Path ID Poisoning)**: Authenticated user creates an annotation with a 150-character or special-character document ID (`"../../evil"` or `"a".repeat(150)`).
6. **DD-06 (Denial-of-Wallet String Overflow)**: Authenticated user submits an `Annotation` with `utterance` length `1001` (> 1000 max).
7. **DD-07 (Out-of-Range Numeric Poisoning)**: Authenticated user submits an `Annotation` with `valence: 2.5` (outside `[-1, 1]`) or `PersonaProfileState` with `traits.directness: 1.8` (outside `[0, 1]`).
8. **DD-08 (Timestamp Forgery / Backdating)**: Client supplies a forged past `createdAt` or `updatedAt` instead of `request.time` (`serverTimestamp()`).
9. **DD-09 (Immutable Field Tampering on Update)**: Client attempts to mutate `createdAt` or `userId` during an annotation update.
10. **DD-10 (Array Bomb / Type Poisoning)**: Client creates `DynamicConcern` with 7 `topicKeywords` (> 6 max) or non-string first element `[123]`, or `PersonaPreference` with 13 `evidenceIds` (> 12 max).
11. **DD-11 (Terminal State Unlocking)**: Client attempts to update a `PersonaGrowthLog` whose existing `reverted` is already `true` back to `false` or modify its `summary`.
12. **DD-12 (Orphaned Subcollection Write / Cross-User List Scrape)**: Client attempts to create an annotation under a non-existent `/users/{userId}` parent or list `/users/uid_victim/annotations` as `uid_attacker`.
