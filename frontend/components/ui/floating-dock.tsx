"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, GitBranch, Beaker, BookOpen, AlertTriangle } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "The Nexus", icon: LayoutDashboard },
  { href: "/topic-map", label: "Lyceum Knowledge Tree", icon: GitBranch },
  { href: "/psets/demo", label: "Chemical Analysis Lab", icon: Beaker },
  { href: "/psets/demo", label: "Feynman Notes", icon: BookOpen },
  { href: "/dashboard", label: "Mistake Bank", icon: AlertTriangle },
];

export function FloatingDock() {
  const pathname = usePathname();

  return (
    <nav className="fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-3 rounded-2xl dock px-2 py-4">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`dock-item ${isActive ? "active" : ""}`}
            title={item.label}
          >
            <Icon className="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}
