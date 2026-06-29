"use client";

import { useEffect } from "react";
import { getAnalytics, isSupported } from "firebase/analytics";

import { firebaseApp } from "@/lib/firebase/client";

export function FirebaseAnalyticsProvider() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) return;
    isSupported().then((supported) => {
      if (supported) getAnalytics(firebaseApp);
    });
  }, []);

  return null;
}
