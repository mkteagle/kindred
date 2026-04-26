# Kindred Photos -- Authentication & Authorization Audit

**Date:** 2026-04-26
**Scope:** Web app (Next.js), iOS app (SwiftUI), Backend (FastAPI)

---

## Architecture Overview

The system has three auth methods:

1. **Session-based auth (primary)** -- Username/password login creates a backend session token stored in the `sessions` table with a 30-day expiry. The web app encrypts session data into a `kindred_session` httpOnly cookie. The iOS app stores the raw session token in Keychain.
2. **Flickr OAuth 1.0a (admin)** -- Used for first-time admin setup and admin re-login. The web app orchestrates the OAuth dance via `/api/auth/flickr` (request token) and `/api/auth/callback` (access token exchange), then creates a backend session.
3. **API key auth (iOS/external)** -- Keys prefixed with `knd_` are hashed with bcrypt and stored in `api_keys` table. Also supports a legacy plaintext `API_KEY` env var.

### Auth flow diagram (web)

```
Browser -> Next.js middleware (cookie check) -> Next.js API routes -> FastAPI backend
                                                     |
                                          (encrypts session data
                                           into httpOnly cookie)
```

### Auth flow diagram (iOS)

```
iOS app -> Flickr OAuth (Safari) -> kindred:// callback -> POST /auth/flickr-login -> session token -> Keychain
iOS app -> username/password -> POST /auth/login -> session token -> Keychain
```

---

## Findings by Question

### 1. What happens if a user hasn't set up a service (no Flickr connected, no household)?

**Web app:**
- The home page (`/app/(main)/page.tsx`) loads for all visitors (authenticated or not). It checks `/api/auth/me` and conditionally renders a landing/marketing page when `user` is null.
- The topbar shows "Connect library" link (pointing to `/api/auth/flickr`) when no user is logged in.
- If no admin user exists yet, the Flickr OAuth callback calls `/auth/setup` which creates the first admin. If that fails (admin exists), it falls back to `/auth/flickr-login`.
- **Issue:** The topbar queries `BACKEND/syncs`, `BACKEND/stats`, `BACKEND/jobs/active`, and `BACKEND/notifications` regardless of auth state. These will fail with 401 for unauthenticated users. The errors are silently swallowed by react-query, but they generate unnecessary network traffic and backend errors.

**iOS app:**
- `RootView` gates on `SessionManager.shared.isAuthenticated`. If false, it shows `LoginView`.
- The Flickr login flow first calls `/app-config` to load consumer credentials. If no backend is reachable, `OAuthHelper.consumerKey` stays empty and `FlickrAuth.authenticate()` throws `requestTokenFailed`.
- **Issue:** The error shown is the generic "Flickr login failed: Request token request failed." -- this is misleading when the actual problem is that the backend is unreachable or not configured.

### 2. What error messages do users see?

**Web login page:**
- Wrong username/password: Backend returns 401 with `"Invalid username or password"`. Web displays this via the `data.detail` field. **Good:** does not reveal whether username or password is wrong.
- Flickr access denied: Redirects to `/login?error=denied`, displays "Access denied. Your Flickr account is not authorized."
- Connection error (backend down): Catches any exception and shows "Connection error".
- **Issue:** If the backend returns an unexpected error structure, the fallback is "Login failed" which is acceptable.

**Web join page:**
- Invalid invite code: Backend returns 400 with `"Invalid or expired invite code"`. Web displays via `data.detail`.
- Username taken: Backend returns 409 with `"Username already taken"`.
- Connection error: Shows "Connection error".

**iOS login:**
- Wrong credentials: Always shows "Invalid username or password" (hardcoded in `LoginView.login()`).
- **Issue:** The iOS app catches the error but does not use the backend's `detail` message. It always shows "Invalid username or password" even if the error is something else (e.g., 500 server error, network timeout). The `catch` block catches all errors uniformly.
- Flickr login: Shows "Flickr login failed: \(error.localizedDescription)" which correctly propagates `APIClient.APIError` messages.

**iOS join:**
- Always shows "Registration failed. Check your invite code and try again." regardless of the actual error (could be username taken, password too short, etc.).
- **Issue (Medium):** The iOS JoinView should show the backend's actual error message instead of a generic one.

### 3. What happens with expired sessions?

**Backend:**
- `validate_session()` checks `s.expires_at > now()` -- expired sessions are correctly rejected.
- On startup, `DELETE FROM sessions WHERE expires_at < now()` cleans up expired rows.
- Returns 401 `"Invalid or expired session"` for expired tokens.

**Web app:**
- The Next.js middleware only checks cookie *existence*, not validity. A user with an expired session cookie will pass middleware but fail on backend API calls.
- **Issue (Medium):** The web proxy (`/api/backend/[...path]`) passes through 401 responses from the backend, but the client code has no global interceptor to redirect to `/login` on 401. The topbar's initial `/api/auth/me` check will return `loggedIn: false`, so the UI will degrade to "not logged in" state, but the user stays on the current page rather than being redirected.
- **Issue (Low):** The `kindred_session` cookie has `maxAge: 2592000` (30 days) matching the backend session TTL, but these clocks are independent. The cookie could outlive the backend session if the backend session is manually revoked.

**iOS app:**
- `SessionManager` loads the stored token from Keychain on init and sets `isAuthenticated = true` without validating against the backend.
- **Issue (Medium):** If the backend session has expired but the Keychain token still exists, the iOS app will show `ContentView` (authenticated state) and all API calls will fail with 401. There is no mechanism to detect this and redirect to login.
- **Recommendation:** Add a session validation call on app launch (e.g., call `/auth/me` and logout if it fails).

### 4. What happens if the backend is down?

**Web app:**
- Next.js API routes catch fetch errors and return: `{ error: "Backend unreachable: <message>" }` with status 502. This is correct.
- The login page catches errors and shows "Connection error."
- The topbar fails silently (react-query swallows errors).
- **Issue (Low):** No user-facing "backend is down" banner or toast. The app appears to work but shows empty data.

**iOS app:**
- `APIClient` uses `URLSession` with a 30-second timeout.
- All API calls throw on failure, but error handling varies by view.
- `LoginView.login()` catches errors but shows "Invalid username or password" even for network errors.
- **Issue (Medium):** iOS does not distinguish between network errors and auth errors. A user with no connectivity sees "Invalid username or password" instead of a connection error message.

### 5. Is there proper error handling for all auth states?

**Partially.** Key gaps:

| Scenario | Web | iOS |
|---|---|---|
| Valid session | OK | OK |
| Expired session | No redirect, silent degradation | Shows auth'd UI, all calls fail |
| Invalid credentials | OK | OK (but generic message) |
| Backend down | "Connection error" on login, silent elsewhere | "Invalid username or password" (wrong message) |
| No Flickr configured | Admin tab shows Flickr button that will fail | "Request token request failed" (unclear) |
| Revoked session | No redirect, `/api/auth/me` returns loggedIn:false | Shows auth'd UI until app restart |

### 6. Security Issues

#### CRITICAL: Flickr Consumer Secret Exposed via Public Endpoint

**File:** `backend/main.py`, line 558-561
```python
"flickr": {
    "consumer_key": FLICKR_API_KEY,
    "consumer_secret": FLICKR_SECRET,
} if FLICKR_API_KEY else None,
```

The `/app-config` endpoint is in `AUTH_SKIP_PATHS` (no authentication required) and returns the Flickr consumer secret in plaintext. Anyone can call `GET /app-config` and obtain the Flickr OAuth consumer secret. While Flickr consumer secrets are not as sensitive as user access tokens (they cannot access user data alone), they are considered confidential by Flickr's API terms and could be used to impersonate the application in phishing attacks.

**Recommendation:** Remove `consumer_secret` from the public endpoint. The iOS app needs it for OAuth signing, but this should be delivered through an authenticated endpoint or embedded in the app binary at build time.

#### HIGH: CORS Allows All Origins

**File:** `backend/main.py`, line 36
```python
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```

The backend allows requests from any origin. Combined with session token auth via custom headers, this means any website could make authenticated requests to the Kindred backend if a user visits it while logged in (the session token is in a custom header, not a cookie, so it requires the attacker to know/steal the token, but `allow_origins=["*"]` removes the browser's CORS protection).

**Recommendation:** Restrict `allow_origins` to the actual frontend domains (e.g., `["https://kindredphotos.app", "https://demo.kindredphotos.app"]`).

#### HIGH: No Rate Limiting on Auth Endpoints

There is no rate limiting on `/auth/login`, `/auth/register`, or `/auth/flickr-login`. An attacker could brute-force passwords or enumerate valid invite codes.

**Recommendation:** Add rate limiting (e.g., slowapi or a simple in-memory counter per IP).

#### MEDIUM: No CSRF Protection

The web app uses httpOnly cookies for session storage, but there is no CSRF token mechanism. The `sameSite: "lax"` cookie attribute provides partial protection (POST requests from other sites won't include cookies), but GET-based state changes could be vulnerable. The logout endpoint accepts both GET and POST, meaning a `<img src="/api/auth/logout">` on a malicious page could log out a user.

**Recommendation:** Make the logout endpoint POST-only (it already is on the backend, but the Next.js route handler accepts GET). Add CSRF tokens for any state-changing operations.

#### MEDIUM: Cookie Encryption with Empty Secret

**File:** `apps/web/lib/oauth.ts`, line 18
```typescript
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
```

If `COOKIE_SECRET` is not set, the cookie encryption uses an empty string as the key derivation input. While `scryptSync` with an empty password still produces a deterministic key, this means all deployments without a configured secret share the same encryption key, making cookie contents predictable.

**Recommendation:** Fail loudly if `COOKIE_SECRET` is not set (throw at startup rather than defaulting to empty string).

#### MEDIUM: Scan Secret in Query Parameter

**File:** `backend/main.py`, line 2608
```python
async def auto_scan(background_tasks: BackgroundTasks, secret: str = ""):
```

The `/scan/auto` endpoint receives its secret as a query parameter (`?secret=...`). Query parameters appear in server logs, browser history, and proxy logs.

**Recommendation:** Accept the scan secret via a request header instead.

#### MEDIUM: Legacy Plaintext API Key Comparison

**File:** `backend/main.py`, line 73-74
```python
if API_KEY and key == API_KEY:
    request.state.user = {"user_id": None, "role": "admin", ...}
```

The legacy API key comparison uses `==` (not constant-time comparison), making it potentially vulnerable to timing attacks. Also, this grants admin access with `user_id: None`, which could cause issues in endpoints that expect a valid user ID.

**Recommendation:** Use `secrets.compare_digest()` for the comparison. Set a deprecation timeline for the legacy key.

#### LOW: Session Token Logged in Debug Output

The iOS `FlickrAuth.swift` prints OAuth tokens in debug logs:
```swift
print("[FlickrAuth] Got request token: \(requestTokenResponse)")
```

**Recommendation:** Remove or gate these behind a debug flag.

#### LOW: API Key in QR Code

The mobile setup QR code (`topbar.tsx`) can contain the API key in plaintext. If someone screenshots or photographs the QR code, the key is compromised.

**Recommendation:** Consider generating a time-limited setup token instead of embedding the actual API key.

#### LOW: /api/auth/token Exposes Flickr OAuth Tokens

The `/api/auth/token` route returns the Flickr OAuth token and secret to any request with a valid `flickr_token` cookie. This is used for authenticated Flickr API calls from the browser but could be targeted if XSS is found.

### 7. Invite Code Flow -- Invalid Code

**Backend:** Returns HTTP 400 with `"Invalid or expired invite code"` -- checks both `used_by IS NULL` and `expires_at > now()`.

**Web join page:** Displays the backend error message directly. Works correctly.

**iOS JoinView:** Always shows "Registration failed. Check your invite code and try again." regardless of actual error.

**Issues:**
- Invite codes are 8 characters from a 31-character alphabet (no I/O/0/1), giving ~31^8 = ~852 billion combinations. This is reasonably strong against brute force, but without rate limiting, automated guessing is possible.
- Invite codes expire after 7 days and are single-use. This is good.
- There is no validation on the web join page that the code field isn't empty (HTML `required` attribute is present though).
- The invite code is forced to uppercase on web (`e.target.value.toUpperCase()`) and on iOS (`textInputAutocapitalization(.characters)`), matching the backend's `.upper()` normalization. This is consistent.

### 8. Flickr OAuth -- User Denies Access

**Web app:**
- If the user denies access on Flickr's authorization page, Flickr redirects back to the callback URL without an `oauth_verifier` parameter.
- The callback handler (`/api/auth/callback`) checks for `oauth_token` and `oauth_verifier` and returns 400 `"Missing oauth_token or oauth_verifier"`.
- **Issue (Medium):** This returns a JSON error response in the browser rather than redirecting to `/login` with an error message. The user sees raw JSON: `{"error":"Missing oauth_token or oauth_verifier"}`.

**iOS app:**
- If the user denies access, Flickr does not redirect to the `kindred://` callback URL. The `ASWebAuthenticationSession` (actually Safari via `UIApplication.shared.open`) stays open.
- The `authContinuation` is never resumed.
- **Issue (High):** If the user closes Safari and returns to the app, the continuation is never resolved. The app is stuck in a state where `isFlickrLoggingIn` is true (spinner showing) indefinitely. The `FlickrAuth.authorizeInBrowser` uses `withCheckedThrowingContinuation` which will leak if never resumed.
- **Recommendation:** Add a timeout or use `ASWebAuthenticationSession` (which has built-in cancellation detection) instead of opening Safari directly.

---

## Summary of Priorities

### Critical
1. **Flickr consumer secret exposed on unauthenticated `/app-config` endpoint** -- Remove `consumer_secret` from public response.

### High
2. **CORS `allow_origins=["*"]`** -- Restrict to known frontend domains.
3. **No rate limiting on auth endpoints** -- Add rate limiting to prevent brute force.
4. **iOS Flickr OAuth denial causes stuck UI/leaked continuation** -- Use ASWebAuthenticationSession properly or add timeout.

### Medium
5. **iOS app does not validate session on launch** -- Stale Keychain tokens show authenticated UI but all API calls fail.
6. **Web app: no global 401 handler** -- Expired sessions cause silent degradation instead of redirect to login.
7. **Cookie encryption with empty secret fallback** -- Fail at startup if `COOKIE_SECRET` is not set.
8. **No CSRF protection** -- Logout accepts GET; add CSRF tokens for state changes.
9. **Scan secret passed as query parameter** -- Use a header instead.
10. **Legacy API key uses non-constant-time comparison** -- Use `secrets.compare_digest()`.
11. **Web Flickr OAuth denial shows raw JSON** -- Redirect to `/login?error=cancelled`.
12. **iOS shows wrong error for network failures on login** -- Distinguish network vs auth errors.
13. **iOS JoinView shows generic error** -- Forward the backend's actual error message.

### Low
14. **Debug prints of OAuth tokens in iOS** -- Remove or conditionalize.
15. **API key exposed in QR code** -- Consider time-limited setup tokens.
16. **No "backend down" user-facing indicator** -- Add a connection status banner.
17. **Topbar fires authenticated requests when not logged in** -- Gate API calls behind user check.
