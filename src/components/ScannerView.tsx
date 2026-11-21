/**
 * src/components/ScannerView.tsx -- Operator Fare Validator surface.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * Supports live camera QR scanning (html5-qrcode), manual payload validation,
 * tampered-signature testing, local validation log, and server-rendered
 * Tri-Cities stop poster QR generation.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ExternalLink,
  Printer,
  QrCode,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { CatalogResponse, ValidateResponse } from '../types';

interface ScannerViewProps {
  catalog: CatalogResponse | null;
  initialPayload: string | null;
  onConsumeInitialPayload: () => void;
  onSimulateStopScan: (stopCode: string) => void;
  onValidationRecorded: () => void;
}

interface LocalLogEntry {
  id: string;
  time: string;
  routeId: string;
  result: 'accepted' | 'rejected';
  reason: string;
  riderRef: string;
}

interface ScanBanner {
  kind: 'accept' | 'reject' | 'info';
  headline: string;
  detail: string;
}

export const ScannerView: React.FC<ScannerViewProps> = ({
  catalog,
  initialPayload,
  onConsumeInitialPayload,
  onSimulateStopScan,
  onValidationRecorded,
}) => {
  const [routeId, setRouteId] = useState<string>('26');
  const [scannerId, setScannerId] = useState<string>('SCN-001');
  const [stopCode, setStopCode] = useState<string>('');
  const [payloadInput, setPayloadInput] = useState<string>('');
  const [validating, setValidating] = useState(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [banner, setBanner] = useState<ScanBanner | null>(null);
  const [logs, setLogs] = useState<LocalLogEntry[]>([]);

  // Stop poster generator state
  const [posterStop, setPosterStop] = useState<string>('TC-KEN');
  const [generatedPosterStop, setGeneratedPosterStop] = useState<string | null>('TC-KEN');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const routeRef = useRef(routeId);
  const scannerIdRef = useRef(scannerId);
  const stopCodeRef = useRef(stopCode);

  routeRef.current = routeId;
  scannerIdRef.current = scannerId;
  stopCodeRef.current = stopCode;

  useEffect(() => {
    if (catalog?.routes.length && !catalog.routes.some((r) => r.id === routeId)) {
      setRouteId(catalog.routes[0].id);
    }
    if (catalog?.stops.length && !catalog.stops.some((s) => s.code === posterStop)) {
      setPosterStop(catalog.stops[0].code);
      setGeneratedPosterStop(catalog.stops[0].code);
    }
  }, [catalog, routeId, posterStop]);

  useEffect(() => {
    if (initialPayload) {
      setPayloadInput(initialPayload);
      setBanner({
        kind: 'info',
        headline: 'Ticket payload loaded',
        detail: 'Select a route and click Validate Ticket to verify and consume this fare.',
      });
      onConsumeInitialPayload();
    }
  }, [initialPayload, onConsumeInitialPayload]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const appendLog = (
    result: 'accepted' | 'rejected',
    reason: string,
    ref: string,
    usedRoute: string,
  ) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        time: new Date().toLocaleTimeString(),
        routeId: usedRoute,
        result,
        reason,
        riderRef: ref,
      },
      ...prev.slice(0, 29),
    ]);
  };

  const validatePayload = async (rawPayload: string) => {
    const trimmed = rawPayload.trim();
    if (!trimmed) return;
    setValidating(true);
    const activeRoute = routeRef.current;
    try {
      const data = await api<ValidateResponse>('/api/validate', {
        method: 'POST',
        body: JSON.stringify({
          payload: trimmed,
          route_id: activeRoute,
          scanner_id: scannerIdRef.current.trim() || 'SCN-000',
          stop_code: stopCodeRef.current || null,
        }),
      });

      if (data.result === 'accepted') {
        const rides =
          data.rides_remaining === null || data.rides_remaining === undefined
            ? 'Unlimited rides'
            : `${data.rides_remaining} ${data.rides_remaining === 1 ? 'ride' : 'rides'} left`;
        setBanner({
          kind: 'accept',
          headline: `ACCEPTED — ${data.product_name ?? 'Valid Fare'}`,
          detail: `${rides} · Rider ${data.rider_ref} · Route ${activeRoute}`,
        });
        appendLog('accepted', data.product_name ?? 'OK', data.rider_ref, activeRoute);
      } else {
        setBanner({
          kind: 'reject',
          headline: `REJECTED — ${data.reason ?? 'Invalid ticket'}`,
          detail: `Route ${activeRoute} · Rider ${data.rider_ref}`,
        });
        appendLog('rejected', data.reason ?? 'Rejected', data.rider_ref, activeRoute);
      }
      onValidationRecorded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Validation request failed';
      setBanner({
        kind: 'reject',
        headline: 'REJECTED — Validation Error',
        detail: msg,
      });
      appendLog('rejected', msg, 'R-UNKNOWN', activeRoute);
    } finally {
      setValidating(false);
    }
  };

  const handleStartCamera = async () => {
    if (cameraActive) return;
    try {
      const qr = new Html5Qrcode('qr-reader');
      scannerRef.current = qr;
      setCameraActive(true);
      setBanner({
        kind: 'info',
        headline: 'Camera active',
        detail: 'Point the rear camera at a rider BFT QR ticket.',
      });
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decodedText) => {
          setPayloadInput(decodedText);
          qr.stop()
            .then(() => {
              qr.clear();
              scannerRef.current = null;
              setCameraActive(false);
              void validatePayload(decodedText);
            })
            .catch(() => {
              setCameraActive(false);
              void validatePayload(decodedText);
            });
        },
        () => {
          // Per-frame scan misses are expected noise
        },
      );
    } catch (err) {
      scannerRef.current = null;
      setCameraActive(false);
      setBanner({
        kind: 'reject',
        headline: 'Camera unavailable',
        detail:
          err instanceof Error
            ? err.message
            : 'Camera access was denied or no camera device was found. Use manual payload entry on the right.',
      });
    }
  };

  const handleStopCamera = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore stop race
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
    setBanner({
      kind: 'info',
      headline: 'Camera stopped',
      detail: 'Tap Start Camera to scan another rider QR code.',
    });
  };

  const handleTamperTest = () => {
    const base = payloadInput.trim() || 'BFT1:tkt_demo000000000000:abcdef1234567890';
    const lastChar = base.slice(-1);
    const altered = base.slice(0, -1) + (lastChar === '0' ? 'f' : '0');
    setPayloadInput(altered);
    void validatePayload(altered);
  };

  const selectedPosterStopObj = catalog?.stops.find((s) => s.code === generatedPosterStop) ?? null;

  return (
    <div className="max-w-[1160px] mx-auto px-5 py-6 space-y-5">
      {/* Top 2-column Validator Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Camera Scanner + Verdict */}
        <section className="lg:col-span-6 bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Scan Rider QR Ticket
            </h2>

            <div className="relative rounded-xl border border-[var(--border)] bg-[#0f172a] overflow-hidden min-h-[260px] flex items-center justify-center">
              <div id="qr-reader" className="w-full" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-slate-300">
                  <QrCode className="w-10 h-10 mb-3 text-[var(--yellow)] opacity-90" />
                  <p className="text-sm font-semibold text-white">Camera viewfinder idle</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs">
                    Start the rear camera to decode rider QR codes, or paste a BFT1 payload on the
                    right.
                  </p>
                </div>
              )}
            </div>

            {/* Prominent Accept / Reject Verdict Banner */}
            {banner && (
              <div
                role="status"
                className={`mt-4 rounded-[var(--radius)] border px-4 py-3.5 flex items-start gap-3 ${
                  banner.kind === 'accept'
                    ? 'bg-[#e3f4e9] border-[var(--ok)] text-[var(--ok)]'
                    : banner.kind === 'reject'
                      ? 'bg-[#fbe9e7] border-[var(--danger)] text-[var(--danger)]'
                      : 'bg-[#e3eefb] border-[var(--blue)]/50 text-[var(--blue-dark)]'
                }`}
              >
                {banner.kind === 'accept' ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                ) : banner.kind === 'reject' ? (
                  <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                ) : (
                  <QrCode className="w-5 h-5 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm">{banner.headline}</div>
                  <div className="text-xs opacity-90 mt-0.5">{banner.detail}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-5">
            <button
              type="button"
              onClick={handleStartCamera}
              disabled={cameraActive}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--green)] hover:bg-[#00682f] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              Start camera
            </button>
            <button
              type="button"
              onClick={handleStopCamera}
              disabled={!cameraActive}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#f2f5f8] text-[var(--blue-dark)] border border-[var(--border)] text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <CameraOff className="w-4 h-4" />
              Stop camera
            </button>
          </div>
        </section>

        {/* Right: Validator Settings + Manual Payload Entry */}
        <section className="lg:col-span-6 bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6 flex flex-col justify-between space-y-6">
          <div>
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
              Validator Settings
            </h2>

            <div className="space-y-3.5">
              <div>
                <label
                  htmlFor="val-route"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1"
                >
                  Active BFT Route
                </label>
                <select
                  id="val-route"
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
                >
                  {(catalog?.routes ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      Route {r.id} — {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="val-scanner-id"
                    className="block text-xs font-semibold text-[var(--muted)] mb-1"
                  >
                    Scanner ID
                  </label>
                  <input
                    id="val-scanner-id"
                    type="text"
                    value={scannerId}
                    onChange={(e) => setScannerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-data bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
                  />
                </div>
                <div>
                  <label
                    htmlFor="val-stop"
                    className="block text-xs font-semibold text-[var(--muted)] mb-1"
                  >
                    Stop (optional)
                  </label>
                  <select
                    id="val-stop"
                    value={stopCode}
                    onChange={(e) => setStopCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
                  >
                    <option value="">None specified</option>
                    {(catalog?.stops ?? []).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-5 border-t border-[var(--border)]">
            <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-3 border-b-2 border-[var(--yellow)] inline-block">
              Manual Payload Entry
            </h2>
            <label
              htmlFor="val-payload"
              className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
            >
              QR payload (BFT1:&lt;ticket_id&gt;:&lt;hmac16&gt;)
            </label>
            <input
              id="val-payload"
              type="text"
              value={payloadInput}
              onChange={(e) => setPayloadInput(e.target.value)}
              placeholder="BFT1:tkt_xxxxxxxxxxxxxxxx:abcdef1234567890"
              className="w-full px-3.5 py-2.5 text-sm font-mono-data bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
            />

            <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
              <button
                type="button"
                disabled={validating || !payloadInput.trim()}
                onClick={() => void validatePayload(payloadInput)}
                className="px-4 py-2.5 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {validating ? 'Validating…' : 'Validate ticket'}
              </button>
              <button
                type="button"
                disabled={validating}
                onClick={handleTamperTest}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-[#fbe9e7] text-[var(--danger)] border border-[var(--border)] hover:border-[var(--danger)]/40 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4" />
                Test tampered signature
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Local Validation Log */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
        <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-4 border-b-2 border-[var(--yellow)] inline-block">
          Local Validation Log
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No scans performed in this session yet. Every scan is also persisted to the agency
            boardings table for live analytics.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-semibold text-[var(--muted)]">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Route</th>
                  <th className="py-2 pr-4">Verdict</th>
                  <th className="py-2 pr-4">Detail / Reason</th>
                  <th className="py-2 text-right">Rider Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {logs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#f7fafc]">
                    <td className="py-2.5 pr-4 font-mono-data text-xs text-[var(--muted)] whitespace-nowrap">
                      {entry.time}
                    </td>
                    <td className="py-2.5 pr-4 font-mono-data text-xs font-semibold whitespace-nowrap">
                      {entry.routeId}
                    </td>
                    <td className="py-2.5 pr-4 text-xs font-bold uppercase whitespace-nowrap">
                      <span
                        className={
                          entry.result === 'accepted' ? 'text-[var(--ok)]' : 'text-[var(--danger)]'
                        }
                      >
                        {entry.result}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-sm text-[var(--text)]">{entry.reason}</td>
                    <td className="py-2.5 font-mono-data text-xs text-[var(--muted)] text-right whitespace-nowrap">
                      {entry.riderRef}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Stop Poster QR Generator */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
        <h2 className="text-base font-bold text-[var(--blue-dark)] pb-2 mb-2 border-b-2 border-[var(--yellow)] inline-block">
          Stop Poster QR Generator
        </h2>
        <p className="text-sm text-[var(--muted)] mb-5">
          Generates a server-rendered PNG QR poster for any major Tri-Cities stop. Riders scan the
          poster to open the Rider app pre-loaded with that stop context (<code>?stop=CODE</code>).
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <select
            aria-label="Choose a BFT stop"
            value={posterStop}
            onChange={(e) => setPosterStop(e.target.value)}
            className="w-full sm:w-80 px-3 py-2.5 text-sm bg-white border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20"
          >
            {(catalog?.stops ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setGeneratedPosterStop(posterStop)}
            className="px-4 py-2.5 bg-[var(--yellow)] hover:brightness-95 text-[var(--blue-dark)] text-sm font-bold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            Generate poster QR
          </button>
        </div>

        {generatedPosterStop && selectedPosterStopObj && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 p-5 rounded-[var(--radius)] bg-[#f7fafc] border border-[var(--border)]">
            <div className="bg-white p-3 rounded-lg border border-[var(--border)] shrink-0">
              <img
                src={`/api/stop/${encodeURIComponent(generatedPosterStop)}/qr`}
                alt={`Stop poster QR for ${selectedPosterStopObj.name}`}
                width={180}
                height={180}
                className="bft-qr-img w-44 h-44 block"
              />
            </div>
            <div className="space-y-2.5">
              <div className="text-xs font-mono-data font-semibold text-[var(--blue)]">
                STOP CODE: {selectedPosterStopObj.code}
              </div>
              <h3 className="font-display font-bold text-xl text-[var(--blue-dark)]">
                {selectedPosterStopObj.name}
              </h3>
              <p className="text-sm text-[var(--muted)] max-w-md">
                Scan to pay &amp; ride with BFT QR Pay. Deep-links directly to{' '}
                <code className="font-mono-data text-xs text-[var(--text)]">
                  /?stop={selectedPosterStopObj.code}
                </code>
                .
              </p>
              <div className="flex flex-wrap gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => onSimulateStopScan(selectedPosterStopObj.code)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Simulate rider scan
                </button>
                <a
                  href={`/api/stop/${encodeURIComponent(generatedPosterStop)}/qr`}
                  download={`bft-stop-${generatedPosterStop}.png`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#eef4fa] text-[var(--blue-dark)] border border-[var(--border)] text-xs font-semibold rounded-lg transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Download PNG
                </a>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
