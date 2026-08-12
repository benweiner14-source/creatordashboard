import type { RateLimitStore } from '@/lib/rate-limit';

interface StoredEvent {
  profileId: string | null;
  ipHash: string;
  eventType: string;
  createdAt: Date;
}

export function createInMemoryRateLimitStore(): RateLimitStore {
  const events: StoredEvent[] = [];

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
      events.push({ profileId, ipHash, eventType, createdAt: createdAt ?? new Date() });
    },
  };
}
