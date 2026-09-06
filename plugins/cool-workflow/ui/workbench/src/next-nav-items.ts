import { ListChecks, type LucideIcon } from "lucide-react";

export type NavItem = { key: string; href: string; icon: LucideIcon; labelKey: string };
export type NavGroup = { key: string; labelKey: string; items: NavItem[] };

// One group for now; packet 2 adds the rest as pages land.
export const NAV_GROUPS: NavGroup[] = [
  { key: "runs", labelKey: "nav.group.runs", items: [{ key: "runs", href: "/", icon: ListChecks, labelKey: "nav.runs" }] },
];
