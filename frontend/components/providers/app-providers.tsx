"use client";

import { FirebaseAnalyticsProvider } from "@/components/providers/firebase-analytics";
import { FirebaseAuthProvider } from "@/components/providers/firebase-auth";
import { FeedbackWidget } from "@/components/ui/feedback-widget";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <FirebaseAnalyticsProvider />
      {children}
      <FeedbackWidget context="app" />
    </FirebaseAuthProvider>
  );
}

