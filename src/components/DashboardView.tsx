/**
 * src/components/DashboardView.tsx -- Agency Analytics Dashboard surface.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * 7/30/90-day range selector, 6 KPI tiles, 4 Chart.js charts (Revenue/day,
 * Boardings by route, Revenue by product, Payment mix), recent transactions
 * (server-masked rider emails), recent validations, and CSV export.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Download, RefreshCw } from 'lucide-react';
import { api, formatMoney, formatTimestamp } from '../api';
import type { AnalyticsResponse } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
);

interface DashboardViewProps {
  refreshSignal: number;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ refreshSignal }) => {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async (selectedDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<AnalyticsResponse>(`/api/admin/analytics?days=${selectedDays}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics(days);
  }, [days, refreshSignal, loadAnalytics]);

  const acceptanceRate =
    data && data.kpis.boardings > 0
      ? ((data.kpis.accepted / data.kpis.boardings) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="max-w-[1160px] mx-auto px-5 py-6 space-y-5">
      {/* Header & Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--blue-dark)] tracking-tight">
            Agency Fare &amp; Ridership Analytics
          </h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Ben Franklin Transit · Tri-Cities, WA · Privacy-masked rider telemetry
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="inline-flex items-center p-1 bg-[#e4ebf2] rounded-lg"
            role="group"
            aria-label="Date range"
          >
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  days === d
                    ? 'bg-[var(--blue)] text-white'
                    : 'text-[var(--text)] hover:bg-white/70'
                }`}
              >
                Last {d} days
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadAnalytics(days)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-[#f2f5f8] text-[var(--blue-dark)] border border-[var(--border)] rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <a
            href={`/api/admin/export.csv?days=${days}`}
            download="bft-transactions.csv"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius)] border border-[var(--danger)]/40 bg-[#fbe9e7] px-4 py-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* 6 KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {!data
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] animate-pulse"
              />
            ))
          : [
              {
                label: 'Fare Revenue',
                value: formatMoney(data.kpis.revenue_cents),
                sub: `Last ${data.days} days`,
                accent: 'text-[var(--blue-dark)]',
              },
              {
                label: 'Total Boardings',
                value: data.kpis.boardings.toLocaleString(),
                sub: `${acceptanceRate}% accepted`,
                accent: 'text-[var(--blue-dark)]',
              },
              {
                label: 'Accepted Scans',
                value: data.kpis.accepted.toLocaleString(),
                sub: 'Verified fares',
                accent: 'text-[var(--ok)]',
              },
              {
                label: 'Rejected Scans',
                value: data.kpis.rejected.toLocaleString(),
                sub: 'Expired / invalid',
                accent: 'text-[var(--danger)]',
              },
              {
                label: 'Active Tickets',
                value: data.kpis.active_tickets.toLocaleString(),
                sub: 'Ready to board',
                accent: 'text-[var(--blue)]',
              },
              {
                label: 'Rider Accounts',
                value: data.kpis.accounts.toLocaleString(),
                sub: 'Total registered',
                accent: 'text-[var(--blue-dark)]',
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-4 flex flex-col justify-between"
              >
                <span className="text-xs font-medium text-[var(--muted)]">{kpi.label}</span>
                <span className={`font-mono-data text-2xl font-bold mt-1.5 ${kpi.accent}`}>
                  {kpi.value}
                </span>
                <span className="text-[11px] text-[var(--muted)] mt-1">{kpi.sub}</span>
              </div>
            ))}
      </div>

      {/* 4 Interactive Chart.js Charts */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 1. Revenue per day */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Revenue per Day
            </h2>
            <div className="h-64">
              <Line
                data={{
                  labels: data.revenue_by_day.map((r) => r.day.slice(5)),
                  datasets: [
                    {
                      label: 'Revenue ($)',
                      data: data.revenue_by_day.map((r) => Number((r.cents / 100).toFixed(2))),
                      borderColor: '#00539b',
                      backgroundColor: 'rgba(0, 83, 155, 0.12)',
                      fill: true,
                      tension: 0.3,
                      pointRadius: data.revenue_by_day.length > 35 ? 1.5 : 3,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => `$${Number(ctx.parsed.y ?? 0).toFixed(2)}`,
                      },
                    },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        callback: (v) => `$${v}`,
                      },
                      grid: { color: '#eef2f6' },
                    },
                    x: {
                      grid: { display: false },
                    },
                  },
                }}
              />
            </div>
          </section>

          {/* 2. Boardings by route */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Boardings by Route
            </h2>
            <div className="h-64">
              <Bar
                data={{
                  labels: data.rides_by_route.map((r) => r.route),
                  datasets: [
                    {
                      label: 'Boardings',
                      data: data.rides_by_route.map((r) => r.boardings),
                      backgroundColor: data.rides_by_route.map((r) => r.color),
                      borderRadius: 4,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        title: (items) => {
                          const idx = items[0]?.dataIndex ?? 0;
                          const item = data.rides_by_route[idx];
                          return item
                            ? `Route ${item.route}${item.route_name ? ` — ${item.route_name}` : ''}`
                            : '';
                        },
                      },
                    },
                  },
                  scales: {
                    y: { beginAtZero: true, grid: { color: '#eef2f6' } },
                    x: { grid: { display: false } },
                  },
                }}
              />
            </div>
          </section>

          {/* 3. Revenue by fare product */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Revenue by Fare Product
            </h2>
            <div className="h-64 flex items-center justify-center">
              <Doughnut
                data={{
                  labels: data.product_breakdown.map((p) => p.product),
                  datasets: [
                    {
                      data: data.product_breakdown.map((p) => Number((p.cents / 100).toFixed(2))),
                      backgroundColor: ['#00539b', '#00843d', '#ffb500', '#6a3d9a', '#c0392b'],
                      borderWidth: 2,
                      borderColor: '#ffffff',
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'right' },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => `${ctx.label}: $${Number(ctx.parsed).toFixed(2)}`,
                      },
                    },
                  },
                }}
              />
            </div>
          </section>

          {/* 4. Payment mix */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Payment Mix
            </h2>
            <div className="h-64 flex items-center justify-center">
              <Doughnut
                data={{
                  labels: data.revenue_by_method.map((m) =>
                    m.method === 'wallet' ? 'BFT Wallet' : 'Card Top-up / Direct',
                  ),
                  datasets: [
                    {
                      data: data.revenue_by_method.map((m) => Number((m.cents / 100).toFixed(2))),
                      backgroundColor: ['#00539b', '#ffb500', '#00843d'],
                      borderWidth: 2,
                      borderColor: '#ffffff',
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'right' },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => `${ctx.label}: $${Number(ctx.parsed).toFixed(2)}`,
                      },
                    },
                  },
                }}
              />
            </div>
          </section>
        </div>
      )}

      {/* Recent Activity Tables */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Recent Transactions */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Recent Transactions
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)] font-semibold">
                    <th className="py-2 pr-3">Receipt</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3">Rider</th>
                    <th className="py-2 text-right">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.recent_transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-[#f7fafc]">
                      <td className="py-2.5 pr-3 font-mono-data font-semibold text-[var(--blue-dark)] whitespace-nowrap">
                        {t.id}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">
                        <span
                          className={
                            t.type === 'topup' ? 'text-[var(--blue)]' : 'text-[#9a6b00]'
                          }
                        >
                          {t.type === 'topup' ? 'Top-up' : 'Purchase'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono-data font-semibold text-right whitespace-nowrap">
                        {formatMoney(t.amount_cents)}
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--muted)] font-mono-data whitespace-nowrap">
                        {t.email}
                      </td>
                      <td className="py-2.5 text-[var(--muted)] text-right tabular-nums whitespace-nowrap">
                        {formatTimestamp(t.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent Validations */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Recent Validations
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)] font-semibold">
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Reason</th>
                    <th className="py-2 text-right">Scanner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.recent_validations.map((v, idx) => (
                    <tr key={`${v.scanned_at}-${idx}`} className="hover:bg-[#f7fafc]">
                      <td className="py-2.5 pr-3 text-[var(--muted)] tabular-nums whitespace-nowrap">
                        {formatTimestamp(v.scanned_at)}
                      </td>
                      <td className="py-2.5 pr-3 font-mono-data font-semibold whitespace-nowrap">
                        {v.route_id}
                      </td>
                      <td className="py-2.5 pr-3 font-bold uppercase whitespace-nowrap">
                        <span
                          className={
                            v.result === 'accepted' ? 'text-[var(--ok)]' : 'text-[var(--danger)]'
                          }
                        >
                          {v.result}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--text)]">{v.reason}</td>
                      <td className="py-2.5 font-mono-data text-[var(--muted)] text-right whitespace-nowrap">
                        {v.scanner_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
