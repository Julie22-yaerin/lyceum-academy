import { redirect } from "next/navigation";

// Skip landing page — go straight to the map (Duolingo-style)
export default function HomePage() {
  redirect("/dashboard");
}
