/**
 * Brale API — Transfer Pagination
 * ================================
 *
 * Bug (reported 2026-03-25):
 *   GET /accounts/{id}/transfers?page[next]={cursor} returns the same
 *   results as page 1. The cursor parameter is ignored by the API.
 *
 * Fix (suggested by Brale):
 *   Use page[after] instead of page[next]. Confirmed working 2026-03-30.
 *
 * This test validates both:
 *   - page[next]  — the documented param (broken)
 *   - page[after] — the suggested fix (working)
 *
 * Prerequisites:
 *   - .env file with BRALE_CLIENT_ID and BRALE_CLIENT_SECRET
 *   - At least 6 transfers in the account (more than one page)
 *
 * Run: pnpm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.brale.xyz';
const AUTH_URL = 'https://auth.brale.xyz/oauth2/token';
const PAGE_SIZE = 5;

function loadEnv(): { clientId: string; clientSecret: string; accountId?: string } {
  const envPath = resolve(__dirname, '../.env');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    throw new Error(`.env file not found at ${envPath}. Copy .env.example to .env and fill in your credentials.`);
  }

  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key) vars[key] = rest.join('=');
  }

  if (!vars.BRALE_CLIENT_ID || !vars.BRALE_CLIENT_SECRET) {
    throw new Error('BRALE_CLIENT_ID and BRALE_CLIENT_SECRET must be set in .env');
  }

  return {
    clientId: vars.BRALE_CLIENT_ID,
    clientSecret: vars.BRALE_CLIENT_SECRET,
    accountId: vars.BRALE_ACCOUNT_ID,
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function authenticate(clientId: string, clientSecret: string): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function getAccounts(token: string): Promise<{ id: string; name: string }[]> {
  const response = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Failed to fetch accounts: ${response.status}`);
  const data = (await response.json()) as { accounts: { id: string; name: string }[] };
  return data.accounts;
}

interface TransferListResponse {
  transfers: { id: string; status: string; created_at: string }[];
  pagination?: { next?: string; page_size?: number };
}

async function getTransfers(
  token: string,
  accountId: string,
  pageSize: number,
  cursor?: string,
  cursorParam: 'page[next]' | 'page[after]' = 'page[next]',
): Promise<TransferListResponse> {
  const url = new URL(`${API_BASE}/accounts/${accountId}/transfers`);
  url.searchParams.set('page[size]', String(pageSize));
  if (cursor) url.searchParams.set(cursorParam, cursor);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Failed to fetch transfers: ${response.status} ${response.statusText}`);
  return (await response.json()) as TransferListResponse;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Brale API — Transfer Pagination', () => {
  let token: string;
  let accountId: string;
  const env = loadEnv();

  beforeAll(async () => {
    token = await authenticate(env.clientId, env.clientSecret);
    if (env.accountId) {
      accountId = env.accountId;
    } else {
      const accounts = await getAccounts(token);
      expect(accounts.length).toBeGreaterThan(0);
      accountId = accounts[0]!.id;
    }
  }, 15_000);

  it('should authenticate successfully', () => {
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  });

  it('should return transfers for page 1', async () => {
    const page1 = await getTransfers(token, accountId, PAGE_SIZE);
    expect(page1.transfers).toBeDefined();
    expect(page1.transfers.length).toBeGreaterThan(0);
    expect(page1.transfers.length).toBeLessThanOrEqual(PAGE_SIZE);
  }, 10_000);

  it('should return a pagination cursor when there are more results', async () => {
    const page1 = await getTransfers(token, accountId, PAGE_SIZE);
    expect(page1.pagination?.next).toBeDefined();
    expect(typeof page1.pagination?.next).toBe('string');
    expect(page1.pagination!.next!.length).toBeGreaterThan(0);
  }, 10_000);

  it('BUG: page 2 with cursor should return different results than page 1', async () => {
    const page1 = await getTransfers(token, accountId, PAGE_SIZE);
    const cursor = page1.pagination?.next;

    if (!cursor) {
      console.warn('Skipping: not enough transfers for pagination test (need > 5)');
      return;
    }

    const page2 = await getTransfers(token, accountId, PAGE_SIZE, cursor);

    const page1Ids = page1.transfers.map((t) => t.id);
    const page2Ids = page2.transfers.map((t) => t.id);

    const overlapping = page2Ids.filter((id) => page1Ids.includes(id));
    const unique = page2Ids.filter((id) => !page1Ids.includes(id));

    console.log('\n========== PAGINATION TEST: Page 1 vs Page 2 (size=%d) ==========', PAGE_SIZE);
    console.log('Account ID:  ', accountId);
    console.log('Page size:   ', PAGE_SIZE);
    console.log('Cursor used: ', cursor);
    console.log('');
    console.log('Page 1 IDs (%d):', page1Ids.length, page1Ids);
    console.log('Page 2 IDs (%d):', page2Ids.length, page2Ids);
    console.log('');
    console.log('Overlapping IDs: %d / %d', overlapping.length, page2Ids.length, overlapping);
    console.log('Unique in page 2: %d / %d', unique.length, page2Ids.length, unique);
    console.log('Are pages identical?', JSON.stringify(page1Ids) === JSON.stringify(page2Ids) ? 'YES (BUG)' : 'NO (OK)');
    console.log('================================================================\n');

    expect(page2Ids).not.toEqual(page1Ids);
  }, 15_000);

  it('BUG: page 2 with page size 3 should return different results than page 1', async () => {
    const smallPageSize = 3;
    const page1 = await getTransfers(token, accountId, smallPageSize);
    const cursor = page1.pagination?.next;

    if (!cursor) {
      console.warn('Skipping: not enough transfers for pagination test (need > 3)');
      return;
    }

    const page2 = await getTransfers(token, accountId, smallPageSize, cursor);

    const page1Ids = page1.transfers.map((t) => t.id);
    const page2Ids = page2.transfers.map((t) => t.id);

    const overlapping = page2Ids.filter((id) => page1Ids.includes(id));
    const unique = page2Ids.filter((id) => !page1Ids.includes(id));

    console.log('\n========== PAGINATION TEST: Page 1 vs Page 2 (size=%d) ==========', smallPageSize);
    console.log('Account ID:  ', accountId);
    console.log('Page size:   ', smallPageSize);
    console.log('Cursor used: ', cursor);
    console.log('');
    console.log('Page 1 IDs (%d):', page1Ids.length, page1Ids);
    console.log('Page 2 IDs (%d):', page2Ids.length, page2Ids);
    console.log('');
    console.log('Overlapping IDs: %d / %d', overlapping.length, page2Ids.length, overlapping);
    console.log('Unique in page 2: %d / %d', unique.length, page2Ids.length, unique);
    console.log('Are pages identical?', JSON.stringify(page1Ids) === JSON.stringify(page2Ids) ? 'YES (BUG)' : 'NO (OK)');
    console.log('================================================================\n');

    expect(page2Ids).not.toEqual(page1Ids);
  }, 15_000);

  it('BUG: page 3 should return different results than pages 1 and 2', async () => {
    const page1 = await getTransfers(token, accountId, PAGE_SIZE);
    const cursor1 = page1.pagination?.next;

    if (!cursor1) {
      console.warn('Skipping: not enough transfers for 3-page pagination test (need > 10)');
      return;
    }

    const page2 = await getTransfers(token, accountId, PAGE_SIZE, cursor1);
    const cursor2 = page2.pagination?.next;

    if (!cursor2) {
      console.warn('Skipping: not enough transfers for page 3 test (need > 10)');
      return;
    }

    const page3 = await getTransfers(token, accountId, PAGE_SIZE, cursor2);

    const page1Ids = page1.transfers.map((t) => t.id);
    const page2Ids = page2.transfers.map((t) => t.id);
    const page3Ids = page3.transfers.map((t) => t.id);

    const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
    const uniqueTotal = new Set(allIds);
    const p3OverlapP1 = page3Ids.filter((id) => page1Ids.includes(id));
    const p3OverlapP2 = page3Ids.filter((id) => page2Ids.includes(id));

    console.log('\n========== PAGINATION TEST: Pages 1, 2, 3 (size=%d) ==========', PAGE_SIZE);
    console.log('Account ID:  ', accountId);
    console.log('Page size:   ', PAGE_SIZE);
    console.log('Cursor 1:    ', cursor1);
    console.log('Cursor 2:    ', cursor2);
    console.log('');
    console.log('Page 1 IDs (%d):', page1Ids.length, page1Ids);
    console.log('Page 2 IDs (%d):', page2Ids.length, page2Ids);
    console.log('Page 3 IDs (%d):', page3Ids.length, page3Ids);
    console.log('');
    console.log('Page 3 overlaps with page 1: %d / %d', p3OverlapP1.length, page3Ids.length, p3OverlapP1);
    console.log('Page 3 overlaps with page 2: %d / %d', p3OverlapP2.length, page3Ids.length, p3OverlapP2);
    console.log('Total IDs across 3 pages: %d, Unique: %d', allIds.length, uniqueTotal.size);
    console.log('Expected unique (if working): %d', page1Ids.length + page2Ids.length + page3Ids.length);
    console.log('================================================================\n');

    expect(page3Ids).not.toEqual(page1Ids);
    expect(page3Ids).not.toEqual(page2Ids);
  }, 20_000);

  // -------------------------------------------------------------------------
  // page[after] tests (the fix suggested by Brale)
  // -------------------------------------------------------------------------

  it('FIX: page[after] page 2 should return different results than page 1', async () => {
    const page1 = await getTransfers(token, accountId, PAGE_SIZE);
    const cursor = page1.pagination?.next;

    if (!cursor) {
      console.warn('Skipping: not enough transfers for pagination test (need > 5)');
      return;
    }

    const page2 = await getTransfers(token, accountId, PAGE_SIZE, cursor, 'page[after]');

    const page1Ids = page1.transfers.map((t) => t.id);
    const page2Ids = page2.transfers.map((t) => t.id);

    const overlapping = page2Ids.filter((id) => page1Ids.includes(id));

    console.log('\n========== page[after] TEST: Page 1 vs Page 2 (size=%d) ==========', PAGE_SIZE);
    console.log('Page 1 IDs (%d):', page1Ids.length, page1Ids);
    console.log('Page 2 IDs (%d):', page2Ids.length, page2Ids);
    console.log('Overlapping: %d', overlapping.length);
    console.log('Are pages identical?', JSON.stringify(page1Ids) === JSON.stringify(page2Ids) ? 'YES (BUG)' : 'NO (OK)');
    console.log('====================================================================\n');

    expect(page2Ids).not.toEqual(page1Ids);
    expect(overlapping.length).toBe(0);
  }, 15_000);

  it('FIX: page[after] 3 pages should have zero overlap', async () => {
    const page1 = await getTransfers(token, accountId, PAGE_SIZE);
    const cursor1 = page1.pagination?.next;

    if (!cursor1) {
      console.warn('Skipping: not enough transfers for 3-page test (need > 10)');
      return;
    }

    const page2 = await getTransfers(token, accountId, PAGE_SIZE, cursor1, 'page[after]');
    const cursor2 = page2.pagination?.next;

    if (!cursor2) {
      console.warn('Skipping: not enough transfers for page 3 test (need > 10)');
      return;
    }

    const page3 = await getTransfers(token, accountId, PAGE_SIZE, cursor2, 'page[after]');

    const page1Ids = page1.transfers.map((t) => t.id);
    const page2Ids = page2.transfers.map((t) => t.id);
    const page3Ids = page3.transfers.map((t) => t.id);

    const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
    const uniqueTotal = new Set(allIds);

    console.log('\n========== page[after] TEST: Pages 1, 2, 3 (size=%d) ==========', PAGE_SIZE);
    console.log('Page 1 IDs (%d):', page1Ids.length, page1Ids);
    console.log('Page 2 IDs (%d):', page2Ids.length, page2Ids);
    console.log('Page 3 IDs (%d):', page3Ids.length, page3Ids);
    console.log('Total: %d, Unique: %d', allIds.length, uniqueTotal.size);
    console.log('================================================================\n');

    expect(uniqueTotal.size).toBe(allIds.length);
  }, 20_000);

  // -------------------------------------------------------------------------
  // General tests
  // -------------------------------------------------------------------------

  it('should return transfers sorted by created_at descending', async () => {
    const result = await getTransfers(token, accountId, 20);
    if (result.transfers.length < 2) {
      console.warn('Skipping: not enough transfers to verify sort order');
      return;
    }
    const dates = result.transfers.map((t) => new Date(t.created_at).getTime());
    const isSortedDesc = dates.every((d, i) => i === 0 || d <= dates[i - 1]!);
    expect(isSortedDesc).toBe(true);
  }, 10_000);
});
