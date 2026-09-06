"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "../next-nav-items";

// No i18n module yet (spec 2.6 lands with packet 2); one map holds the
// English text so the items stay keyed from the day they are written.
const LABELS: Record<string, string> = { "nav.group.runs": "Runs", "nav.runs": "All runs" };

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <ul className="menu menu-sm w-full gap-0.5 p-0">
      {NAV_GROUPS.map((group) => (
        <li key={group.key}>
          <details open>
            <summary className="font-mono text-[11px] uppercase tracking-[.08em]">{LABELS[group.labelKey]}</summary>
            <ul>
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className={`min-h-11 sm:min-h-0 ${pathname === item.href ? "menu-active" : ""}`}>
                    <item.icon size={14} aria-hidden="true" />
                    {LABELS[item.labelKey]}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
