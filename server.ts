/**
 * server.ts -- Express + Vite full-stack server for BFT QR Pay.
 *
 * VERSION: 1.0.0 (initial release)
 *
 * Implements every API endpoint for Ben Franklin Transit QR Fare Payment:
 *   - Demo auth sessions (Bearer token + HttpOnly cookie)
 *   - Simulated wallet top-up & fare purchase (atomic SQLite transactions)
 *   - Tamper-proof HMAC-SHA256 QR ticket minting & server-side validation
 *   - Server-rendered PNG QR codes for tickets and stop posters
 *   - Immutable proof-of-purchase receipts (BFT-YYYY-NNNNNN)
 *   - Agency analytics dashboard & privacy-safe CSV ledger export
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import {
  getDb,
  makeQrPayload,
  maskEmail,
  nextReceiptNumber,
  riderRef,
  verifyQrPayload,
} from './src/server/db.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'bft_session';
const SESSION_DAYS = 30;
const IS_PROD = process.env.NODE_ENV === 'production';

interface AccountRow {
  id: number;
  email: string;
  wallet_cents: number;
  created_at: string;
}

interface FareProductRow {
  code: string;
  name: string;
  price_cents: number;
  reduced_price_cents: number;
  validity_minutes: number;
  rides: number | null;
  mobile_only: number;
  description: string;
}

interface TicketRow {
  id: string;
  account_id: number;
  product_code: string;
  status: string;
  rides_remaining: number | null;
  purchased_at: string;
  expires_at: string;
  first_used_at: string | null;
  qr_payload: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

function getCurrentAccount(req: Request): AccountRow | null {
  const token = extractSessionToken(req);
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.* FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, nowIso()) as AccountRow | undefined;
  return row ?? null;
}

/**
 * Light CSRF protection for cookie-authenticated mutations:
 * passes if Authorization: Bearer is used, or X-Requested-With is set,
 * or Origin matches Host / X-Forwarded-Host.
 */
function verifyMutationOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }
  if (!req.cookies?.[SESSION_COOKIE]) {
    next();
    return;
  }
  if (req.headers['x-requested-with']) {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host.split(',')[0].trim()) {
        next();
        return;
      }
    } catch {
      // fall through
    }
    res.status(403).json({ detail: 'Cross-site request blocked' });
    return;
  }
  next();
}

async function qrDataUri(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 220,
    color: { dark: '#003a6e', light: '#ffffff' },
  });
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

async function startServer(): Promise<void> {
  // Initialize SQLite database & deterministic seed on startup
  getDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // -------------------------------------------------------------------------
  // Health & API docs
  // -------------------------------------------------------------------------
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/docs', (_req, res) => {
    res.json({
      title: 'BFT QR Fare Payment API',
      version: '1.0.0',
      endpoints: [
        'POST /api/session            - sign in (email-only demo auth)',
        'POST /api/logout             - end session',
        'GET  /api/me                 - current account + wallet',
        'GET  /api/catalog            - fare products + routes + stops',
        'POST /api/topup              - add wallet funds (simulated)',
        'POST /api/purchase           - buy a fare product -> QR ticket',
        'GET  /api/tickets            - my active/history tickets',
        'POST /api/tickets/expire-sweep - mark expired tickets',
        'GET  /api/receipts           - my proof-of-purchase list',
        'GET  /api/receipts/:txnId    - one receipt + ticket detail',
        'POST /api/validate           - scanner: validate/consume a QR',
        'GET  /api/stop/:code         - stop info (for stop QR posters)',
        'GET  /api/stop/:code/qr      - PNG QR poster for a stop',
        'GET  /api/admin/analytics    - KPIs + chart datasets (?days=)',
        'GET  /api/admin/export.csv   - raw CSV export',
      ],
    });
  });

  // -------------------------------------------------------------------------
  // Session / Account
  // -------------------------------------------------------------------------
  app.post('/api/session', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ detail: 'Please enter a valid email address.' });
      return;
    }

    const db = getDb();
    const now = nowIso();
    let acct = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as
      | AccountRow
      | undefined;
    if (!acct) {
      const info = db
        .prepare('INSERT INTO accounts (email, wallet_cents, created_at) VALUES (?, ?, ?)')
        .run(email, 0, now);
      acct = {
        id: Number(info.lastInsertRowid),
        email,
        wallet_cents: 0,
        created_at: now,
      };
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
    db.prepare(
      'INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(token, acct.id, now, expires);

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieParts = [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${SESSION_DAYS * 86400}`,
      isHttps ? 'Secure; SameSite=None; Partitioned' : 'SameSite=Lax',
    ];
    res.setHeader('Set-Cookie', cookieParts.join('; '));

    res.json({
      ok: true,
      session_token: token,
      email: acct.email,
      wallet_cents: acct.wallet_cents,
    });
  });

  app.post('/api/logout', verifyMutationOrigin, (req, res) => {
    const token = extractSessionToken(req);
    if (token) {
      getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const clearParts = [
      `${SESSION_COOKIE}=`,
      'Path=/',
      'HttpOnly',
      'Max-Age=0',
      isHttps ? 'Secure; SameSite=None; Partitioned' : 'SameSite=Lax',
    ];
    res.setHeader('Set-Cookie', clearParts.join('; '));
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    const acct = getCurrentAccount(req);
    if (!acct) {
      res.json({ signed_in: false });
      return;
    }
    res.json({
      signed_in: true,
      email: acct.email,
      wallet_cents: acct.wallet_cents,
    });
  });

  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------
  app.get('/api/catalog', (_req, res) => {
    const db = getDb();
    const products = db.prepare('SELECT * FROM fare_products ORDER BY price_cents ASC').all();
    const routes = db
      .prepare(
        `SELECT * FROM routes
         ORDER BY CASE WHEN id GLOB '[0-9]*' THEN CAST(id AS INTEGER) ELSE 99999 END, id`,
      )
      .all();
    const stops = db.prepare('SELECT * FROM stops ORDER BY code ASC').all();
    res.json({ products, routes, stops });
  });

  // -------------------------------------------------------------------------
  // Wallet Top-Up (Simulated Payment)
  // -------------------------------------------------------------------------
  app.post('/api/topup', verifyMutationOrigin, (req, res) => {
    const acct = getCurrentAccount(req);
    if (!acct) {
      res.status(401).json({ detail: 'Sign in required' });
      return;
    }

    const amountCents = Number(req.body?.amount_cents);
    const cardLast4 = typeof req.body?.card_last4 === 'string' ? req.body.card_last4.trim() : '';
    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 20000) {
      res.status(400).json({ detail: 'Top-up amount must be between $1.00 and $200.00.' });
      return;
    }
    if (!/^\d{4}$/.test(cardLast4)) {
      res.status(400).json({ detail: 'Enter a valid 4-digit demo card suffix.' });
      return;
    }

    const db = getDb();
    const runTopup = db.transaction(() => {
      const fresh = db
        .prepare('SELECT wallet_cents FROM accounts WHERE id = ?')
        .get(acct.id) as { wallet_cents: number };
      const newBalance = fresh.wallet_cents + amountCents;
      db.prepare('UPDATE accounts SET wallet_cents = ? WHERE id = ?').run(newBalance, acct.id);
      const receiptId = nextReceiptNumber(db);
      const now = nowIso();
      db.prepare(
        `INSERT INTO transactions
         (id, account_id, type, product_code, ticket_id, amount_cents, method, status, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receiptId,
        acct.id,
        'topup',
        null,
        null,
        amountCents,
        'card',
        'completed',
        `Wallet top-up (card ****${cardLast4})`,
        now,
      );
      return { newBalance, receiptId };
    });

    const { newBalance, receiptId } = runTopup();
    res.json({ ok: true, wallet_cents: newBalance, receipt_id: receiptId });
  });

  // -------------------------------------------------------------------------
  // Fare Purchase -> HMAC-Signed QR Ticket
  // -------------------------------------------------------------------------
  app.post('/api/purchase', verifyMutationOrigin, async (req, res) => {
    const acct = getCurrentAccount(req);
    if (!acct) {
      res.status(401).json({ detail: 'Sign in required' });
      return;
    }

    const productCode =
      typeof req.body?.product_code === 'string' ? req.body.product_code.trim().toUpperCase() : '';
    const reduced = Boolean(req.body?.reduced);

    const db = getDb();
    const product = db
      .prepare('SELECT * FROM fare_products WHERE code = ?')
      .get(productCode) as FareProductRow | undefined;
    if (!product) {
      res.status(404).json({ detail: 'Unknown fare product' });
      return;
    }

    const price = reduced ? product.reduced_price_cents : product.price_cents;

    let result:
      | { insufficient: true }
      | {
          insufficient: false;
          wallet_cents: number;
          receipt_id: string;
          ticket: {
            id: string;
            product_code: string;
            product_name: string;
            status: string;
            rides_remaining: number | null;
            purchased_at: string;
            expires_at: string;
            qr_payload: string;
          };
        };

    const runPurchase = db.transaction(() => {
      const fresh = db
        .prepare('SELECT wallet_cents FROM accounts WHERE id = ?')
        .get(acct.id) as { wallet_cents: number };
      if (fresh.wallet_cents < price) {
        return { insufficient: true as const };
      }

      const now = new Date();
      const purchasedIso = now.toISOString();
      const expiresIso = new Date(
        now.getTime() + product.validity_minutes * 60 * 1000,
      ).toISOString();
      const ticketId = `tkt_${crypto.randomBytes(8).toString('hex')}`;
      const payload = makeQrPayload(ticketId);

      db.prepare(
        `INSERT INTO tickets
         (id, account_id, product_code, status, rides_remaining, purchased_at, expires_at, first_used_at, qr_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        ticketId,
        acct.id,
        product.code,
        'active',
        product.rides,
        purchasedIso,
        expiresIso,
        null,
        payload,
      );

      const newBalance = fresh.wallet_cents - price;
      db.prepare('UPDATE accounts SET wallet_cents = ? WHERE id = ?').run(newBalance, acct.id);

      const receiptId = nextReceiptNumber(db);
      const description = reduced ? `${product.name} (Reduced Fare)` : product.name;
      db.prepare(
        `INSERT INTO transactions
         (id, account_id, type, product_code, ticket_id, amount_cents, method, status, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receiptId,
        acct.id,
        'purchase',
        product.code,
        ticketId,
        price,
        'wallet',
        'completed',
        description,
        purchasedIso,
      );

      return {
        insufficient: false as const,
        wallet_cents: newBalance,
        receipt_id: receiptId,
        ticket: {
          id: ticketId,
          product_code: product.code,
          product_name: product.name,
          status: 'active',
          rides_remaining: product.rides,
          purchased_at: purchasedIso,
          expires_at: expiresIso,
          qr_payload: payload,
        },
      };
    });

    result = runPurchase();
    if (result.insufficient) {
      res.status(402).json({ detail: 'Insufficient funds. Please top up your wallet.' });
      return;
    }

    const dataUri = await qrDataUri(result.ticket.qr_payload);
    res.json({
      ok: true,
      wallet_cents: result.wallet_cents,
      receipt_id: result.receipt_id,
      ticket: {
        ...result.ticket,
        qr_png_data_uri: dataUri,
      },
    });
  });

  // -------------------------------------------------------------------------
  // My Tickets & Expiry Sweep
  // -------------------------------------------------------------------------
  app.get('/api/tickets', async (req, res) => {
    const acct = getCurrentAccount(req);
    if (!acct) {
      res.status(401).json({ detail: 'Sign in required' });
      return;
    }

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT t.*, p.name AS product_name
         FROM tickets t
         JOIN fare_products p ON p.code = t.product_code
         WHERE t.account_id = ?
         ORDER BY CASE WHEN t.status = 'active' THEN 0 ELSE 1 END, t.purchased_at DESC`,
      )
      .all(acct.id) as Array<TicketRow & { product_name: string }>;

    const tickets = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        qr_png_data_uri: await qrDataUri(row.qr_payload),
      })),
    );
    res.json({ tickets });
  });

  app.post('/api/tickets/expire-sweep', (_req, res) => {
    const db = getDb();
    const info = db
      .prepare(
        `UPDATE tickets SET status = 'expired'
         WHERE status = 'active' AND expires_at < ?`,
      )
      .run(nowIso());
    res.json({ expired: info.changes });
  });

  // -------------------------------------------------------------------------
  // Receipts (Proof of Purchase)
  // -------------------------------------------------------------------------
  app.get('/api/receipts', (req, res) => {
    const acct = getCurrentAccount(req);
    if (!acct) {
      res.status(401).json({ detail: 'Sign in required' });
      return;
    }

    const rows = getDb()
      .prepare(
        `SELECT * FROM transactions
         WHERE account_id = ?
         ORDER BY created_at DESC LIMIT 200`,
      )
      .all(acct.id);
    res.json({ receipts: rows });
  });

  app.get('/api/receipts/:txnId', (req, res) => {
    const acct = getCurrentAccount(req);
    if (!acct) {
      res.status(401).json({ detail: 'Sign in required' });
      return;
    }

    const db = getDb();
    const txn = db
      .prepare('SELECT * FROM transactions WHERE id = ? AND account_id = ?')
      .get(req.params.txnId, acct.id) as
      | {
          id: string;
          type: string;
          product_code: string | null;
          ticket_id: string | null;
          amount_cents: number;
          method: string;
          status: string;
          description: string;
          created_at: string;
        }
      | undefined;

    if (!txn) {
      res.status(404).json({ detail: 'Receipt not found' });
      return;
    }

    let ticket: Record<string, unknown> | null = null;
    if (txn.type === 'purchase') {
      if (txn.ticket_id) {
        ticket =
          (db
            .prepare(
              `SELECT t.id, t.status, t.rides_remaining, t.expires_at, p.name AS product_name
               FROM tickets t JOIN fare_products p ON p.code = t.product_code
               WHERE t.id = ? AND t.account_id = ?`,
            )
            .get(txn.ticket_id, acct.id) as Record<string, unknown> | undefined) ?? null;
      }
      if (!ticket && txn.product_code) {
        ticket =
          (db
            .prepare(
              `SELECT t.id, t.status, t.rides_remaining, t.expires_at, p.name AS product_name
               FROM tickets t JOIN fare_products p ON p.code = t.product_code
               WHERE t.account_id = ? AND t.product_code = ?
               ORDER BY t.purchased_at DESC LIMIT 1`,
            )
            .get(acct.id, txn.product_code) as Record<string, unknown> | undefined) ?? null;
      }
    }

    res.json({ receipt: txn, ticket });
  });

  // -------------------------------------------------------------------------
  // Operator Fare Validation (HMAC Verify + Atomic Consumption)
  // -------------------------------------------------------------------------
  app.post('/api/validate', (req, res) => {
    const payload = typeof req.body?.payload === 'string' ? req.body.payload.trim() : '';
    const routeId = typeof req.body?.route_id === 'string' ? req.body.route_id.trim() : '';
    const scannerId =
      typeof req.body?.scanner_id === 'string' && req.body.scanner_id.trim()
        ? req.body.scanner_id.trim().slice(0, 40)
        : 'SCN-000';
    const rawStop =
      typeof req.body?.stop_code === 'string' && req.body.stop_code.trim()
        ? req.body.stop_code.trim().toUpperCase()
        : null;

    const db = getDb();
    const routeExists = db.prepare('SELECT id FROM routes WHERE id = ?').get(routeId);
    if (!routeExists) {
      res.status(400).json({ detail: 'Please select a valid BFT route.' });
      return;
    }

    let stopCode: string | null = null;
    if (rawStop) {
      const stopExists = db.prepare('SELECT code FROM stops WHERE code = ?').get(rawStop);
      if (!stopExists) {
        res.status(400).json({ detail: 'Unknown stop code.' });
        return;
      }
      stopCode = rawStop;
    }

    const scannedAt = nowIso();

    const runValidation = db.transaction(() => {
      const logReject = (reason: string, ticketId: string | null = null) => {
        db.prepare(
          `INSERT INTO boardings
           (ticket_id, route_id, stop_id, result, reason, scanner_id, rider_ref, scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(ticketId, routeId, stopCode, 'rejected', reason, scannerId, 'R-UNKNOWN', scannedAt);
        return {
          result: 'rejected' as const,
          reason,
          rider_ref: 'R-UNKNOWN',
          scanned_at: scannedAt,
        };
      };

      // 1. Cryptographic signature verification (constant-time)
      const verified = verifyQrPayload(payload);
      if (!verified.ok) {
        return logReject(verified.reason, null);
      }
      const { ticketId } = verified;

      // 2. Ticket lookup
      const ticket = db
        .prepare('SELECT * FROM tickets WHERE id = ?')
        .get(ticketId) as TicketRow | undefined;
      if (!ticket) {
        return logReject('Ticket not found', null);
      }

      // 3. Status check
      if (ticket.status !== 'active') {
        return logReject(`Ticket is ${ticket.status}`, ticketId);
      }

      // 4. Expiry check
      if (ticket.expires_at < scannedAt) {
        db.prepare(`UPDATE tickets SET status = 'expired' WHERE id = ?`).run(ticketId);
        return logReject('Ticket is expired', ticketId);
      }

      // 5. Rides remaining check & consumption
      const product = db
        .prepare('SELECT * FROM fare_products WHERE code = ?')
        .get(ticket.product_code) as FareProductRow;

      let newRides: number | null = null;
      if (ticket.rides_remaining !== null) {
        if (ticket.rides_remaining <= 0) {
          db.prepare(`UPDATE tickets SET status = 'used' WHERE id = ?`).run(ticketId);
          return logReject('Ticket is used', ticketId);
        }
        newRides = ticket.rides_remaining - 1;
        db.prepare(
          `UPDATE tickets
           SET rides_remaining = ?,
               first_used_at = COALESCE(first_used_at, ?),
               status = CASE WHEN ? = 0 THEN 'used' ELSE status END
           WHERE id = ?`,
        ).run(newRides, scannedAt, newRides, ticketId);
      } else {
        db.prepare(
          `UPDATE tickets SET first_used_at = COALESCE(first_used_at, ?) WHERE id = ?`,
        ).run(scannedAt, ticketId);
      }

      const acct = db
        .prepare('SELECT email FROM accounts WHERE id = ?')
        .get(ticket.account_id) as { email: string } | undefined;
      const ref = acct ? riderRef(acct.email) : 'R-UNKNOWN';

      db.prepare(
        `INSERT INTO boardings
         (ticket_id, route_id, stop_id, result, reason, scanner_id, rider_ref, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ticketId, routeId, stopCode, 'accepted', 'OK', scannerId, ref, scannedAt);

      return {
        result: 'accepted' as const,
        reason: 'OK',
        ticket_id: ticketId,
        product_code: ticket.product_code,
        product_name: product.name,
        rides_remaining: newRides,
        expires_at: ticket.expires_at,
        rider_ref: ref,
        scanned_at: scannedAt,
      };
    });

    res.json(runValidation());
  });

  // -------------------------------------------------------------------------
  // Stop Posters ("Scan here to pay & ride")
  // -------------------------------------------------------------------------
  app.get('/api/stop/:code', (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const row = getDb().prepare('SELECT * FROM stops WHERE code = ?').get(code);
    if (!row) {
      res.status(404).json({ detail: 'Unknown stop' });
      return;
    }
    res.json(row);
  });

  app.get('/api/stop/:code/qr', async (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const row = getDb().prepare('SELECT * FROM stops WHERE code = ?').get(code);
    if (!row) {
      res.status(404).json({ detail: 'Unknown stop' });
      return;
    }
    const url = `/?stop=${encodeURIComponent(code)}`;
    const pngBuffer = await QRCode.toBuffer(url, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 3,
      width: 280,
      color: { dark: '#003a6e', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(pngBuffer);
  });

  // -------------------------------------------------------------------------
  // Agency Analytics Dashboard & CSV Export
  // -------------------------------------------------------------------------
  app.get('/api/admin/analytics', (req, res) => {
    const parsedDays = Number(req.query.days ?? 30);
    const days = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365 ? parsedDays : 30;
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const db = getDb();
    const kpis = {
      revenue_cents: (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS v FROM transactions
             WHERE status = 'completed' AND created_at >= ?`,
          )
          .get(since) as { v: number }
      ).v,
      boardings: (
        db
          .prepare('SELECT COUNT(*) AS v FROM boardings WHERE scanned_at >= ?')
          .get(since) as { v: number }
      ).v,
      accepted: (
        db
          .prepare(
            `SELECT COUNT(*) AS v FROM boardings
             WHERE scanned_at >= ? AND result = 'accepted'`,
          )
          .get(since) as { v: number }
      ).v,
      rejected: (
        db
          .prepare(
            `SELECT COUNT(*) AS v FROM boardings
             WHERE scanned_at >= ? AND result = 'rejected'`,
          )
          .get(since) as { v: number }
      ).v,
      active_tickets: (
        db.prepare(`SELECT COUNT(*) AS v FROM tickets WHERE status = 'active'`).get() as {
          v: number;
        }
      ).v,
      accounts: (db.prepare('SELECT COUNT(*) AS v FROM accounts').get() as { v: number }).v,
    };

    const revenue_by_day = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, SUM(amount_cents) AS cents
         FROM transactions
         WHERE status = 'completed' AND created_at >= ?
         GROUP BY day ORDER BY day ASC`,
      )
      .all(since);

    const rides_by_route = db
      .prepare(
        `SELECT ro.id AS route, ro.name AS route_name, ro.color, COUNT(b.id) AS boardings
         FROM routes ro
         LEFT JOIN boardings b ON b.route_id = ro.id AND b.scanned_at >= ?
         GROUP BY ro.id
         ORDER BY boardings DESC`,
      )
      .all(since);

    const product_breakdown = db
      .prepare(
        `SELECT p.name AS product, SUM(t.amount_cents) AS cents, COUNT(t.id) AS count
         FROM transactions t
         JOIN fare_products p ON p.code = t.product_code
         WHERE t.status = 'completed' AND t.type = 'purchase' AND t.created_at >= ?
         GROUP BY p.code
         ORDER BY cents DESC`,
      )
      .all(since);

    const revenue_by_method = db
      .prepare(
        `SELECT method, SUM(amount_cents) AS cents
         FROM transactions
         WHERE status = 'completed' AND created_at >= ?
         GROUP BY method
         ORDER BY cents DESC`,
      )
      .all(since);

    const rawTxns = db
      .prepare(
        `SELECT t.id, t.type, t.product_code, t.amount_cents, t.method, t.status, t.created_at, a.email
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         ORDER BY t.created_at DESC LIMIT 15`,
      )
      .all() as Array<Record<string, unknown> & { email: string }>;

    const recent_transactions = rawTxns.map((t) => ({
      ...t,
      email: maskEmail(t.email),
    }));

    const recent_validations = db
      .prepare(
        `SELECT route_id, result, reason, scanner_id, rider_ref, scanned_at
         FROM boardings
         ORDER BY scanned_at DESC LIMIT 15`,
      )
      .all();

    res.json({
      days,
      kpis,
      revenue_by_day,
      rides_by_route,
      product_breakdown,
      revenue_by_method,
      recent_transactions,
      recent_validations,
    });
  });

  app.get('/api/admin/export.csv', (req, res) => {
    const parsedDays = Number(req.query.days ?? 90);
    const days = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365 ? parsedDays : 90;
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const rows = getDb()
      .prepare(
        `SELECT t.id, t.type, t.product_code, t.amount_cents, t.method, t.status, t.created_at, a.email
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.created_at >= ?
         ORDER BY t.created_at ASC`,
      )
      .all(since) as Array<{
      id: string;
      type: string;
      product_code: string | null;
      amount_cents: number;
      method: string;
      status: string;
      created_at: string;
      email: string;
    }>;

    const lines = [
      'receipt_id,type,product,amount_cents,method,status,created_at,rider_ref',
      ...rows.map((r) =>
        [
          csvCell(r.id),
          csvCell(r.type),
          csvCell(r.product_code ?? ''),
          csvCell(r.amount_cents),
          csvCell(r.method),
          csvCell(r.status),
          csvCell(r.created_at),
          csvCell(riderRef(r.email)),
        ].join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bft-transactions.csv"');
    res.send(lines.join('\n') + '\n');
  });

  // -------------------------------------------------------------------------
  // Vite Dev Middleware or Static Production Build
  // -------------------------------------------------------------------------
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('App not built');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BFT QR Pay server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BFT QR Pay server:', err);
  process.exit(1);
});
