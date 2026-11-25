"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/library", label: "Market library" },
];

export default function NavigationBar() {
  const currentPath = usePathname();

  return (
    <header className="flex h-[60px] items-center justify-between border-b-[3px] border-blue-400 bg-navy-deep px-6">
      <Link href="/" className="text-[1.4rem] font-extrabold italic">
        Odds<span className="text-blue-400">Tracker</span>
      </Link>
      <nav className="flex gap-1.5">
        {navigationLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              currentPath === link.href
                ? "rounded-md bg-blue-400 px-3.5 py-2 text-[0.95rem] font-semibold text-navy-deep"
                : "rounded-md px-3.5 py-2 text-[0.95rem] font-semibold hover:bg-navy-light"
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
