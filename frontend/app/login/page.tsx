import { Suspense } from "react";

import LoginClient from "./login-client";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
          Loading...
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
