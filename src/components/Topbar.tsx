/**
 * src/components/Topbar.tsx -- BFT QR Pay 3-zone top navigation bar.
 *
 * VERSION: 1.0.0 (initial release)
 */

import React from 'react';
import type { MeResponse, SurfaceRoute } from '../types';

interface TopbarProps {
  activeSurface: SurfaceRoute;
  me: MeResponse;
  onNavigate: (surface: SurfaceRoute) => void;
  onLogout: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  activeSurface,
  me,
  onNavigate,
  onLogout,
}) => {
  const navItems: Array<{ id: SurfaceRoute; label: string; href: string }> = [
    { id: 'rider', label: 'Rider', href: '/' },
    { id: 'scanner', label: 'Fare Validator', href: '/static/scanner.html' },
    { id: 'dashboard', label: 'Analytics', href: '/static/dashboard.html' },
  ];

  const handleLinkClick = (e: React.MouseEvent, surface: SurfaceRoute) => {
    e.preventDefault();
    onNavigate(surface);
  };

  return (
    <header className="bft-topbar text-white shadow-sm no-print">
      <div className="max-w-[1160px] mx-auto px-5 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark (single line) */}
        <a
          href="/"
          onClick={(e) => handleLinkClick(e, 'rider')}
          className="flex items-center gap-3 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffb500] rounded-lg"
        >
          <span className="inline-flex items-center justify-center bg-[var(--yellow)] text-[var(--blue-dark)] font-display font-extrabold text-base px-2.5 py-1 rounded-md tracking-wider">
            BFT
          </span>
          <span className="font-display font-bold text-lg tracking-tight text-white">
            QR Pay
          </span>
        </a>

        {/* Zone 2: Primary navigation links (clean single-line typography) */}
        <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary surfaces">
          {navItems.map((item) => {
            const isActive =
              activeSurface === item.id ||
              (activeSurface === 'receipt' && item.id === 'rider');
            return (
              <a
                key={item.id}
                href={item.href}
                onClick={(e) => handleLinkClick(e, item.id)}
                className={`relative py-1.5 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffb500] ${
                  isActive
                    ? 'text-white'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 right-0 -bottom-[17px] h-[3px] bg-[var(--yellow)] rounded-t-sm"
                  />
                )}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: Primary account action */}
        <div className="flex items-center gap-4 shrink-0">
          {me.signed_in ? (
            <>
              <span className="hidden sm:inline text-xs text-white/85 truncate max-w-[180px]">
                {me.email}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="px-3.5 py-1.5 text-xs font-semibold text-white border border-white/30 rounded-lg hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffb500]"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('rider')}
              className="px-4 py-1.5 text-xs font-bold bg-[var(--yellow)] text-[var(--blue-dark)] rounded-lg hover:brightness-95 transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
