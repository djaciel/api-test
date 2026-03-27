# Brale API Tests

Integration tests for the Brale API to document and track known issues.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your Brale testnet credentials
```

## Run

```bash
pnpm test
```

## Known Issues

### Transfer Pagination Bug (`page[next]` cursor ignored)

**Reported:** 2026-03-25

**Endpoint:** `GET /accounts/{account_id}/transfers?page[size]=5&page[next]={cursor}`

**Bug:** The `page[next]` cursor parameter is ignored. Page 2 returns the same results as page 1.

**Expected:** Passing the cursor from page 1 should return the next set of transfers.

**Actual:** The API returns the same 5 transfers regardless of the cursor value.

**Test:** `tests/pagination.test.ts` — the test named `"BUG: page 2 with cursor should return different results than page 1"` will fail until Brale fixes this.

**Workaround:** Fetch all transfers with a large `page[size]` (e.g., 50) and paginate client-side.

#### Test code

```typescript
// 1. Fetch page 1
const page1 = await fetch(
  `https://api.brale.xyz/accounts/${accountId}/transfers?page[size]=5`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const data1 = await page1.json();
const cursor = data1.pagination.next;

// 2. Fetch page 2 using cursor
const page2 = await fetch(
  `https://api.brale.xyz/accounts/${accountId}/transfers?page[size]=5&page[next]=${encodeURIComponent(cursor)}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const data2 = await page2.json();

// 3. Compare — these should be different but are identical
const page1Ids = data1.transfers.map((t) => t.id);
const page2Ids = data2.transfers.map((t) => t.id);
console.log('Same results?', JSON.stringify(page1Ids) === JSON.stringify(page2Ids));
// Output: Same results? true  <-- BUG
```
