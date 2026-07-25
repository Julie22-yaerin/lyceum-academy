/**
 * Subscription API client for The Lyceum Academy
 * Handles all subscription and billing-related API calls
 */

import { supabase } from './supabase';
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();

export interface SubscriptionPlan {
  id: string;
  tier: 'free' | 'compass' | 'scholar' | 'mentor' | 'researcher';
  billing_cycle: 'monthly' | 'annual';
  price_usd: number;
  voice_minutes_monthly: number | null;
  mind_map_enabled: boolean;
  mind_map_ai_see_document_limit: number | null;
  reference_library_limit: number | null;
  roadmap_regen_daily_limit: number | null;
  daily_tool_call_limit: number | null;
  reverse_build_hint_limit_per_file: number | null;
  daily_upload_limit: number | null;
  ai_queue_priority: number;
  ari_voice_daily_call_limit: number | null;
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

// Feature gating helpers — plan limits are currently disabled app-wide
// (every plan is unlimited); onboarding's plan recommendation/selection
// stays as-is, only enforcement is off. Kept as functions (not deleted) so
// re-enabling later is a one-line change per gate.
export function canUseVoice(_usage: UsageStats): boolean {
  return true;
}

export function canUseMindMap(_plan: SubscriptionPlan): boolean {
  return true;
}

export function canAddReferenceLibraryItem(_usage: UsageStats): boolean {
  return true;
}

export function canRegenerateRoadmap(_usage: UsageStats): boolean {
  return true;
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

// ── Retention (cancel flow, three layers) ───────────────────────────────────
// Backend: app/routers/subscriptions.py retention_* / app/services/retention.py

async function retentionPost<T>(path: string, body?: unknown): Promise<T> {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE}/subscriptions/retention/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Retention request failed (${response.status})`);
  return response.json();
}

/** Cancel flow opened — records the top of the funnel. */
export function recordCancelIntent(): Promise<{ ok: boolean }> {
  return retentionPost('intent');
}

/** Layer 1: accept the 65% save offer. */
export function acceptRetentionDiscount(): Promise<{ ok: boolean; applied: boolean; message?: string }> {
  return retentionPost('discount');
}

/** Layer 2: booked a call — credits the bonus Quanta (once per account). */
export function acceptRetentionCallBonus(): Promise<{ ok: boolean; granted_quanta: number; message?: string }> {
  return retentionPost('call-bonus');
}

/** Layer 3: went through with cancelling. */
export function recordCancellation(reason = ''): Promise<{ ok: boolean }> {
  return retentionPost('cancelled', { reason });
}
