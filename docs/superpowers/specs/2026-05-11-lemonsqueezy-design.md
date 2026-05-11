# LemonSqueezy Payments Integration — Design

## Goal

Add a Pro subscription tier (€7.99/month) via LemonSqueezy overlay checkout, with feature gating enforced on both backend and frontend.

## Architecture

LemonSqueezy acts as the merchant of record. The app stores subscription status in Supabase and reacts to webhook events to update it. No polling — all state changes are event-driven. The frontend reads plan status from `/api/config` on load and gates UI accordingly.

## Tech Stack

- LemonSqueezy (payments, subscriptions, webhooks)
- Supabase (store plan + daily usage)
- Express (webhook endpoint, plan guard middleware)
- Vanilla JS frontend (overlay checkout, paywall modals)

---

## Tiers

| Feature | Free | Pro (€7.99/mo) |
|---|---|---|
| Messages | 10/day | Unlimited |
| File/image uploads | 1/day | Unlimited |
| Flashcards, quiz, glossary, summary | ❌ | ✅ |
| Group chat | ❌ | ✅ |

---

## Data Model

### Supabase: `profiles` table (extend existing)

Add two columns:

```sql
ALTER TABLE profiles ADD COLUMN plan text NOT NULL DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN ls_subscription_id text;
```

### Supabase: `usage_daily` table (new)

```sql
CREATE TABLE usage_daily (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  messages_count int NOT NULL DEFAULT 0,
  uploads_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own usage" ON usage_daily FOR SELECT USING (auth.uid() = user_id);
```

---

## Backend

### New file: `src/plan-guard.js`

Exports two functions:

**`requirePro(req, res, next)`** — middleware for study tools and group chat endpoints. Fetches user's `plan` from `profiles`. If `'free'` → `res.status(403).json({ error: 'pro_required' })`. If `'pro'` → `next()`.

**`checkAndIncrementUsage(userId, type)`** — called inside `/api/chat` and `/api/files` handlers. `type` is `'messages'` or `'uploads'`. Upserts today's row in `usage_daily`, increments the relevant counter. Returns `{ allowed: boolean, count: number, limit: number }`. Limits: messages = 10, uploads = 1.

### New file: `src/subscription-handler.js`

Handles `POST /api/webhooks/lemonsqueezy` (no `requireAuth` middleware).

**Signature verification:** HMAC-SHA256 of raw request body using `LEMONSQUEEZY_WEBHOOK_SECRET`, compared to `X-Signature` header. If mismatch → 401.

**Event handling:**

| Event | Action |
|---|---|
| `subscription_created` | Set `plan = 'pro'`, save `ls_subscription_id` on matching user (by email from payload) |
| `subscription_resumed` | Set `plan = 'pro'` |
| `subscription_cancelled` | No change — LemonSqueezy fires `subscription_expired` when period ends |
| `subscription_expired` | Set `plan = 'free'`, clear `ls_subscription_id` |

Always responds `200` to LemonSqueezy even on handled events to prevent retries.

### Extend `/api/config`

Add to the existing config response:
```json
{
  "plan": "free",
  "messages_today": 3,
  "uploads_today": 0,
  "ls_buy_url": "https://studybuddyrs.lemonsqueezy.com/checkout/buy/a2499643-a382-46e1-b10b-2ef2fe05858b"
}
```

`plan`, `messages_today`, `uploads_today` come from Supabase using the user's JWT. `ls_buy_url` comes from `LEMONSQUEEZY_BUY_URL` env var.

### Route changes in `server.js`

The webhook route must be registered **before** `app.use(express.json())` so the raw body is available for signature verification. `express.json()` parses and discards the raw body — if it runs first, HMAC verification will fail.

```js
// BEFORE app.use(express.json()) — needs raw body for signature verification
app.post('/api/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }), subscription.handleWebhook)

app.use(express.json({ limit: '30mb' }))

// Study tools — add requirePro
app.post('/api/flashcards', requireAuth, requirePro, ...)
app.post('/api/quiz',       requireAuth, requirePro, ...)
app.post('/api/glossary',   requireAuth, requirePro, ...)
app.post('/api/summary',    requireAuth, requirePro, ...)
app.post('/api/followup',   requireAuth, requirePro, ...)

// Groups — add requirePro
app.post('/api/groups',            requireAuth, requirePro, ...)
app.get('/api/groups',             requireAuth, requirePro, ...)
// ... all /api/groups/* routes
```

---

## Frontend

### LemonSqueezy overlay

Add to `public/index.html` before `</body>`:
```html
<script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
```

Any element with `class="lemonsqueezy-button"` and `href="<buy_url>?checkout[email]=<user_email>"` opens the overlay checkout automatically.

### Usage state

On app load, `/api/config` returns plan + today's usage. Store in a global `appState`:
```js
let appState = { plan: 'free', messagesToday: 0, uploadsToday: 0, lsBuyUrl: '' }
```

### Upgrade button

In the sidebar, below the user email:
```html
<a id="upgrade-btn" class="lemonsqueezy-button ...">⚡ Upgrade to Pro</a>
```
Hidden for Pro users. Href dynamically set to `lsBuyUrl + '?checkout[email]=' + userEmail`.

### Usage counter (free users only)

Below the message input:
```
7 / 10 messages today  ·  0 / 1 uploads today
```
Hidden for Pro users.

### Pro badge

Next to user name/email in sidebar: small `PRO` badge, shown only when `plan === 'pro'`.

### Paywall modal

Triggered when:
- Free user clicks a study tool button (flashcards, quiz, glossary, summary)
- Free user tries to open group chat
- API returns `403` with `error: 'pro_required'`
- API returns `403` with `error: 'limit_reached'`

Modal content:
- Title: "Ovo je Pro funkcija" / "This is a Pro feature"
- Short description of what they're missing
- Upgrade button (LemonSqueezy overlay)
- Close button

### i18n keys to add (both sr and en)

```
upgradePro, proFeature, paywallMsg, messagesLimit, uploadsLimit,
proBadge, usageCounter, upgradeBtn
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Signing secret from LemonSqueezy webhook settings |
| `LEMONSQUEEZY_BUY_URL` | Checkout URL for Pro Monthly variant |

Both already added to Vercel production.

---

## Testing

1. Run `npm test` — all existing 67 tests must still pass
2. Write new tests in `tests/subscription-handler.test.js`:
   - Valid webhook signature → processes event
   - Invalid signature → 401
   - `subscription_created` → user plan set to pro
   - `subscription_expired` → user plan set to free
3. Write new tests in `tests/plan-guard.test.js`:
   - Pro user → passes through
   - Free user → 403
   - Free user under limit → allowed + count incremented
   - Free user at limit → 403
4. Manual: use LemonSqueezy test mode to make a purchase, verify plan updates in Supabase
