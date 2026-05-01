# Local Auth Testing Guide

## Phase 5: Manual Testing

The auth implementation is complete and ready for testing. This guide walks through the full signup → login → authenticated request → logout flow locally.

### Prerequisites

1. **PostgreSQL running locally** (macOS with Homebrew):
   ```bash
   brew services start postgresql
   ```

2. **Database initialized** with schema:
   ```bash
   createdb firefly
   psql firefly < db/schema.sql
   ```

3. **Test user seeded** (optional, for testing):
   ```bash
   node scripts/migrate-data.js
   ```
   - Creates test user: `lekshmi.kola@gmail.com` / `SecureTestPassword123!`

### Start Dev Servers

**Terminal 1 — Vite frontend** (port 5173):
```bash
npm run dev
```

**Terminal 2 — Vercel Functions** (port 3001):
```bash
vercel dev
```

Vite proxy at `server.proxy['/api']` routes all `/api/*` requests to `http://localhost:3001`.

### Test Flow

#### 1. Signup
1. Navigate to `http://localhost:5173/auth`
2. Click "Sign up" toggle
3. Enter:
   - Email: `test@example.com`
   - Password: `TestPassword123!` (min 8 chars)
4. Click "Sign Up"
5. **Expected**: 
   - No error displayed
   - Redirect to `/` (authenticated)
   - Page shows "Firefly" header with email + "Log Out" button

**Browser DevTools check**:
- Application → Cookies → `localhost:5173`
- Should see cookie named `auth` (HTTP-only, Secure, SameSite=Strict)

#### 2. Page Reload (Session Restoration)
1. Press `F5` to reload page
2. **Expected**:
   - Brief "Loading..." spinner (AuthContext calls GET `/api/auth/me` on mount)
   - Page loads to `/` authenticated (session restored from cookie)
   - Email still visible in header

**Network tab check**:
- GET request to `/api/auth/me` sent automatically
- Cookie `auth` included in request (credentials: 'include')
- Response: `{ userId, email }`

#### 3. Logout
1. Click "Log Out" button
2. **Expected**:
   - Redirect to `/auth`
   - Login form displayed (no signup toggle visible)

**Browser DevTools check**:
- Cookie `auth` cleared (Max-Age=0)

#### 4. Login with New User
1. Enter credentials from step 1:
   - Email: `test@example.com`
   - Password: `TestPassword123!`
2. Click "Log In"
3. **Expected**: 
   - Redirect to `/`
   - Email visible in header

#### 5. Login with Test User (if seeded)
1. Logout
2. Login with:
   - Email: `lekshmi.kola@gmail.com`
   - Password: `SecureTestPassword123!`
3. **Expected**: 
   - Authenticate successfully
   - Access portfolio pages (Holdings, Performance, etc.)

#### 6. Error Cases
**Invalid password**:
- Login with correct email, wrong password
- **Expected**: "Invalid email or password" error message

**Nonexistent email**:
- Login with random email
- **Expected**: "Invalid email or password" error message

**Duplicate signup**:
- Try to sign up with same email twice
- **Expected**: "Email already in use" error message

**Password too short**:
- Signup with password < 8 chars
- **Expected**: "Password must be at least 8 characters" error message

---

## Architecture Verified

### Auth Flow
```
Frontend (React Context)
  ↓ (credentials: 'include')
Vite Proxy (/api → localhost:3001)
  ↓
Vercel Functions (api/auth/*)
  ↓
PostgreSQL (users table)
```

### Components Created
- **AuthContext.tsx**: Manages auth state, handles signup/login/logout, session restoration
- **SignupForm.tsx**: Email + password form with validation
- **LoginForm.tsx**: Email + password form
- **LogoutButton.tsx**: One-click logout
- **App.tsx**: Protected routes, auth guard, conditional rendering

### Endpoints
- `POST /api/auth/signup`: Create account, set JWT cookie
- `POST /api/auth/login`: Authenticate, set JWT cookie
- `GET /api/auth/me`: Verify JWT from cookie, restore session
- `POST /api/auth/logout`: Clear JWT cookie

### Key Features
- ✅ HTTP-only cookies (XSS-safe, auto-transport)
- ✅ Password hashing (crypto.scrypt, random salt)
- ✅ JWT tokens (HS256, 7-day expiry)
- ✅ Session restoration on page reload
- ✅ Protected routes redirect to `/auth`
- ✅ Generic error messages (no user enumeration)

---

## Troubleshooting

**"Cannot POST /api/auth/signup"**
- Ensure `vercel dev` is running on port 3001
- Check vite.config.ts proxy configuration

**Cookies not setting**
- Verify Set-Cookie header in Response
- Chrome DevTools → Application → Cookies

**Session not restoring on reload**
- Check GET `/api/auth/me` request in Network tab
- Verify cookie is included in request (`credentials: 'include'`)
- Check response has `{ userId, email }` body

**Database errors**
- Ensure PostgreSQL service is running: `brew services list`
- Verify database exists: `psql -l | grep firefly`
- Check schema initialized: `psql firefly -c "\dt"`

---

## Next Steps (Phase 6+)

After confirming auth flow works:
1. Migrate portfolio API endpoints to use user_id from JWT
2. Add role-based access control (admin, user)
3. Implement password reset flow
4. Add two-factor authentication
5. Deploy to Vercel (Edge Config, Vercel Postgres)
