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

// Feature gate hooks
export function useVoiceGate() {
  const { usage, subscription } = useSubscription();

  if (!usage || !subscription) {
    return { canUse: false, remaining: 0, limit: 0 };
  }

  const limit = usage.voice_minutes_limit || Infinity;
  const used = usage.voice_minutes_used;
  const remaining = Math.max(0, limit - used);
  const canUse = usage.voice_minutes_limit === null || used < usage.voice_minutes_limit;

  return { canUse, remaining, limit, used };
}

export function useRoadmapRegenGate() {
  const { usage } = useSubscription();

  if (!usage) {
    return { canUse: false, remaining: 0, limit: 0 };
  }

  const limit = usage.roadmap_regen_daily_limit || Infinity;
  const used = usage.roadmap_regens_today;
  const remaining = Math.max(0, limit - used);
  const canUse = usage.roadmap_regen_daily_limit === null || used < usage.roadmap_regen_daily_limit;

  return { canUse, remaining, limit, used };
}

export function useReferenceLibraryGate() {
  const { usage } = useSubscription();

  if (!usage) {
    return { canUse: false, remaining: 0, limit: 0 };
  }

  const limit = usage.reference_library_limit || Infinity;
  const used = usage.reference_library_count;
  const remaining = Math.max(0, limit - used);
  const canUse = usage.reference_library_limit === null || used < usage.reference_library_limit;

  return { canUse, remaining, limit, used };
}

export function useMindMapGate() {
  const [status, setStatus] = useState<{
    tier: string;
    daily_limit: number | null;
    used_today: number;
    remaining: number | null;
    can_use: boolean;
    reset_at: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const next = await getMindMapStatus();
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return {
    canUse: status?.can_use ?? false,
    tier: status?.tier || 'free',
    used: status?.used_today ?? 0,
    limit: status?.daily_limit ?? null,
    remaining: status?.remaining ?? null,
    resetAt: status?.reset_at ?? null,
    loading,
    refetch: fetchStatus,
  };
}
