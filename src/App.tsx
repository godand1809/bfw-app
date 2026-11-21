/**
 * src/App.tsx -- Root application shell & surface router for BFT QR Pay.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * Coordinates all four BFT QR Pay surfaces:
 *   - Rider app           (/ or /?stop=CODE)
 *   - Fare validator      (/scanner or /static/scanner.html)
 *   - Analytics dashboard (/dashboard or /static/dashboard.html)
 *   - Printable receipt   (/receipt?id=... or /static/receipt.html?id=...)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api, clearSessionToken, setSessionToken } from './api';
import { DashboardView } from './components/DashboardView';
import { ReceiptView } from './components/ReceiptView';
import { RiderView } from './components/RiderView';
import { ScannerView } from './components/ScannerView';
import { Topbar } from './components/Topbar';
import type {
  CatalogResponse,
  MeResponse,
  SurfaceRoute,
  TicketItem,
  TransactionItem,
} from './types';

function parseLocation(): {
  surface: SurfaceRoute;
  stopCode: string | null;
  receiptId: string | null;
} {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);

  if (path.includes('scanner')) {
    return { surface: 'scanner', stopCode: null, receiptId: null };
  }
  if (path.includes('dashboard')) {
    return { surface: 'dashboard', stopCode: null, receiptId: null };
  }
  if (path.includes('receipt')) {
    return { surface: 'receipt', stopCode: null, receiptId: params.get('id') };
  }
  return {
    surface: 'rider',
    stopCode: params.get('stop'),
    receiptId: null,
  };
}

export function App() {
  const initial = parseLocation();
  const [surface, setSurface] = useState<SurfaceRoute>(initial.surface);
  const [stopParam, setStopParam] = useState<string | null>(initial.stopCode);
  const [receiptId, setReceiptId] = useState<string | null>(initial.receiptId);
  const [pendingScannerPayload, setPendingScannerPayload] = useState<string | null>(null);

  const [me, setMe] = useState<MeResponse>({ signed_in: false });
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [receipts, setReceipts] = useState<TransactionItem[]>([]);
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);

  const pushUrl = useCallback((url: string) => {
    try {
      window.history.pushState({}, '', url);
    } catch {
      // ignore in sandboxed iframes if pushState is restricted
    }
  }, []);

  const refreshRiderData = useCallback(async () => {
    try {
      const account = await api<MeResponse>('/api/me');
      setMe(account);
      if (account.signed_in) {
        await api('/api/tickets/expire-sweep', { method: 'POST' });
        const [ticketRes, receiptRes] = await Promise.all([
          api<{ tickets: TicketItem[] }>('/api/tickets'),
          api<{ receipts: TransactionItem[] }>('/api/receipts'),
        ]);
        setTickets(ticketRes.tickets);
        setReceipts(receiptRes.receipts);
      } else {
        setTickets([]);
        setReceipts([]);
      }
    } catch (err) {
      console.error('Failed to refresh rider session:', err);
    }
  }, []);

  // Boot: load catalog + current session
  useEffect(() => {
    api<CatalogResponse>('/api/catalog')
      .then(setCatalog)
      .catch((err) => console.error('Failed to load catalog:', err));
    void refreshRiderData();
  }, [refreshRiderData]);

  // Listen to browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const next = parseLocation();
      setSurface(next.surface);
      setStopParam(next.stopCode);
      setReceiptId(next.receiptId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleNavigate = useCallback(
    (target: SurfaceRoute) => {
      setSurface(target);
      if (target === 'rider') {
        pushUrl('/');
        void refreshRiderData();
      } else if (target === 'scanner') {
        pushUrl('/static/scanner.html');
      } else if (target === 'dashboard') {
        pushUrl('/static/dashboard.html');
        setAnalyticsRefresh((n) => n + 1);
      }
    },
    [pushUrl, refreshRiderData],
  );

  const handleSignedIn = useCallback(
    async (token: string) => {
      setSessionToken(token);
      await refreshRiderData();
      setAnalyticsRefresh((n) => n + 1);
    },
    [refreshRiderData],
  );

  const handleLogout = useCallback(async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      // clear local state regardless
    }
    clearSessionToken();
    setMe({ signed_in: false });
    setTickets([]);
    setReceipts([]);
    setSurface('rider');
    pushUrl('/');
  }, [pushUrl]);

  const handleOpenReceipt = useCallback(
    (id: string) => {
      setReceiptId(id);
      setSurface('receipt');
      pushUrl(`/static/receipt.html?id=${encodeURIComponent(id)}`);
    },
    [pushUrl],
  );

  const handleTestPayloadInScanner = useCallback(
    (payload: string) => {
      setPendingScannerPayload(payload);
      setSurface('scanner');
      pushUrl('/static/scanner.html');
    },
    [pushUrl],
  );

  const handleSimulateStopScan = useCallback(
    (code: string) => {
      setStopParam(code);
      setSurface('rider');
      pushUrl(`/?stop=${encodeURIComponent(code)}`);
    },
    [pushUrl],
  );

  const handleValidationRecorded = useCallback(() => {
    setAnalyticsRefresh((n) => n + 1);
    void refreshRiderData();
  }, [refreshRiderData]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <Topbar
        activeSurface={surface}
        me={me}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      <main className="flex-1">
        {surface === 'rider' && (
          <RiderView
            me={me}
            catalog={catalog}
            tickets={tickets}
            receipts={receipts}
            stopParam={stopParam}
            onClearStopParam={() => {
              setStopParam(null);
              pushUrl('/');
            }}
            onSignedIn={handleSignedIn}
            onRefreshRiderData={async () => {
              await refreshRiderData();
              setAnalyticsRefresh((n) => n + 1);
            }}
            onOpenReceipt={handleOpenReceipt}
            onTestPayloadInScanner={handleTestPayloadInScanner}
          />
        )}

        {surface === 'scanner' && (
          <ScannerView
            catalog={catalog}
            initialPayload={pendingScannerPayload}
            onConsumeInitialPayload={() => setPendingScannerPayload(null)}
            onSimulateStopScan={handleSimulateStopScan}
            onValidationRecorded={handleValidationRecorded}
          />
        )}

        {surface === 'dashboard' && <DashboardView refreshSignal={analyticsRefresh} />}

        {surface === 'receipt' && (
          <ReceiptView
            receiptId={receiptId}
            me={me}
            onBackToRider={() => handleNavigate('rider')}
          />
        )}
      </main>

      <footer className="no-print border-t border-[var(--border)] bg-white/70 mt-10">
        <div className="max-w-[1160px] mx-auto px-5 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span>
            Ben Franklin Transit · Serving Kennewick, Pasco &amp; Richland, WA · bft.org
          </span>
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--blue)] hover:underline font-medium"
          >
            API Endpoint Index
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
