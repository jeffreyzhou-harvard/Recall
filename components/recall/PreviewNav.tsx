"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PreviewNav() {
  const pathname = usePathname();
  return <nav className="recall-preview-nav" aria-label="Design preview pages">
    <span>Design previews</span>
    <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Susan’s call</Link>
    <Link href="/caregiver" aria-current={pathname === "/caregiver" || pathname === "/family" ? "page" : undefined}>Caregiver view</Link>
    <Link href="/onboarding" aria-current={pathname === "/onboarding" ? "page" : undefined}>Setup</Link>
    <Link href="/revisit" aria-current={pathname === "/revisit" ? "page" : undefined}>Next conversation</Link>
  </nav>;
}
