# Phase 6: User-Scoped Portfolio API Endpoints

All portfolio endpoints now require JWT authentication and automatically scope data to the authenticated user.

## Endpoints Created

### Holdings Management
- `GET /api/portfolio/holdings` — List all holdings for authenticated user
- `POST /api/portfolio/holdings` — Create new holding
- `PUT /api/portfolio/holdings` — Update holding (by id)
- `DELETE /api/portfolio/holdings` — Delete holding (by id)

### Transactions
- `GET /api/portfolio/transactions` — List all transactions for user's holdings
- `POST /api/portfolio/transactions` — Create new transaction
- `PUT /api/portfolio/transactions` — Update transaction (by id)
- `DELETE /api/portfolio/transactions` — Delete transaction (by id)

### Snapshots (Portfolio Value History)
- `GET /api/portfolio/snapshots` — List all snapshots for user
- `POST /api/portfolio/snapshots` — Create new snapshot
- `PUT /api/portfolio/snapshots` — Update snapshot (by id)
- `DELETE /api/portfolio/snapshots` — Delete snapshot (by id)

### Settings
- `GET /api/portfolio/settings` — Get user settings (base_currency, theme)
- `PUT /api/portfolio/settings` — Update settings

## Security Model

**Every endpoint:**
1. Calls `requireAuth(req)` to verify JWT from cookie
2. Extracts `user.userId` from the JWT token
3. Filters all queries by `user_id = $1` (WHERE clause with user ID)
4. Verifies ownership before UPDATE/DELETE operations

**Examples:**

Holdings GET:
```sql
SELECT * FROM holdings WHERE user_id = $1
```

Transaction DELETE:
```sql
DELETE FROM transactions t
WHERE t.id = $1 AND EXISTS (
  SELECT 1 FROM holdings h
  WHERE h.id = t.holding_id AND h.user_id = $2
)
```

## Testing the Endpoints

### Prerequisites
1. Auth flow is working (signup/login/logout)
2. Database is initialized with schema
3. User is logged in and has a valid JWT cookie

### Test Sequence (cURL examples)

**1. Verify auth is working**
```bash
curl -b "auth=<your_jwt_cookie>" http://localhost:3001/api/auth/me
# Expected: { userId, email }
```

**2. Create a holding**
```bash
curl -X POST http://localhost:3001/api/portfolio/holdings \
  -b "auth=<your_jwt_cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "name": "Apple Inc",
    "type": "stock",
    "sector": "Technology",
    "shares": 10,
    "avg_cost": 150.50,
    "currency": "GBP",
    "notes": "Tech holdings"
  }'
# Expected: { holding: { id, ticker, name, type, sector, shares, avg_cost, currency, notes, created_at, updated_at } }
```

**3. List holdings**
```bash
curl -b "auth=<your_jwt_cookie>" http://localhost:3001/api/portfolio/holdings
# Expected: { holdings: [{ id, ticker, name, ... }] }
```

**4. Update holding**
```bash
curl -X PUT http://localhost:3001/api/portfolio/holdings \
  -b "auth=<your_jwt_cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<holding_id>",
    "shares": 15,
    "avg_cost": 155.00
  }'
# Expected: { holding: { id, ticker, shares: 15, avg_cost: 155.00, ... } }
```

**5. Create transaction**
```bash
curl -X POST http://localhost:3001/api/portfolio/transactions \
  -b "auth=<your_jwt_cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "holding_id": "<holding_id>",
    "transaction_type": "buy",
    "shares": 10,
    "price": 150.50,
    "currency": "GBP",
    "transaction_date": "2026-04-30",
    "notes": "Initial purchase"
  }'
# Expected: { transaction: { id, holding_id, transaction_type, shares, price, ... } }
```

**6. List transactions**
```bash
curl -b "auth=<your_jwt_cookie>" http://localhost:3001/api/portfolio/transactions
# Expected: { transactions: [{ id, holding_id, transaction_type, shares, price, ... }] }
```

**7. Create snapshot**
```bash
curl -X POST http://localhost:3001/api/portfolio/snapshots \
  -b "auth=<your_jwt_cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshot_date": "2026-04-30",
    "total_value": 1500.00,
    "notes": "Monthly snapshot"
  }'
# Expected: { snapshot: { id, snapshot_date, total_value, notes, created_at } }
```

**8. List snapshots**
```bash
curl -b "auth=<your_jwt_cookie>" http://localhost:3001/api/portfolio/snapshots
# Expected: { snapshots: [{ id, snapshot_date, total_value, ... }] }
```

**9. Get settings**
```bash
curl -b "auth=<your_jwt_cookie>" http://localhost:3001/api/portfolio/settings
# Expected: { settings: { id, base_currency: 'GBP', theme: 'dark', ... } }
```

**10. Update settings**
```bash
curl -X PUT http://localhost:3001/api/portfolio/settings \
  -b "auth=<your_jwt_cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "base_currency": "USD",
    "theme": "light"
  }'
# Expected: { settings: { id, base_currency: 'USD', theme: 'light', ... } }
```

## Error Handling

**401 Unauthorized** — No valid JWT cookie:
```bash
curl http://localhost:3001/api/portfolio/holdings
# Response: { error: 'Unauthorized' }
```

**400 Bad Request** — Missing required fields:
```bash
curl -X POST http://localhost:3001/api/portfolio/holdings \
  -b "auth=<jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "ticker": "AAPL" }'
# Response: { error: 'Missing required fields' }
```

**404 Not Found** — Holding/transaction doesn't exist or doesn't belong to user:
```bash
curl -X PUT http://localhost:3001/api/portfolio/holdings \
  -b "auth=<jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "id": "wrong_id", "shares": 20 }'
# Response: { error: 'Holding not found' }
```

**409 Conflict** — Duplicate snapshot for same date:
```bash
curl -X POST http://localhost:3001/api/portfolio/snapshots \
  -b "auth=<jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "snapshot_date": "2026-04-30", "total_value": 1600 }'
# (assuming snapshot for 2026-04-30 already exists)
# Response: { error: 'Snapshot already exists for this date' }
```

## Data Isolation Verification

**Test 1: Create holdings as User A, verify User B cannot see them**
1. Login as User A, create holding
2. Logout, login as User B
3. GET /api/portfolio/holdings should return empty list
4. User B cannot see User A's holdings ✓

**Test 2: Create transaction on User A's holding, verify User B cannot delete it**
1. Login as User A, create holding, create transaction
2. Copy transaction ID
3. Logout, login as User B
4. DELETE /api/portfolio/transactions with User A's transaction ID
5. Response: { error: 'Transaction not found' } ✓
6. Verify User A's transaction still exists

**Test 3: Snapshots are isolated**
1. Login as User A, create snapshot for 2026-04-30
2. Logout, login as User B
3. Create snapshot for 2026-04-30 (should succeed — different user)
4. Both users have their own snapshot for same date ✓

## Database Constraints

All foreign keys have `ON DELETE CASCADE`, so:
- Deleting a user deletes all their holdings, transactions, snapshots, and settings
- Deleting a holding deletes all related transactions

## Next Steps (Phase 7+)

1. **Frontend integration** — Update React components to call these endpoints
2. **Portfolio calculations** — Add endpoints for:
   - Total portfolio value (sum of shares × current price)
   - Gain/loss calculation (current value - avg cost basis)
   - Sector allocation percentages
   - Dividend yield calculations
3. **Price integration** — Refresh prices from Yahoo Finance and cache
4. **Role-based access control** — Add admin roles, shared portfolios
5. **Export/reporting** — CSV export, PDF reports, tax reporting
