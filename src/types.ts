/**
 * src/types.ts -- Shared TypeScript interfaces for BFT QR Pay frontend.
 *
 * VERSION: 1.0.0 (initial release)
 */

export type SurfaceRoute = 'rider' | 'scanner' | 'dashboard' | 'receipt';

export interface MeResponse {
  signed_in: boolean;
  email?: string;
  wallet_cents?: number;
}

export interface FareProduct {
  code: string;
  name: string;
  price_cents: number;
  reduced_price_cents: number;
  validity_minutes: number;
  rides: number | null;
  mobile_only: number;
  description: string;
}

export interface TransitRoute {
  id: string;
  name: string;
  color: string;
}

export interface TransitStop {
  code: string;
  name: string;
}

export interface CatalogResponse {
  products: FareProduct[];
  routes: TransitRoute[];
  stops: TransitStop[];
}

export interface TicketItem {
  id: string;
  account_id?: number;
  product_code: string;
  product_name: string;
  status: 'active' | 'used' | 'expired' | string;
  rides_remaining: number | null;
  purchased_at: string;
  expires_at: string;
  first_used_at?: string | null;
  qr_payload: string;
  qr_png_data_uri: string;
}

export interface TransactionItem {
  id: string;
  account_id: number;
  type: 'topup' | 'purchase' | string;
  product_code: string | null;
  ticket_id?: string | null;
  amount_cents: number;
  method: 'wallet' | 'card' | string;
  status: 'completed' | 'failed' | string;
  description: string;
  created_at: string;
}

export interface ReceiptDetailResponse {
  receipt: TransactionItem;
  ticket: {
    id: string;
    status: string;
    rides_remaining: number | null;
    expires_at: string;
    product_name: string;
  } | null;
}

export interface ValidateResponse {
  result: 'accepted' | 'rejected';
  reason?: string;
  ticket_id?: string;
  product_code?: string;
  product_name?: string;
  rides_remaining?: number | null;
  expires_at?: string;
  rider_ref: string;
  scanned_at: string;
}

export interface AnalyticsResponse {
  days: number;
  kpis: {
    revenue_cents: number;
    boardings: number;
    accepted: number;
    rejected: number;
    active_tickets: number;
    accounts: number;
  };
  revenue_by_day: Array<{ day: string; cents: number }>;
  rides_by_route: Array<{
    route: string;
    route_name?: string;
    color: string;
    boardings: number;
  }>;
  product_breakdown: Array<{ product: string; cents: number; count?: number }>;
  revenue_by_method: Array<{ method: string; cents: number }>;
  recent_transactions: Array<{
    id: string;
    type: string;
    product_code: string | null;
    amount_cents: number;
    method: string;
    status: string;
    created_at: string;
    email: string;
  }>;
  recent_validations: Array<{
    route_id: string;
    result: string;
    reason: string;
    scanner_id: string;
    rider_ref: string;
    scanned_at: string;
  }>;
}
