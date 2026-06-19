/**
 * App shell layout.
 * Sidebar navigation on desktop, bottom tab bar on mobile.
 */

import { Link, useLocation } from "wouter";
import { FileOutput, Layers, Minimize2, ScanText, Zap } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Zap },
  { href: "/convert", label: "Convert", icon: FileOutput },
  { href: "/merge", label: "Merge", icon: Layers },
  { href: "/compress", label: "Compress", icon: Minimize2 },
  { href: "/ocr", label: "OCR", icon: ScanText },
] as const;

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-white dark:bg-[#0F0F0F] flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-52 border-r border-[#E5E5E0] dark:border-[#2A2A2A] p-4 gap-1 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-2 py-3 mb-4">
          <div className="w-7 h-7 rounded-lg bg-accent dark:bg-accent-dark flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-[#111111] dark:text-[#F0F0EE]">
            DocForge
          </span>
        </div>

        {/* Nav links */}
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-accent/10 dark:bg-accent-dark/10 text-accent dark:text-accent-dark font-medium"
                  : "text-[#6B6B65] dark:text-[#888880] hover:bg-[#F9F9F7] dark:hover:bg-[#1A1A1A] hover:text-[#111111] dark:hover:text-[#F0F0EE]",
              ].join(" ")}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-screen">
        <div className="flex-1 w-full max-w-content mx-auto px-6 py-8">
          {children}
        </div>
      </main>

      {/* Bottom tab bar — mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-[#E5E5E0] dark:border-[#2A2A2A] bg-white dark:bg-[#0F0F0F] flex justify-around px-2 py-2 z-50">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] transition-colors",
                active
                  ? "text-accent dark:text-accent-dark"
                  : "text-[#6B6B65] dark:text-[#888880]",
              ].join(" ")}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
