"use client";

import { SessionLink as Link } from "@/components/session-navigation";
import { usePathname } from "next/navigation";
import { Footprints, SunMedium, Settings, Layers } from "lucide-react";
import { cn } from "cn";

const links = [
  { href: "/today", label: "今天", icon: SunMedium },
  { href: "/history", label: "足迹", icon: Footprints },
  { href: "/goals", label: "目标管理", icon: Layers },
  { href: "/settings", label: "设置", icon: Settings },
];
export function PrimaryNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="flex flex-col gap-2">
      {links.map(({ href, label, icon: Icon }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={current ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "hover:bg-accent hover:text-accent-foreground flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              current
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="sidebar-label">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
