/**
 * src/server/db.ts -- SQLite database layer, BFT 2025 catalogs, HMAC QR signing,
 * and deterministic 90-day demo data seeder for BFT QR Pay.
 *
 * VERSION: 1.0.0 (initial release)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Paths & Signing Secret
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'bft.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Read signing secret from environment when configured; otherwise generate
// an ephemeral 256-bit secret in memory (never written to plaintext files).
const QR_SIGNING_SECRET =
  process.env.BFT_QR_SECRET && process.env.BFT_QR_SECRET.trim().length >= 16
    ? process.env.BFT_QR_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

export function signTicketId(ticketId: string): string {
  return crypto
    .createHmac('sha256', QR_SIGNING_SECRET)
    .update(ticketId, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export function makeQrPayload(ticketId: string): string {
  return `BFT1:${ticketId}:${signTicketId(ticketId)}`;
}

export function verifyQrPayload(payload: string): { ok: true; ticketId: string } | { ok: false; reason: string } {
  const parts = String(payload || '').trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'BFT1') {
    return { ok: false, reason: 'Malformed QR payload' };
  }
  const [, ticketId, sig] = parts;
  if (!ticketId || !/^[a-f0-9]{16}$/i.test(sig)) {
    return { ok: false, reason: 'Invalid QR signature' };
  }
  const expected = signTicketId(ticketId);
  const sigBuf = Buffer.from(sig.toLowerCase(), 'utf8');
  const expBuf = Buffer.from(expected.toLowerCase(), 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'Invalid QR signature' };
  }
  return { ok: true, ticketId };
}

export function riderRef(email: string): string {
  return 'R-' + crypto.createHash('sha1').update(email, 'utf8').digest('hex').slice(0, 8);
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Static BFT Reference Catalogs (Ben Franklin Transit, Tri-Cities WA)
// ---------------------------------------------------------------------------
export const ROUTES: ReadonlyArray<[string, string, string]> = [
  ['26', 'Kennewick - Columbia Park', '#00539b'],
  ['27', 'Kennewick - Clearwater', '#00843d'],
  ['100', 'Tri-Cities Airport / Pasco', '#ffb500'],
  ['110', 'Pasco - Downtown Loop', '#c0392b'],
  ['120', 'Pasco - Road 68', '#6a3d9a'],
  ['150', 'Richland - Queensgate', '#e07b00'],
  ['160', 'Richland - Horn Rapids', '#00838f'],
  ['210', 'Kennewick - Richland Express', '#00539b'],
  ['225', 'Pasco - Kennewick Express', '#003a6e'],
  ['230', 'Richland - Pasco Express', '#00843d'],
  ['240', 'West Richland - Badger Mountain', '#7b1fa2'],
  ['250', 'Kennewick - Southridge', '#ad1457'],
  ['270', 'Hanford 300 Area', '#5d4037'],
  ['500', 'Connell Commuter', '#455a64'],
  ['BENTON', 'Benton City Commuter', '#f57f17'],
];

// BFT 2025 published fare structure
export const FARE_PRODUCTS: ReadonlyArray<
  [string, string, number, number, number, number | null, number, string]
> = [
  [
    'SINGLE',
    'Single Ride',
    100,
    50,
    120,
    1,
    0,
    'One ride on any BFT route. Valid 2 hours from first scan.',
  ],
  [
    'DAY',
    'Day Pass',
    300,
    150,
    1440,
    null,
    1,
    'Unlimited rides for 24 hours. Mobile app only.',
  ],
  [
    'RIDE10',
    '10-Ride Book',
    800,
    400,
    525600,
    10,
    0,
    'Ten rides, usable one at a time. Valid 12 months.',
  ],
  [
    'MONTH',
    'Monthly Pass',
    1000,
    500,
    43200,
    null,
    0,
    'Unlimited rides for 30 days.',
  ],
  [
    'YEAR',
    'Yearly Pass',
    12000,
    6000,
    525600,
    null,
    1,
    'Unlimited rides for 12 months. Mobile app only.',
  ],
];

export const STOPS: ReadonlyArray<[string, string]> = [
  ['TC-KEN', 'Tri-Cities Station - Kennewick'],
  ['TC-PAS', 'Tri-Cities Station - Pasco'],
  ['TC-RIC', 'Tri-Cities Station - Richland'],
  ['TC-QUE', 'Queensgate Park & Ride'],
  ['STP-CCM', 'Columbia Center Mall'],
  ['STP-CPP', 'Columbia Park'],
  ['STP-VGS', 'Village Green - Pasco'],
  ['STP-3RV', 'Three Rivers Convention Center'],
];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    wallet_cents  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fare_products (
    code                TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    price_cents         INTEGER NOT NULL,
    reduced_price_cents INTEGER NOT NULL,
    validity_minutes    INTEGER NOT NULL,
    rides               INTEGER,
    mobile_only         INTEGER NOT NULL DEFAULT 0,
    description         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
    id              TEXT PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    product_code    TEXT NOT NULL REFERENCES fare_products(code),
    status          TEXT NOT NULL DEFAULT 'active',
    rides_remaining INTEGER,
    purchased_at    TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    first_used_at   TEXT,
    qr_payload      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,
    account_id    INTEGER NOT NULL REFERENCES accounts(id),
    type          TEXT NOT NULL,
    product_code  TEXT,
    ticket_id     TEXT,
    amount_cents  INTEGER NOT NULL,
    method        TEXT NOT NULL,
    status        TEXT NOT NULL,
    description   TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boardings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   TEXT REFERENCES tickets(id),
    route_id    TEXT NOT NULL REFERENCES routes(id),
    stop_id     TEXT REFERENCES stops(code),
    result      TEXT NOT NULL,
    reason      TEXT NOT NULL,
    scanner_id  TEXT NOT NULL,
    rider_ref   TEXT NOT NULL,
    scanned_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stops (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_account ON tickets(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_account     ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_boardings_time  ON boardings(scanned_at);
CREATE INDEX IF NOT EXISTS idx_txn_time        ON transactions(created_at);
`;

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32, seed = 42)
// ---------------------------------------------------------------------------
function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random: next,
    randInt(min: number, max: number) {
      return min + Math.floor(next() * (max - min + 1));
    },
    choice<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
      const total = weights.reduce((a, b) => a + b, 0);
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    hex(bytes: number) {
      let out = '';
      for (let i = 0; i < bytes * 2; i++) {
        out += Math.floor(next() * 16).toString(16);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Database Singleton & Seeder
// ---------------------------------------------------------------------------
let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('foreign_keys = ON');
    initDb(dbInstance, true);
  }
  return dbInstance;
}

export function nextReceiptNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const prefix = `BFT-${year}-`;
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE id LIKE ? ORDER BY id DESC LIMIT 1`,
    )
    .get(`${prefix}%`) as { id: string } | undefined;

  let seq = 1;
  if (row && row.id.startsWith(prefix)) {
    const parsed = parseInt(row.id.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function initDb(db: Database.Database, seedDemo: boolean): void {
  db.exec(SCHEMA);

  // Upsert static BFT catalogs
  const upsertRoute = db.prepare(
    'INSERT OR REPLACE INTO routes (id, name, color) VALUES (?, ?, ?)',
  );
  const upsertProduct = db.prepare(
    `INSERT OR REPLACE INTO fare_products
     (code, name, price_cents, reduced_price_cents, validity_minutes, rides, mobile_only, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertStop = db.prepare(
    'INSERT OR REPLACE INTO stops (code, name) VALUES (?, ?)',
  );

  const seedCatalogs = db.transaction(() => {
    for (const [id, name, color] of ROUTES) {
      upsertRoute.run(id, name, color);
    }
    for (const p of FARE_PRODUCTS) {
      upsertProduct.run(...p);
    }
    for (const [code, name] of STOPS) {
      upsertStop.run(code, name);
    }
  });
  seedCatalogs();

  const countRow = db
    .prepare('SELECT COUNT(*) AS n FROM transactions')
    .get() as { n: number };

  if (seedDemo && countRow.n === 0) {
    seedDemoData(db);
  } else if (!process.env.BFT_QR_SECRET) {
    // When using an ephemeral in-memory secret in dev, re-sign stored tickets
    // on startup so tickets rendered in My Tickets validate against this instance.
    const existing = db.prepare('SELECT id FROM tickets').all() as Array<{ id: string }>;
    const updateSig = db.prepare('UPDATE tickets SET qr_payload = ? WHERE id = ?');
    const resign = db.transaction(() => {
      for (const row of existing) {
        updateSig.run(makeQrPayload(row.id), row.id);
      }
    });
    resign();
  }
}

function seedDemoData(db: Database.Database): void {
  const rng = createRng(42);
  const now = new Date();
  const insertAccount = db.prepare(
    'INSERT INTO accounts (email, wallet_cents, created_at) VALUES (?, ?, ?)',
  );
  const insertTxn = db.prepare(
    `INSERT INTO transactions
     (id, account_id, type, product_code, ticket_id, amount_cents, method, status, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTicket = db.prepare(
    `INSERT INTO tickets
     (id, account_id, product_code, status, rides_remaining, purchased_at, expires_at, first_used_at, qr_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertBoarding = db.prepare(
    `INSERT INTO boardings
     (ticket_id, route_id, stop_id, result, reason, scanner_id, rider_ref, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const runSeed = db.transaction(() => {
    const accounts: Array<{ id: number; email: string }> = [];
    const balanceChoices = [0, 0, 500, 1000, 2000, 5000];
    for (let i = 0; i < 40; i++) {
      const email = `rider${i + 1}@example.com`;
      const created = new Date(
        now.getTime() - (90 * 86400 + rng.randInt(0, 10000) * 60) * 1000,
      );
      const res = insertAccount.run(email, rng.choice(balanceChoices), created.toISOString());
      accounts.push({ id: Number(res.lastInsertRowid), email });
    }

    const productMap = new Map(FARE_PRODUCTS.map((p) => [p[0], p]));
    const productCodes = FARE_PRODUCTS.map((p) => p[0]);
    const weights = [55, 25, 8, 10, 2];
    const routeIds = ROUTES.map((r) => r[0]);
    const stopCodes = STOPS.map((s) => s[0]);

    const seqByYear = new Map<number, number>();
    const nextSeedReceipt = (year: number) => {
      const cur = (seqByYear.get(year) ?? 0) + 1;
      seqByYear.set(year, cur);
      return `BFT-${year}-${String(cur).padStart(6, '0')}`;
    };

    for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
      const day = new Date(now.getTime() - dayOffset * 86400 * 1000);
      const dow = day.getUTCDay(); // 0=Sun, 6=Sat
      const isWeekend = dow === 0 || dow === 6;
      const nPurchases = isWeekend ? rng.randInt(5, 11) : rng.randInt(12, 22);

      for (let k = 0; k < nPurchases; k++) {
        const acct = rng.choice(accounts);
        const productCode = rng.weightedChoice(productCodes, weights);
        const [, name, price, reduced, validity, rides] = productMap.get(productCode)!;

        const purchased = new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            rng.randInt(5, 21),
            rng.randInt(0, 59),
            rng.randInt(0, 59),
          ),
        );
        if (purchased.getTime() > now.getTime()) {
          purchased.setTime(now.getTime() - rng.randInt(5, 180) * 60 * 1000);
        }

        const amount = rng.random() < 0.2 ? reduced : price;
        const method = rng.random() < 0.7 ? 'wallet' : 'card';
        const receiptId = nextSeedReceipt(purchased.getUTCFullYear());

        const ticketId = `tkt_${rng.hex(8)}`;
        const payload = makeQrPayload(ticketId);
        const expires = new Date(purchased.getTime() + validity * 60 * 1000);
        const isStillActive =
          expires.getTime() > now.getTime() &&
          (productCode === 'MONTH' || productCode === 'YEAR' || productCode === 'RIDE10' || dayOffset === 0);

        insertTxn.run(
          receiptId,
          acct.id,
          'purchase',
          productCode,
          ticketId,
          amount,
          method,
          'completed',
          name,
          purchased.toISOString(),
        );

        insertTicket.run(
          ticketId,
          acct.id,
          productCode,
          isStillActive ? 'active' : 'used',
          rides !== null ? Math.max(0, rides - 1) : null,
          purchased.toISOString(),
          expires.toISOString(),
          purchased.toISOString(),
          payload,
        );

        const nBoardings = productCode === 'SINGLE' ? 1 : rng.randInt(2, 6);
        const maxLead = Math.min(90, validity);
        for (let b = 0; b < nBoardings; b++) {
          const boarded = new Date(purchased.getTime() + rng.randInt(1, maxLead) * 60 * 1000);
          if (boarded.getTime() > expires.getTime() || boarded.getTime() > now.getTime()) continue;
          insertBoarding.run(
            ticketId,
            rng.choice(routeIds),
            rng.choice(stopCodes),
            'accepted',
            'OK',
            `SCN-${rng.randInt(100, 999)}`,
            riderRef(acct.email),
            boarded.toISOString(),
          );
        }

        if (rng.random() < 0.05) {
          const rejectedAt = new Date(
            Math.min(now.getTime(), purchased.getTime() + rng.randInt(30, 200) * 60 * 1000),
          );
          insertBoarding.run(
            null,
            rng.choice(routeIds),
            rng.choice(stopCodes),
            'rejected',
            rng.choice(['Ticket is expired', 'Ticket is used']),
            `SCN-${rng.randInt(100, 999)}`,
            'R-UNKNOWN',
            rejectedAt.toISOString(),
          );
        }
      }
    }
  });

  runSeed();
}
