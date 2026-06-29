"use client";

import { FirebaseAnalyticsProvider } from "@/components/providers/firebase-analytics";
import { FirebaseAuthProvider } from "@/components/providers/firebase-auth";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <FirebaseAnalyticsProvider />
      {children}
    </FirebaseAuthProvider>
  );
}

