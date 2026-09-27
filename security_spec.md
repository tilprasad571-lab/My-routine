# Mero Routine — Phase 0 Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Identity & Ownership Isolation**:
   - Every `/users/{userId}` document can only be read or written by the authenticated owner (`request.auth.uid == userId`) or a verified administrator (`isAdmin()`).
   - Every `/routines/{routineId}`, `/routineLogs/{logId}`, `/goals/{goalId}`, `/templates/{templateId}`, and `/proRequests/{requestId}` document MUST have `userId == request.auth.uid` upon creation, and `userId` is strictly immutable during updates.
   - Parent-child relational consistency: A `/routineLogs/{logId}` document can only be created if `/routines/$(incoming().routineId)` exists and belongs to `request.auth.uid`.
2. **Privilege Escalation & Pro Status Protection**:
   - During `/users/{userId}` creation by a non-admin, `role` MUST be `'user'`, `status` MUST be `'active'`, `isPro` MUST be `false`, and `proExpiry` MUST be `''`.
   - Standard users can ONLY update `name`, `language`, `theme`, `notificationsEnabled`, and `updatedAt` on their own profile. They can NEVER modify `role`, `status`, `isPro`, or `proExpiry`.
   - Only `isAdmin()` can update `isPro`, `proExpiry`, `status`, or `role`.
3. **Terminal State Locking on Pro Upgrade Requests**:
   - A `/proRequests/{requestId}` document created by a user must start with `status == 'pending'`, `amount == 99`, and `adminNotes == ''`.
   - Once a `/proRequests/{requestId}` reaches a terminal state (`'approved'` or `'rejected'`), non-admin users are completely locked out from modifying it; only `isAdmin()` may transition or override states.
4. **Strict Key & Volumetric Boundaries**:
   - Every `create` and `update` invokes `isValid[Entity](incoming())` enforcing `.keys().hasAll(...)`, `.keys().hasOnly(...)`, string `.size()` limits, regex patterns, and server timestamp (`request.time`) temporal integrity.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Self-Assigned Admin Role on Registration)**:
   `POST /users/user_123` with `{ uid: "user_123", role: "admin", isPro: false, ... }` by non-admin `user_123` -> `PERMISSION_DENIED`.
2. **Payload 2 (Client-Side Pro Self-Activation)**:
   `PATCH /users/user_123` with `{ isPro: true, proExpiry: "2099-01-01" }` by non-admin `user_123` -> `PERMISSION_DENIED`.
3. **Payload 3 (Shadow Field Injection on Routine)**:
   `POST /routines/routine_1` with valid fields plus `{ isAdminBypass: true }` -> `PERMISSION_DENIED` (`hasOnly` check).
4. **Payload 4 (Cross-User PII Read on `/users`)**:
   `GET /users/victim_456` by authenticated `attacker_123` -> `PERMISSION_DENIED`.
5. **Payload 5 (Unverified Email Admin Spoof)**:
   `PATCH /proRequests/req_1` with `{ status: "approved" }` by token `{ email: "tech4u571@gmail.com", email_verified: false }` -> `PERMISSION_DENIED`.
6. **Payload 6 (Orphaned RoutineLog Creation)**:
   `POST /routineLogs/log_1` referencing `routineId: "non_existent_routine"` -> `PERMISSION_DENIED` (`exists()` + ownership check).
7. **Payload 7 (Ownership Hijack on Routine Update)**:
   `PATCH /routines/routine_1` changing `userId` from `"user_123"` to `"victim_456"` -> `PERMISSION_DENIED`.
8. **Payload 8 (Denial-of-Wallet 1MB String Poisoning)**:
   `POST /routines/routine_1` with `notes` of length 10,000 chars (exceeding `maxLength: 500`) -> `PERMISSION_DENIED`.
9. **Payload 9 (ID Poisoning Attack)**:
   `POST /goals/invalid$id!@#` with non-alphanumeric ID -> `PERMISSION_DENIED` (`isValidId` check).
10. **Payload 10 (Forged Client Timestamp)**:
    `POST /goals/goal_1` with `createdAt: Timestamp(2020-01-01)` instead of `request.time` -> `PERMISSION_DENIED`.
11. **Payload 11 (Terminal State Re-opening on ProUpgradeRequest)**:
    `PATCH /proRequests/req_1` by owner after `status == 'rejected'` -> `PERMISSION_DENIED`.
12. **Payload 12 (Unauthorized Ad Banner Mutation)**:
    `POST /ads/ad_1` by standard verified user -> `PERMISSION_DENIED`.
