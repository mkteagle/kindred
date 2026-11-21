"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LIBRARY_ICON_PATHS, NavIcon } from "@/components/kx/icons";
import { useUser } from "@/lib/use-user";

const sections = [
  { path: "/settings", title: "Account", icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" },
  { path: "/settings/household", title: "Household", icon: LIBRARY_ICON_PATHS.people },
  { path: "/settings/appearance", title: "Appearance", icon: "M20 15a8 8 0 0 1-11-11 9 9 0 1 0 11 11Z" },
  { path: "/settings/library", title: "Library", icon: LIBRARY_ICON_PATHS.allPhotos },
  { path: "/settings/backup", title: "Backup & Sync", icon: "M20 7v5h-5 M4 17v-5h5 M20 12a8 8 0 0 0-14-5 M4 12a8 8 0 0 0 14 5" },
  { path: "/settings/storage", title: "Storage", icon: "M3 7h18v12H3z M6 15h.01 M10 15h.01" },
  { path: "/settings/notifications", title: "Notifications", icon: "M5 16h14l-2-4V9a5 5 0 1 0-10 0v3l-2 4Z M10 20h4" },
  { path: "/settings/advanced", title: "Advanced", icon: "M8 6l-6 6 6 6m8-12 6 6-6 6m-2-15-4 18", admin: true },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { isAdmin } = useUser();
  return <div className="kx-page kx-settings-page">
    <h1 className="kx-title">Settings</h1>
    <div className="kx-settings-frame">
      <nav className="kx-settings-nav" aria-label="Settings sections">
        {sections.filter(section => !section.admin || isAdmin).map(({ path: href, title, icon }) => {
          const selected = href === "/settings" ? path === href : path === href || path.startsWith(`${href}/`);
          return <Link href={href} key={href} aria-current={selected ? "page" : undefined}>
            <NavIcon d={icon} size={19} /> {title}
          </Link>;
        })}
      </nav>
      <div className="kx-settings-panel">{children}</div>
    </div>
  </div>;
}
