/**
 * Pricing page for The Lyceum Academy
 * Displays subscription tiers and handles plan selection
 */

import React, { useState, useEffect } from 'react';
import { getSubscriptionPlans, createCheckoutSession, type SubscriptionPlan } from '../lib/subscriptionApi';
import { useSubscription } from '../lib/useSubscription';

type BillingCycle = 'monthly' | 'annual';

const TIER_NAMES: Record<string, string> = {
  compass: 'Compass',
  scholar: 'Scholar',
  mentor: 'Mentor',
  researcher: 'Researcher',
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  compass: 'Essential tools for focused learning',
  scholar: 'Advanced features for serious students',
  mentor: 'Full access for dedicated learners',
  researcher: 'Unlimited resources for intensive study',
};

export default function PricingView() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const { subscription } = useSubscription();

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const data = await getSubscriptionPlans();
        setPlans(data);
      } catch (error) {
        console.error('Failed to load plans:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPlans();
  }, []);

  const handleSelectPlan = async (planId: string) => {
    setCheckoutLoading(planId);
    try {
      const { checkout_url } = await createCheckoutSession(
        planId,
        `${window.location.origin}/subscription/success`,
        `${window.location.origin}/pricing`
      );
      window.location.href = checkout_url;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      alert('Failed to start checkout. Please try again.');
      setCheckoutLoading(null);
    }
  };

  const filteredPlans = plans.filter((plan) => plan.billing_cycle === billingCycle);
  const tierOrder = ['compass', 'scholar', 'mentor', 'researcher'];
  const sortedPlans = filteredPlans.sort(
    (a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading pricing...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
          <p className="text-xl text-gray-600">Unlock your learning potential with The Lyceum Academy</p>
        </div>

        {/* Billing cycle toggle */}
        <div className="flex justify-center mb-12">
          <div className="bg-white rounded-lg p-1 shadow-sm">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-md font-medium transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-6 py-2 rounded-md font-medium transition-colors ${
                billingCycle === 'annual'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Annual
              <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                Save 17%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {sortedPlans.map((plan) => {
            const isCurrentPlan =
              subscription?.tier === plan.tier && subscription?.billing_cycle === plan.billing_cycle;

            return (
              <div
                key={plan.id}
                className={`bg-white rounded-lg shadow-md overflow-hidden ${
                  plan.tier === 'mentor' ? 'border-2 border-blue-500 relative' : ''
                }`}
              >
                {plan.tier === 'mentor' && (
                  <div className="absolute top-0 right-0 bg-blue-500 text-white px-3 py-1 text-xs font-semibold">
                    POPULAR
                  </div>
                )}

                <div className="p-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    {TIER_NAMES[plan.tier]}
                  </h3>
                  <p className="text-gray-600 text-sm mb-4">{TIER_DESCRIPTIONS[plan.tier]}</p>

                  <div className="mb-6">
                    <span className="text-4xl font-bold text-gray-900">
                      ${plan.price_usd.toFixed(2)}
                    </span>
                    <span className="text-gray-600">
                      /{billingCycle === 'monthly' ? 'mo' : 'yr'}
                    </span>
                  </div>

                  <ul className="space-y-3 mb-6">
                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm text-gray-700">
                        {plan.voice_minutes_monthly === null
                          ? 'Unlimited voice ARI'
                          : `${plan.voice_minutes_monthly} min voice ARI/month`}
                      </span>
                    </li>

                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm text-gray-700">
                        {plan.mind_map_ai_see_document_limit === null
                          ? 'Unlimited AI mind map checks'
                          : `${plan.mind_map_ai_see_document_limit} AI mind map checks per problem set`}
                      </span>
                    </li>

                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm text-gray-700">
                        {plan.reference_library_limit === null
                          ? 'Unlimited references'
                          : `${plan.reference_library_limit} references`}
                      </span>
                    </li>

                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm text-gray-700">Unlimited chat & exercises</span>
                    </li>
                  </ul>

                  <button
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={checkoutLoading === plan.id || isCurrentPlan}
                    className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
                      isCurrentPlan
                        ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                        : plan.tier === 'mentor'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-800 text-white hover:bg-gray-900'
                    }`}
                  >
                    {checkoutLoading === plan.id
                      ? 'Loading...'
                      : isCurrentPlan
                      ? 'Current Plan'
                      : 'Select Plan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Feature comparison note */}
        <div className="mt-12 text-center text-gray-600">
          <p className="text-sm">
            All plans include unlimited chat, exercises, mistake bank, and notes.
          </p>
          <p className="text-sm mt-2">
            Need help choosing? Contact us at support@thelyceumacademy.com
          </p>
        </div>
      </div>
    </div>
  );
}
