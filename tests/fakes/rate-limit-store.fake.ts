import type { RateLimitStore } from '@/lib/rate-limit';

interface StoredEvent {
  id: string;
  profileId: string | null;
  ipHash: string;
  eventType: string;
  createdAt: Date;
}

export function createInMemoryRateLimitStore(): RateLimitStore {
  const events: StoredEvent[] = [];
  let nextId = 1;

  return {
    async countEventsSince({ profileId, ipHash, eventType, since }) {
      return events.filter((e) => {
        if (e.eventType !== eventType) return false;
        if (e.createdAt < since) return false;
        if (profileId !== undefined && e.profileId !== profileId) return false;
        if (ipHash !== undefined && e.ipHash !== ipHash) return false;
        return true;
      }).length;
    },
    async recordEvent({ profileId, ipHash, eventType, createdAt }) {
      events.push({ id: `event-${nextId++}`, profileId, ipHash, eventType, createdAt: createdAt ?? new Date() });
    },
    // Deliberately synchronous between the count and the push (no `await`
    // in between) so that concurrent calls against this fake behave the
    // way the real Postgres function's advisory-lock-guarded transaction
    // does: one caller's check-then-insert can never interleave with
    // another's. This is what tests/unit/lib/rate-limit.test.ts's
    // concurrent-call test relies on to prove the composition is race-safe.
    async checkAndRecordAtomically({ profileId, ipHash, eventType, profileLimit, ipLimit, windowStart, now }) {
      const profileCount = events.filter(
        (e) => e.eventType === eventType && e.createdAt >= windowStart && e.profileId === profileId
      ).length;
      if (profileCount >= profileLimit) {
        return { allowed: false, reason: 'profile_limit' };
      }

      const ipCount = events.filter(
        (e) => e.eventType === eventType && e.createdAt >= windowStart && e.ipHash === ipHash
      ).length;
      if (ipCount >= ipLimit) {
        return { allowed: false, reason: 'ip_limit' };
      }

      const id = `event-${nextId++}`;
      events.push({ id, profileId, ipHash, eventType, createdAt: now });
      return { allowed: true, eventId: id };
    },
    async releaseEvent(eventId) {
      const index = events.findIndex((e) => e.id === eventId);
      if (index !== -1) {
        events.splice(index, 1);
      }
    },
  };
}
