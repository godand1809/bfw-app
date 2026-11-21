/**
 * src/components/RiderView.tsx -- Rider application surface.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * Tabs: Wallet | Buy Fare | My Tickets | Receipts
 * Also supports stop-poster QR deep links (?stop=CODE).
 */

import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  CreditCard,
  MapPin,
  QrCode,
  Receipt,
  Ticket as TicketIcon,
  Wallet,
} from 'lucide-react';
import { api, formatMoney, formatTimestamp } from '../api';
import type {
  CatalogResponse,
  MeResponse,
  TicketItem,
  TransactionItem,
  TransitStop,
} from '../types';

type RiderTab = 'wallet' | 'buy' | 'tickets' | 'receipts';

interface RiderViewProps {
  me: MeResponse;
  catalog: CatalogResponse | null;
  tickets: TicketItem[];
  receipts: TransactionItem[];
  stopParam: string | null;
  onClearStopParam: () => void;
  onSignedIn: (token: string) => Promise<void>;
  onRefreshRiderData: () => Promise<void>;
  onOpenReceipt: (receiptId: string) => void;
  onTestPayloadInScanner: (payload: string) => void;
}

interface Notice {
  kind: 'success' | 'error' | 'info';
  message: string;
  receiptId?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export const RiderView: React.FC<RiderViewProps> = ({
  me,
  catalog,
  tickets,
  receipts,
  stopParam,
  onClearStopParam,
  onSignedIn,
  onRefreshRiderData,
  onOpenReceipt,
  onTestPayloadInScanner,
}) => {
  const [activeTab, setActiveTab] = useState<RiderTab>('wallet');
  const [emailInput, setEmailInput] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Wallet top-up state
  const [topupCents, setTopupCents] = useState<number>(1000);
  const [customDollars, setCustomDollars] = useState<string>('');
  const [cardLast4, setCardLast4] = useState<string>('4242');
  const [toppingUp, setToppingUp] = useState(false);

  // Buy fare state
  const [reducedFare, setReducedFare] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  // Feedback banner & copy indicator
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Stop deep-link info
  const [stopInfo, setStopInfo] = useState<TransitStop | null>(null);

  useEffect(() => {
    if (!stopParam || !me.signed_in) {
      setStopInfo(null);
      return;
    }
    let cancelled = false;
    api<TransitStop>(`/api/stop/${encodeURIComponent(stopParam)}`)
      .then((stop) => {
        if (!cancelled) {
          setStopInfo(stop);
          setActiveTab('buy');
        }
      })
      .catch(() => {
        if (!cancelled) setStopInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stopParam, me.signed_in]);

  const handleSignIn = async (e: React.FormEvent, overrideEmail?: string) => {
    e.preventDefault();
    const targetEmail = (overrideEmail ?? emailInput).trim();
    if (!targetEmail) {
      setAuthError('Enter an email address to continue.');
      return;
    }
    setAuthError(null);
    setSigningIn(true);
    try {
      const res = await api<{ ok: boolean; session_token: string }>('/api/session', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail }),
      });
      await onSignedIn(res.session_token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSigningIn(false);
    }
  };

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const trimmedLast4 = cardLast4.trim();
    if (!/^\d{4}$/.test(trimmedLast4)) {
      setNotice({ kind: 'error', message: 'Enter the 4-digit card suffix (e.g. 4242).' });
      return;
    }

    let amountToSend = topupCents;
    if (customDollars.trim() !== '') {
      const parsed = Math.round(Number(customDollars) * 100);
      if (!Number.isFinite(parsed) || parsed < 100 || parsed > 20000) {
        setNotice({ kind: 'error', message: 'Custom amount must be between $1.00 and $200.00.' });
        return;
      }
      amountToSend = parsed;
    }

    setToppingUp(true);
    try {
      const out = await api<{ ok: boolean; wallet_cents: number; receipt_id: string }>(
        '/api/topup',
        {
          method: 'POST',
          body: JSON.stringify({ amount_cents: amountToSend, card_last4: trimmedLast4 }),
        },
      );
      await onRefreshRiderData();
      setCustomDollars('');
      setNotice({
        kind: 'success',
        message: `Added ${formatMoney(amountToSend)} to your BFT wallet. New balance: ${formatMoney(out.wallet_cents)}.`,
        receiptId: out.receipt_id,
      });
    } catch (err) {
      setNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Top-up failed.',
      });
    } finally {
      setToppingUp(false);
    }
  };

  const handlePurchase = async () => {
    if (!selectedCode) return;
    setNotice(null);
    setPurchasing(true);
    try {
      const out = await api<{
        ok: boolean;
        wallet_cents: number;
        receipt_id: string;
        ticket: TicketItem;
      }>('/api/purchase', {
        method: 'POST',
        body: JSON.stringify({ product_code: selectedCode, reduced: reducedFare }),
      });
      await onRefreshRiderData();
      setActiveTab('tickets');
      setNotice({
        kind: 'success',
        message: `Purchased ${out.ticket.product_name}. Receipt ${out.receipt_id} issued — your scannable QR ticket is ready below.`,
        receiptId: out.receipt_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Purchase failed.';
      setNotice({
        kind: 'error',
        message,
        actionLabel: message.toLowerCase().includes('insufficient') ? 'Add Funds in Wallet' : undefined,
        onAction: message.toLowerCase().includes('insufficient')
          ? () => {
              setActiveTab('wallet');
              setNotice(null);
            }
          : undefined,
      });
    } finally {
      setPurchasing(false);
    }
  };

  const handleCopyPayload = async (ticket: TicketItem) => {
    try {
      await navigator.clipboard.writeText(ticket.qr_payload);
      setCopiedId(ticket.id);
      setTimeout(() => setCopiedId((cur) => (cur === ticket.id ? null : cur)), 1800);
    } catch {
      setNotice({ kind: 'info', message: `Payload: ${ticket.qr_payload}` });
    }
  };

  // ---------------- Signed-Out View ----------------
  if (!me.signed_in) {
    return (
      <div className="max-w-[1160px] mx-auto px-5 py-12">
        <div className="max-w-[460px] mx-auto bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-7 shadow-xs">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="inline-flex items-center justify-center bg-[var(--yellow)] text-[var(--blue-dark)] font-display font-extrabold text-xs px-2 py-0.5 rounded">
              BFT
            </span>
            <span className="text-xs font-medium text-[var(--muted)]">
              Ben Franklin Transit · Tri-Cities, WA
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--blue-dark)] tracking-tight mb-2">
            Sign in to BFT QR Pay
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed mb-6">
            Enter any email address to open or create your rider wallet, purchase 2025 BFT fares,
            and board with a tamper-proof QR ticket.
          </p>

          {authError && (
            <div className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[#fbe9e7] px-3.5 py-2.5 text-sm font-medium text-[var(--danger)]">
              {authError}
            </div>
          )}

          <form onSubmit={(e) => handleSignIn(e)} className="space-y-4">
            <div>
              <label
                htmlFor="rider-email"
                className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
              >
                Email address
              </label>
              <input
                id="rider-email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
              />
            </div>

            <button
              type="submit"
              disabled={signingIn}
              className="w-full py-2.5 px-4 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--muted)] mb-2.5">
              Quick demo accounts (pre-seeded history or fresh rider):
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={(e) => handleSignIn(e, 'rider1@example.com')}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--blue)] bg-[#f2f5f8] hover:bg-[#e5edf5] rounded-lg transition-colors cursor-pointer"
              >
                rider1@example.com
              </button>
              <button
                type="button"
                onClick={(e) => handleSignIn(e, 'commuter@tricities.org')}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--blue)] bg-[#f2f5f8] hover:bg-[#e5edf5] rounded-lg transition-colors cursor-pointer"
              >
                commuter@tricities.org
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Signed-In Rider App ----------------
  const activeTicketsCount = tickets.filter((t) => t.status === 'active').length;
  const selectedProduct = catalog?.products.find((p) => p.code === selectedCode) ?? null;
  const selectedPrice = selectedProduct
    ? reducedFare
      ? selectedProduct.reduced_price_cents
      : selectedProduct.price_cents
    : 0;
  const walletCents = me.wallet_cents ?? 0;

  return (
    <div className="max-w-[1160px] mx-auto px-5 py-6 space-y-5">
      {/* Stop Poster Deep-Link Banner (?stop=CODE) */}
      {stopInfo && (
        <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--blue)]/30 bg-[#e8f2fc] px-4 py-3.5 text-sm text-[var(--blue-dark)]">
          <div className="flex items-center gap-3">
            <MapPin className="w-5 h-5 text-[var(--blue)] shrink-0" />
            <div>
              <span className="font-semibold">
                Scanned stop poster: {stopInfo.name} ({stopInfo.code}).
              </span>{' '}
              Buy a fare below, then show your QR ticket when boarding any BFT route.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setStopInfo(null);
              onClearStopParam();
            }}
            className="text-xs font-semibold text-[var(--blue)] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Inline Feedback Notice */}
      {notice && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border px-4 py-3 text-sm font-medium ${
            notice.kind === 'success'
              ? 'bg-[#e3f4e9] border-[var(--ok)]/40 text-[var(--ok)]'
              : notice.kind === 'error'
                ? 'bg-[#fbe9e7] border-[var(--danger)]/40 text-[var(--danger)]'
                : 'bg-[#e3eefb] border-[var(--blue)]/40 text-[var(--blue)]'
          }`}
        >
          <span>{notice.message}</span>
          <div className="flex items-center gap-3 shrink-0">
            {notice.receiptId && (
              <button
                type="button"
                onClick={() => onOpenReceipt(notice.receiptId!)}
                className="underline font-semibold cursor-pointer whitespace-nowrap"
              >
                View receipt {notice.receiptId}
              </button>
            )}
            {notice.actionLabel && notice.onAction && (
              <button
                type="button"
                onClick={notice.onAction}
                className="underline font-semibold cursor-pointer whitespace-nowrap"
              >
                {notice.actionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-xs opacity-75 hover:opacity-100 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Rider Sub-Navigation Tabs + Wallet Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="inline-flex items-center gap-1 p-1 bg-[#e4ebf2] rounded-xl"
          role="tablist"
          aria-label="Rider sections"
        >
          {(
            [
              { id: 'wallet', label: 'Wallet', icon: Wallet },
              { id: 'buy', label: 'Buy Fare', icon: CreditCard },
              {
                id: 'tickets',
                label: `My Tickets (${activeTicketsCount})`,
                icon: QrCode,
              },
              {
                id: 'receipts',
                label: `Receipts (${receipts.length})`,
                icon: Receipt,
              },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--blue)] text-white shadow-xs'
                    : 'text-[var(--text)] hover:bg-white/70'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
          <span>Wallet balance</span>
          <span className="font-mono-data font-bold text-base text-[var(--blue-dark)]">
            {formatMoney(walletCents)}
          </span>
        </div>
      </div>

      {/* ---------------- TAB 1: WALLET ---------------- */}
      {activeTab === 'wallet' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <section className="lg:col-span-5 bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6 flex flex-col justify-between">
            <div>
              <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-5 border-b-2 border-[var(--yellow)] inline-block">
                Transit Wallet
              </h2>
              <p className="text-xs font-medium text-[var(--muted)] mb-1">
                Available fare balance
              </p>
              <p className="font-mono-data text-4xl font-bold text-[var(--blue-dark)] tracking-tight mb-4">
                {formatMoney(walletCents)}
              </p>
              <div className="text-xs text-[var(--muted)] space-y-1.5 pt-4 border-t border-[var(--border)]">
                <p>Account: {me.email}</p>
                <p>Active passes ready to board: {activeTicketsCount}</p>
                <p>Transactions recorded: {receipts.length}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-6">
              <button
                type="button"
                onClick={() => setActiveTab('buy')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Buy a fare
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('tickets')}
                className="px-4 py-2.5 bg-white hover:bg-[#f2f5f8] text-[var(--blue)] border border-[var(--border)] text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Show QR tickets
              </button>
            </div>
          </section>

          <section className="lg:col-span-7 bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Add Funds (Simulated Card)
            </h2>
            <p className="text-sm text-[var(--muted)] mb-5">
              Select a quick top-up amount or enter a custom value ($1–$200). Every top-up generates
              an immutable BFT proof-of-purchase receipt.
            </p>

            <form onSubmit={handleTopUp} className="space-y-5">
              <div>
                <span className="block text-xs font-semibold text-[var(--muted)] mb-2">
                  Quick amounts
                </span>
                <div className="grid grid-cols-4 gap-2.5">
                  {QUICK_AMOUNTS.map((amt) => {
                    const selected = customDollars.trim() === '' && topupCents === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => {
                          setTopupCents(amt);
                          setCustomDollars('');
                        }}
                        className={`py-2.5 px-3 rounded-lg text-sm font-mono-data font-semibold border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                            : 'bg-white text-[var(--blue-dark)] border-[var(--border)] hover:border-[var(--blue)]'
                        }`}
                      >
                        {formatMoney(amt)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="custom-amount"
                    className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                  >
                    Custom amount (USD, optional)
                  </label>
                  <input
                    id="custom-amount"
                    type="number"
                    min="1"
                    max="200"
                    step="0.01"
                    value={customDollars}
                    onChange={(e) => setCustomDollars(e.target.value)}
                    placeholder="e.g. 15.00"
                    className="w-full px-3.5 py-2 text-sm font-mono-data bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
                  />
                </div>
                <div>
                  <label
                    htmlFor="card-last4"
                    className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                  >
                    Card last 4 digits (demo)
                  </label>
                  <input
                    id="card-last4"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={cardLast4}
                    onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4242"
                    className="w-full px-3.5 py-2 text-sm font-mono-data bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
                  />
                </div>
              </div>

              <div className="pt-1 flex items-center justify-between gap-4">
                <p className="text-xs text-[var(--muted)]">
                  Production deployments integrate Stripe or Adyen PaymentIntents.
                </p>
                <button
                  type="submit"
                  disabled={toppingUp}
                  className="px-5 py-2.5 bg-[var(--green)] hover:bg-[#00682f] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  {toppingUp
                    ? 'Processing…'
                    : `Top up ${
                        customDollars.trim() !== '' && Number(customDollars) > 0
                          ? formatMoney(Math.round(Number(customDollars) * 100))
                          : formatMoney(topupCents)
                      }`}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ---------------- TAB 2: BUY FARE ---------------- */}
      {activeTab === 'buy' && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 border-b-2 border-[var(--yellow)] inline-block">
                BFT 2025 Fare Products
              </h2>
              <p className="text-sm text-[var(--muted)] mt-2">
                Select a fare to mint an HMAC-signed QR ticket directly from your wallet.
              </p>
            </div>

            <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--text)] cursor-pointer select-none px-3.5 py-2 rounded-lg bg-[#f2f5f8] border border-[var(--border)]">
              <input
                type="checkbox"
                checked={reducedFare}
                onChange={(e) => setReducedFare(e.target.checked)}
                className="w-4 h-4 accent-[var(--blue)] rounded cursor-pointer"
              />
              <span>Reduced fare (Youth / Senior / Disability)</span>
            </label>
          </div>

          {!catalog ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-36 rounded-[var(--radius)] bg-[#f2f5f8] animate-pulse border border-[var(--border)]"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {catalog.products.map((p) => {
                const isSelected = selectedCode === p.code;
                const displayPrice = reducedFare ? p.reduced_price_cents : p.price_cents;
                const ridesLabel =
                  p.rides === null ? 'Unlimited rides' : p.rides === 1 ? '1 ride' : `${p.rides} rides`;

                return (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => setSelectedCode(p.code)}
                    className={`text-left p-4 rounded-[var(--radius)] border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-2 border-[var(--blue)] bg-[#f6faff]'
                        : 'border-[var(--border)] bg-white hover:border-[var(--blue)]/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-display font-bold text-base text-[var(--blue-dark)]">
                          {p.name}
                        </span>
                        <span className="text-xs font-mono-data text-[var(--muted)]">{p.code}</span>
                      </div>

                      <div className="flex items-baseline gap-2 my-2.5">
                        <span className="font-mono-data text-2xl font-bold text-[var(--text)]">
                          {formatMoney(displayPrice)}
                        </span>
                        {reducedFare && (
                          <span className="font-mono-data text-xs text-[var(--muted)] line-through">
                            {formatMoney(p.price_cents)}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[var(--muted)] leading-relaxed">{p.description}</p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-[var(--border)] text-xs text-[var(--muted)] flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-[var(--text)]">{ridesLabel}</span>
                      {p.mobile_only === 1 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[var(--blue)] font-medium">Mobile only</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-[var(--muted)]">
              {selectedProduct ? (
                walletCents < selectedPrice ? (
                  <span className="text-[var(--danger)] font-medium">
                    Wallet balance ({formatMoney(walletCents)}) is short by{' '}
                    {formatMoney(selectedPrice - walletCents)}.{' '}
                    <button
                      type="button"
                      onClick={() => setActiveTab('wallet')}
                      className="underline font-semibold text-[var(--blue)] cursor-pointer"
                    >
                      Top up wallet
                    </button>
                  </span>
                ) : (
                  <span>
                    Paying from wallet · Remaining balance after purchase:{' '}
                    <strong className="font-mono-data text-[var(--text)]">
                      {formatMoney(walletCents - selectedPrice)}
                    </strong>
                  </span>
                )
              ) : (
                <span>Select a fare product above to purchase.</span>
              )}
            </div>

            <button
              type="button"
              disabled={!selectedProduct || purchasing}
              onClick={handlePurchase}
              className="px-5 py-2.5 bg-[var(--green)] hover:bg-[#00682f] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {purchasing
                ? 'Minting QR ticket…'
                : selectedProduct
                  ? `Buy ${selectedProduct.name} — ${formatMoney(selectedPrice)}`
                  : 'Select a fare'}
            </button>
          </div>
        </section>
      )}

      {/* ---------------- TAB 3: MY TICKETS ---------------- */}
      {activeTab === 'tickets' && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 border-b-2 border-[var(--yellow)] inline-block">
                My QR Tickets
              </h2>
              <p className="text-sm text-[var(--muted)] mt-2">
                Show an active QR code to the bus operator validator when boarding. Ticket state is
                verified server-side at scan time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('buy')}
              className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Buy another fare
            </button>
          </div>

          {tickets.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-[var(--border)] rounded-[var(--radius)]">
              <TicketIcon className="w-8 h-8 text-[var(--muted)] mx-auto mb-2.5 opacity-60" />
              <p className="text-sm font-semibold text-[var(--text)] mb-1">No tickets yet</p>
              <p className="text-xs text-[var(--muted)] mb-4">
                Top up your wallet and purchase a Single Ride or Pass to generate a scannable QR
                code.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('buy')}
                className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                Browse fares
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {tickets.map((t) => {
                const isActive = t.status === 'active';
                const ridesText =
                  t.rides_remaining === null
                    ? 'Unlimited rides'
                    : `${t.rides_remaining} ${t.rides_remaining === 1 ? 'ride' : 'rides'} left`;

                return (
                  <div
                    key={t.id}
                    className={`py-5 first:pt-2 last:pb-1 flex flex-col sm:flex-row gap-5 items-start sm:items-center ${
                      !isActive ? 'opacity-70' : ''
                    }`}
                  >
                    <div className="shrink-0 bg-white p-2 border border-[var(--border)] rounded-lg">
                      <img
                        src={t.qr_png_data_uri}
                        alt={`QR ticket for ${t.product_name}`}
                        width={144}
                        height={144}
                        className="bft-qr-img w-36 h-36 block"
                      />
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="font-display font-bold text-lg text-[var(--blue-dark)]">
                          {t.product_name}
                        </h3>
                        <span
                          className={`text-xs font-bold uppercase tracking-wide ${
                            isActive ? 'text-[var(--ok)]' : 'text-[var(--danger)]'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>

                      <div className="text-sm text-[var(--muted)] flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-[var(--text)]">{ridesText}</span>
                        <span aria-hidden="true">·</span>
                        <span>Expires {formatTimestamp(t.expires_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Purchased {formatTimestamp(t.purchased_at)}</span>
                      </div>

                      <div className="pt-1">
                        <span className="block text-[11px] font-medium text-[var(--muted)] mb-0.5">
                          Signed QR payload
                        </span>
                        <code className="block font-mono-data text-xs text-[var(--text)] bg-[#f2f5f8] border border-[var(--border)] rounded-md px-2.5 py-1.5 break-all">
                          {t.qr_payload}
                        </code>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCopyPayload(t)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--blue)] bg-white border border-[var(--border)] hover:border-[var(--blue)] rounded-lg transition-colors cursor-pointer"
                        >
                          {copiedId === t.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[var(--ok)]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copy payload
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onTestPayloadInScanner(t.qr_payload)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--blue)] hover:bg-[var(--blue-dark)] rounded-lg transition-colors cursor-pointer"
                        >
                          Validate in Scanner
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ---------------- TAB 4: RECEIPTS ---------------- */}
      {activeTab === 'receipts' && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
          <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
            Proof of Purchase Receipts
          </h2>

          {receipts.length === 0 ? (
            <p className="text-sm text-[var(--muted)] py-8 text-center">
              No transactions recorded yet. Top up your wallet or buy a fare to receive a receipt.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs font-semibold text-[var(--muted)]">
                    <th className="py-2.5 pr-4">Receipt</th>
                    <th className="py-2.5 pr-4">Date</th>
                    <th className="py-2.5 pr-4">Type</th>
                    <th className="py-2.5 pr-4">Description</th>
                    <th className="py-2.5 pr-4 text-right">Amount</th>
                    <th className="py-2.5 pr-4">Status</th>
                    <th className="py-2.5 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {receipts.map((r) => (
                    <tr key={r.id} className="hover:bg-[#f7fafc] transition-colors">
                      <td className="py-3 pr-4 font-mono-data text-xs font-semibold text-[var(--blue-dark)] whitespace-nowrap">
                        {r.id}
                      </td>
                      <td className="py-3 pr-4 text-xs text-[var(--muted)] tabular-nums whitespace-nowrap">
                        {formatTimestamp(r.created_at)}
                      </td>
                      <td className="py-3 pr-4 text-xs font-semibold whitespace-nowrap">
                        <span
                          className={
                            r.type === 'topup' ? 'text-[var(--blue)]' : 'text-[#9a6b00]'
                          }
                        >
                          {r.type === 'topup' ? 'Top-up' : 'Purchase'}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-sm text-[var(--text)]">{r.description}</td>
                      <td className="py-3 pr-4 font-mono-data text-sm font-semibold text-right whitespace-nowrap">
                        {formatMoney(r.amount_cents)}
                      </td>
                      <td className="py-3 pr-4 text-xs font-semibold whitespace-nowrap">
                        <span
                          className={
                            r.status === 'completed' ? 'text-[var(--ok)]' : 'text-[var(--danger)]'
                          }
                        >
                          {r.status === 'completed' ? 'Completed' : r.status}
                        </span>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenReceipt(r.id)}
                          className="px-3 py-1 text-xs font-semibold text-[var(--blue)] hover:text-white bg-[#eef4fa] hover:bg-[var(--blue)] rounded-md transition-colors cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
