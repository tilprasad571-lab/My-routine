/**
 * Phase 0 TDD Verification Suite for Mero Routine Firestore Security Rules
 * Verifies that all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: {
    uid: string;
    email: string;
    email_verified: boolean;
  } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Self-Assigned Admin Role on Registration',
    operation: 'create',
    path: '/users/user_123',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      uid: 'user_123',
      name: 'Attacker',
      email: 'user@example.com',
      role: 'admin',
      status: 'active',
      isPro: false,
      proExpiry: '',
      language: 'en',
      theme: 'light',
      notificationsEnabled: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Client-Side Pro Self-Activation',
    operation: 'update',
    path: '/users/user_123',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      isPro: true,
      proExpiry: '2099-12-31T00:00:00.000Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Routine',
    operation: 'create',
    path: '/routines/routine_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      userId: 'user_123',
      title: 'Gym',
      time: '06:00',
      category: 'Fitness',
      icon: 'dumbbell',
      reminderOffset: 10,
      duration: 60,
      repeatType: 'everyday',
      customDays: [1, 2, 3, 4, 5],
      targetDate: '2026-09-26',
      notes: 'Morning workout',
      isVerifiedShadowField: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-User PII Read on /users',
    operation: 'get',
    path: '/users/victim_456',
    auth: { uid: 'attacker_123', email: 'attacker@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unverified Email Admin Spoof',
    operation: 'update',
    path: '/proRequests/req_1',
    auth: { uid: 'spoof_admin', email: 'tech4u571@gmail.com', email_verified: false },
    payload: {
      status: 'approved',
      adminNotes: 'Approved by spoofed email',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned RoutineLog Creation',
    operation: 'create',
    path: '/routineLogs/log_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      userId: 'user_123',
      routineId: 'non_existent_routine_999',
      date: '2026-09-26',
      status: 'done',
      snoozedUntil: '',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Ownership Hijack on Routine Update',
    operation: 'update',
    path: '/routines/routine_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      userId: 'victim_456',
      title: 'Hijacked Routine',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Denial-of-Wallet Oversized String Poisoning',
    operation: 'create',
    path: '/routines/routine_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      userId: 'user_123',
      title: 'Gym',
      time: '06:00',
      category: 'Fitness',
      icon: 'dumbbell',
      reminderOffset: 5,
      duration: 45,
      repeatType: 'today',
      customDays: [],
      targetDate: '2026-09-26',
      notes: 'A'.repeat(1500),
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID Poisoning Attack on Goal Path Variable',
    operation: 'create',
    path: '/goals/invalid$id!@#',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      userId: 'user_123',
      title: 'Wake up at 5 AM',
      category: 'Morning',
      targetDays: 30,
      completedDays: 0,
      startDate: '2026-09-26',
      endDate: '2026-10-26',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Forged Client Timestamp on Goal Creation',
    operation: 'create',
    path: '/goals/goal_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      userId: 'user_123',
      title: 'Wake up at 5 AM',
      category: 'Morning',
      targetDays: 30,
      completedDays: 0,
      startDate: '2026-09-26',
      endDate: '2026-10-26',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal State Modification on ProUpgradeRequest by Non-Admin',
    operation: 'update',
    path: '/proRequests/req_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      senderInfo: 'Updated sender after rejection',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized Ad Banner Creation by Standard User',
    operation: 'create',
    path: '/ads/ad_1',
    auth: { uid: 'user_123', email: 'user@example.com', email_verified: true },
    payload: {
      title: 'Fake Ad',
      type: 'manual',
      placement: 'home_top',
      imageUrl: 'https://example.com/banner.png',
      targetUrl: 'https://example.com',
      adSenseSlot: '',
      active: true,
      startDate: '2026-09-26',
      endDate: '2026-12-31',
      priority: 1,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
