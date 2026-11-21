/**
 * src/components/ReceiptView.tsx -- Printable proof-of-purchase receipt surface.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * Fetches /api/receipts/:id (ownership enforced server-side) and renders a
 * print-optimized Ben Franklin Transit receipt with @media print chrome hiding.
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { ApiError, api, formatMoney, formatTimestamp } from '../api';
import type { MeResponse, ReceiptDetailResponse } from '../types';

interface ReceiptViewProps {
  receiptId: string | null;
  me: MeResponse;
  onBackToRider: () => void;
}

export const ReceiptView: React.FC<ReceiptViewProps> = ({
  receiptId,
  me,
  onBackToRider,
}) => {
  const [detail, setDetail] = useState<ReceiptDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!receiptId) {
      setError('Missing receipt ID.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api<ReceiptDetailResponse>(`/api/receipts/${encodeURIComponent(receiptId)}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) {
            setError('Sign in first in the Rider app to view your proof of purchase.');
          } else {
            setError(err instanceof Error ? err.message : 'Receipt not found.');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  return (
    <div className="max-w-[660px] mx-auto px-5 py-8">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToRider}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--blue)] hover:text-[var(--blue-dark)] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Rider app
        </button>

        {detail && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
        )}
      </div>

      <article className="print-receipt-card bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-7 shadow-xs">
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="inline-flex items-center justify-center bg-[var(--yellow)] text-[var(--blue-dark)] font-display font-extrabold text-sm px-2.5 py-0.5 rounded">
                BFT
              </span>
              <span className="text-xs font-semibold text-[var(--muted)]">
                Official Proof of Purchase
              </span>
            </div>
            <h1 className="font-display text-xl font-bold text-[var(--blue-dark)]">
              Ben Franklin Transit — Fare Receipt
            </h1>
          </div>

          {detail && (
            <div className="text-right">
              <div className="text-[11px] font-medium text-[var(--muted)]">Receipt Number</div>
              <div className="font-mono-data text-sm font-bold text-[var(--blue-dark)]">
                {detail.receipt.id}
              </div>
            </div>
          )}
        </div>

        {loading && (
          <p className="py-10 text-center text-sm text-[var(--muted)]">Loading receipt…</p>
        )}

        {!loading && error && (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm font-medium text-[var(--danger)]">{error}</p>
            <button
              type="button"
              onClick={onBackToRider}
              className="px-4 py-2 bg-[var(--blue)] text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Open Rider app
            </button>
          </div>
        )}

        {!loading && detail && (
          <>
            <dl className="divide-y divide-[var(--border)] text-sm mt-2">
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-[var(--muted)]">Date &amp; Time</dt>
                <dd className="col-span-2 font-medium text-[var(--text)] tabular-nums">
                  {formatTimestamp(detail.receipt.created_at)}
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-[var(--muted)]">Customer</dt>
                <dd className="col-span-2 font-medium text-[var(--text)]">
                  {me.signed_in && me.email ? me.email : '—'}
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-[var(--muted)]">Transaction Type</dt>
                <dd className="col-span-2 font-semibold">
                  <span
                    className={
                      detail.receipt.type === 'topup'
                        ? 'text-[var(--blue)]'
                        : 'text-[#9a6b00]'
                    }
                  >
                    {detail.receipt.type === 'topup' ? 'Wallet Top-up' : 'Fare Purchase'}
                  </span>
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-[var(--muted)]">Description</dt>
                <dd className="col-span-2 font-medium text-[var(--text)]">
                  {detail.receipt.description}
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-[var(--muted)]">Payment Method</dt>
                <dd className="col-span-2 font-medium text-[var(--text)] capitalize">
                  {detail.receipt.method}
                </dd>
              </div>
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-[var(--muted)]">Status</dt>
                <dd className="col-span-2 font-semibold">
                  <span
                    className={
                      detail.receipt.status === 'completed'
                        ? 'text-[var(--ok)]'
                        : 'text-[var(--danger)]'
                    }
                  >
                    {detail.receipt.status === 'completed' ? 'Completed' : detail.receipt.status}
                  </span>
                </dd>
              </div>
              <div className="py-3.5 grid grid-cols-3 gap-4 bg-[#f7fafc] -mx-3 px-3 rounded-md">
                <dt className="font-semibold text-[var(--blue-dark)]">Total Paid</dt>
                <dd className="col-span-2 font-mono-data text-lg font-bold text-[var(--blue-dark)]">
                  {formatMoney(detail.receipt.amount_cents)}
                </dd>
              </div>
            </dl>

            {detail.ticket && (
              <div className="mt-6 pt-5 border-t border-[var(--border)]">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
                  Linked Fare Ticket
                </h2>
                <dl className="divide-y divide-[var(--border)] text-sm">
                  <div className="py-2.5 grid grid-cols-3 gap-4">
                    <dt className="text-[var(--muted)]">Ticket ID</dt>
                    <dd className="col-span-2 font-mono-data text-xs font-semibold text-[var(--text)]">
                      {detail.ticket.id}
                    </dd>
                  </div>
                  <div className="py-2.5 grid grid-cols-3 gap-4">
                    <dt className="text-[var(--muted)]">Fare Product</dt>
                    <dd className="col-span-2 font-medium text-[var(--text)]">
                      {detail.ticket.product_name}
                    </dd>
                  </div>
                  <div className="py-2.5 grid grid-cols-3 gap-4">
                    <dt className="text-[var(--muted)]">Ticket Status</dt>
                    <dd className="col-span-2 font-semibold uppercase text-xs">
                      <span
                        className={
                          detail.ticket.status === 'active'
                            ? 'text-[var(--ok)]'
                            : 'text-[var(--danger)]'
                        }
                      >
                        {detail.ticket.status}
                      </span>
                    </dd>
                  </div>
                  <div className="py-2.5 grid grid-cols-3 gap-4">
                    <dt className="text-[var(--muted)]">Rides Remaining</dt>
                    <dd className="col-span-2 font-mono-data font-medium text-[var(--text)]">
                      {detail.ticket.rides_remaining === null
                        ? 'Unlimited'
                        : detail.ticket.rides_remaining}
                    </dd>
                  </div>
                  <div className="py-2.5 grid grid-cols-3 gap-4">
                    <dt className="text-[var(--muted)]">Valid Until</dt>
                    <dd className="col-span-2 font-medium text-[var(--text)] tabular-nums">
                      {formatTimestamp(detail.ticket.expires_at)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <footer className="mt-7 pt-5 border-t border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed">
              <p className="font-semibold text-[var(--text)]">
                Ben Franklin Transit · 1000 W Columbia Dr, Kennewick, WA 99336 · bft.org
              </p>
              <p className="mt-1">
                Keep this receipt as official proof of payment. Mobile fares are non-transferable
                and verified electronically on boarding.
              </p>
            </footer>
          </>
        )}
      </article>
    </div>
  );
};
