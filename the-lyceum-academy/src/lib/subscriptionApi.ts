/**
 * Subscription API client for The Lyceum Academy
 * Handles all subscription and billing-related API calls
 */

import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface SubscriptionPlan {
  id: string;
  tier: 'compass' | 'scholar' | 'mentor' | 'researcher';
  billing_cycle: 'monthly' | 'annual';
  price_usd: number;
  voice_minutes_monthly: number | null;
  mind_map_enabled: boolean;
  mind_map_ai_see_document_limit: number | null;
  reference_library_limit: number | null;
  roadmap_regen_daily_limit: number | null;
}

export interface CurrentSubscription {
  tier: string;
  billing_cycle: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  current_period_end: string;
  cancel_at_period_end: boolean;
  voice_minutes_used: number;
  voice_minutes_limit: number | null;
}

export interface UsageStats {
  billing_period_start: string;
  billing_period_end: string;
  voice_minutes_used: number;
  voice_minutes_limit: number | null;
  roadmap_regens_today: number;
  roadmap_regen_daily_limit: number | null;
  reference_library_count: number;
  reference_library_limit: number | null;
}

async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  return session.access_token;
}

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const response = await fetch(`${API_BASE}/subscriptions/plans`);
  if (!response.ok) {
    throw new Error('Failed to fetch subscription plans');
  }
  return response.json();
}

export async function createCheckoutSession(
  planId: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<{ checkout_url: string }> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      plan_id: planId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout session');
  }

  return response.json();
}

export async function getCurrentSubscription(): Promise<CurrentSubscription> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/current`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('NO_SUBSCRIPTION');
    }
    throw new Error('Failed to fetch current subscription');
  }

  return response.json();
}

export async function getUsageStats(): Promise<UsageStats> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/usage`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch usage stats');
  }

  return response.json();
}

export async function createPortalSession(): Promise<{ portal_url: string }> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/portal`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to create portal session');
  }

  return response.json();
}

// Feature gating helpers
export function canUseVoice(usage: UsageStats): boolean {
  if (usage.voice_minutes_limit === null) {
    return true; // Unlimited
  }
  return usage.voice_minutes_used < usage.voice_minutes_limit;
}

export function canUseMindMap(plan: SubscriptionPlan): boolean {
  return plan.mind_map_ai_see_document_limit === null || plan.mind_map_ai_see_document_limit > 0;
}

export function canAddReferenceLibraryItem(usage: UsageStats): boolean {
  if (usage.reference_library_limit === null) {
    return true; // Unlimited
  }
  return usage.reference_library_count < usage.reference_library_limit;
}

export function canRegenerateRoadmap(usage: UsageStats): boolean {
  if (usage.roadmap_regen_daily_limit === null) {
    return true; // Unlimited
  }
  return usage.roadmap_regens_today < usage.roadmap_regen_daily_limit;
}

// Voice usage tracking
export async function startVoiceSession(): Promise<{ session_id: string }> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/voice/start`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to start voice session');
  }

  return response.json();
}

export async function endVoiceSession(sessionId: string): Promise<void> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/voice/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!response.ok) {
    throw new Error('Failed to end voice session');
  }
}

// Feature usage logging
export async function logFeatureUsage(featureType: string, metadata?: Record<string, any>): Promise<void> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}/subscriptions/feature-log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ feature_type: featureType, metadata }),
  });

  if (!response.ok) {
    throw new Error('Failed to log feature usage');
  }
}
