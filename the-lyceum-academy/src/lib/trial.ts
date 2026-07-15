/**
 * 3-day free trial system.
 * Tracks trial start per user via localStorage (keyed by Firebase UID).
 * After 3 days without a paid subscription, the paywall blocks access.
 */

const TRIAL_PREFIX = 'lyceum_trial_started:';
const FREE_CHOSEN_PREFIX = 'lyceum_free_tier_chosen:';
const TRIAL_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Record the trial start timestamp for a user (once). */
export function startTrial(uid: string): void {
  const key = TRIAL_PREFIX + uid;
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, String(Date.now()));
  }
}

/** Get the trial start timestamp (ms epoch) or null if never started. */
export function getTrialStart(uid: string): number | null {
  const raw = localStorage.getItem(TRIAL_PREFIX + uid);
  return raw ? Number(raw) : null;
}

/** Is the 3-day trial still active? */
export function isTrialActive(uid: string): boolean {
  const start = getTrialStart(uid);
  if (!start) return false;
  return (Date.now() - start) < TRIAL_DAYS * MS_PER_DAY;
}

/** Days remaining in trial (float). Negative = expired. */
export function trialDaysRemaining(uid: string): number {
  const start = getTrialStart(uid);
  if (!start) return 0;
  const elapsed = Date.now() - start;
  return TRIAL_DAYS - elapsed / MS_PER_DAY;
}

/** Has the trial ever expired (started and past 3 days)? */
export function hasTrialExpired(uid: string): boolean {
  const start = getTrialStart(uid);
  if (!start) return false;
  return (Date.now() - start) >= TRIAL_DAYS * MS_PER_DAY;
}

/**
 * Record that the user picked "continue with Free" on the paywall — after
 * this, they're let into the app under the Free tier's limits instead of
 * being blocked. Deliberately more restricted than the 3-day trial was.
 */
export function chooseFree(uid: string): void {
  localStorage.setItem(FREE_CHOSEN_PREFIX + uid, '1');
}

export function hasChosenFree(uid: string): boolean {
  return localStorage.getItem(FREE_CHOSEN_PREFIX + uid) === '1';
}

/**
 * Should we show the paywall?
 * True when: trial expired AND no active paid subscription AND the user
 * hasn't already picked the Free tier.
 */
export function shouldShowPaywall(uid: string, hasActiveSubscription: boolean): boolean {
  if (hasActiveSubscription) return false;
  if (hasChosenFree(uid)) return false;
  // If trial hasn't started yet, don't block — start it and let them in
  if (!getTrialStart(uid)) return false;
  return hasTrialExpired(uid);
}
