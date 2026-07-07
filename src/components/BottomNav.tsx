"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/home", label: "Mixers", icon: "🥂" },
  { href: "/groups", label: "Groups", icon: "👥" },
  { href: "/profile", label: "Profile", icon: "🌟" },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <>
      <div className="h-20" />
      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-neutral-100 bg-white/95 backdrop-blur">
        <div className="grid grid-cols-3">
          {TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-3 text-xs font-semibold ${
                  active ? "text-brand-600" : "text-neutral-400"
                }`}
              >
                <span className="text-xl">{tab.icon}</span>
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
