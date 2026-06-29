"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useFirebaseAuth } from "@/components/providers/firebase-auth";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useFirebaseAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = encodeURIComponent(pathname || "/dashboard");
      router.replace(`/login?next=${next}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
        Checking authentication...
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}

