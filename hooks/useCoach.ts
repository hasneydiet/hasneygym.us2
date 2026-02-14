'use client';

import { useAuthCoach } from '@/components/providers/AuthCoachProvider';

/**
 * Backwards-compatible hook wrapper.
 *
 * Historically, many pages/components imported `useCoach()` directly which
 * performed its own auth + RPC work per mount. This was a major contributor to
 * slow initial loads on mobile (duplicate auth calls + coach RPCs).
 *
 * `AuthCoachProvider` now owns the single source of truth; this hook simply
 * exposes the same shape expected by existing code.
 */
export function useCoach() {
  const ctx = useAuthCoach();

  return {
    isCoach: ctx.isCoach,
    userId: ctx.user?.id ?? null,
    email: ctx.user?.email ?? null,
    impersonateUserId: ctx.impersonateUserId,
    effectiveUserId: ctx.effectiveUserId,
    setImpersonateUserId: ctx.setImpersonateUserId,
    // Previous hook exposed `ready` meaning "coach status resolved".
    // Auth may be ready before coach is resolved; keep semantics stable.
    ready: !ctx.loading && ctx.coachReady,
  };
}
