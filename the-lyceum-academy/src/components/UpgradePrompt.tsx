/**
 * Upgrade prompt component
 * Shown when users hit subscription limits
 */

import React from 'react';
import { ARI_COPY, detectLocale } from '../lib/locale';

interface UpgradePromptProps {
  feature: 'voice' | 'mindmap' | 'reference' | 'roadmap';
  currentTier?: string;
  onClose?: () => void;
}

const FEATURE_MESSAGES = {
  voice: {
    title: 'Voice ARI Limit Reached',
    description: 'You\'ve used all your voice minutes for this month. Upgrade to get more!',
    icon: '🎙️',
  },
  mindmap: {
    title: 'Daily Mind Map Limit Reached',
    description: 'Your daily AI mind map checks are used up for today. Free users get 2/day, Compass users get 6/day, and higher tiers get unlimited checks.',
    icon: '🧠',
  },
  reference: {
    title: 'Reference Library Full',
    description: 'You\'ve reached your reference library limit. Upgrade for more storage!',
    icon: '📚',
  },
  roadmap: {
    title: 'Daily Roadmap Limit Reached',
    description: 'You\'ve regenerated your roadmap the maximum times today. Upgrade for unlimited regenerations!',
    icon: '🗺️',
  },
};

const RECOMMENDED_TIERS = {
  voice: ['scholar', 'mentor', 'researcher'],
  mindmap: ['scholar', 'mentor', 'researcher'],
  reference: ['mentor', 'researcher'],
  roadmap: ['mentor', 'researcher'],
};

export default function UpgradePrompt({ feature, currentTier = 'compass', onClose }: UpgradePromptProps) {
  const locale = detectLocale();
  const message = FEATURE_MESSAGES[feature];
  const recommendedTiers = RECOMMENDED_TIERS[feature];

  const handleUpgrade = () => {
    window.location.href = '/pricing';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Icon */}
        <div className="text-center mb-4">
          <div className="text-6xl mb-4">{message.icon}</div>
          <h2 className="text-2xl font-bold text-gray-900">
            {feature === 'voice' ? ARI_COPY[locale].voiceLimitTitle : message.title}
          </h2>
        </div>

        {/* Description */}
        <p className="text-gray-600 text-center mb-6">
          {feature === 'voice' ? ARI_COPY[locale].voiceLimitDescription : message.description}
        </p>

        {/* Recommended upgrade */}
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-blue-900 mb-2">Recommended Plans:</p>
          <div className="space-y-1">
            {recommendedTiers.map((tier) => (
              <div key={tier} className="flex items-center text-sm text-blue-800">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="capitalize">{tier}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
            >
              Not Now
            </button>
          )}
          <button
            onClick={handleUpgrade}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
          >
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
}
