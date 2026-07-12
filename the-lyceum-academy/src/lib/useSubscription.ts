/**
 * React hook for subscription management
 * Provides subscription state, usage stats, and feature gates
 */

import { useState, useEffect } from 'react';
import { getMindMapStatus } from './api';
import {
  getCurrentSubscription,
  getUsageStats,
  type CurrentSubscription,
  type UsageStats,
} from './subscriptionApi';

interface SubscriptionState {
  subscription: CurrentSubscription | null;
  usage: UsageStats | null;
  loading: boolean;
  error: string | null;
  hasActiveSubscription: boolean;
  refetch: () => Promise<void>;
}

export function useSubscription(): SubscriptionState {
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [subData, usageData] = await Promise.all([
        getCurrentSubscription().catch((err) => {
          if (err.message === 'NO_SUBSCRIPTION') {
            return null;
          }
          throw err;
        }),
        getUsageStats().catch(() => null),
      ]);

      setSubscription(subData);
      setUsage(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription');
      setSubscription(null);
      setUsage(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    subscription,
    usage,
    loading,
    error,
    hasActiveSubscription: subscription !== null && subscription.status === 'active',
    refetch: fetchData,
  };
}

// Feature gate hooks — plan limits are currently disabled app-wide, so
// these always report canUse: true / limit: Infinity regardless of
// subscription state. This also fixes the previous default (canUse: false
// whenever there was no matching Stripe subscription row — the common case
// for every Firebase-authed user, since checkout is a separate PayPal flow
// in onboarding) which was blocking real users by accident. Real usage
// counts are still surfaced where available, only the limits are off.
export function useVoiceGate() {
  const { usage } = useSubscription();
  const used = usage?.voice_minutes_used ?? 0;
  return { canUse: true, remaining: Infinity, limit: Infinity, used };
}

export function useRoadmapRegenGate() {
  const { usage } = useSubscription();
  const used = usage?.roadmap_regens_today ?? 0;
  return { canUse: true, remaining: Infinity, limit: Infinity, used };
}

export function useReferenceLibraryGate() {
  const { usage } = useSubscription();
  const used = usage?.reference_library_count ?? 0;
  return { canUse: true, remaining: Infinity, limit: Infinity, used };
}

export function useMindMapGate(documentId = '') {
  const [status, setStatus] = useState<{
    tier: string;
    document_limit: number | null;
    used_in_document: number;
    remaining: number | null;
    can_use: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const next = await getMindMapStatus(documentId);
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  return {
    canUse: status?.can_use ?? false,
    tier: status?.tier || 'free',
    used: status?.used_in_document ?? 0,
    limit: status?.document_limit ?? null,
    remaining: status?.remaining ?? null,
    loading,
    refetch: fetchStatus,
  };
}
