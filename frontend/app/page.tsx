import Link from "next/link";
import { SplineSceneBasic } from "@/components/ui/demo";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center gap-8 p-6">
      <SplineSceneBasic />
      <Link
        href="/dashboard"
        className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
      >
        Get Started
      </Link>
    </main>
  );
}
