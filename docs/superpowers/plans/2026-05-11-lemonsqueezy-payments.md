# LemonSqueezy Payments Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pro subscription (€7.99/month) via LemonSqueezy overlay checkout with full feature gating on backend and frontend.

**Architecture:** LemonSqueezy fires webhooks on subscription events; backend verifies signatures and updates Supabase. On boot the frontend fetches `/api/subscription` to get plan + daily usage, then gates UI accordingly. Free users hitting limits or Pro features see a paywall modal with an upgrade button that opens LemonSqueezy's overlay checkout.

**Tech Stack:** LemonSqueezy JS overlay, Express middleware, Supabase (pgvector `profiles` + new `usage_daily`), vanilla JS frontend.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/plan-guard.js` | Create | `requirePro` middleware + `limitFree(type)` middleware factory + usage helpers |
| `src/subscription-handler.js` | Create | Webhook signature verification + Supabase plan updates |
| `server.js` | Modify | Register webhook before JSON middleware, add `/api/subscription`, add guards to routes |
| `public/js/i18n.js` | Modify | Add 9 new keys to `sr` and `en` |
| `public/index.html` | Modify | LemonSqueezy script, upgrade button, Pro badge, usage counter, paywall modal |
| `public/js/chat.js` | Modify | Fetch subscription on boot, update UI, intercept gated features, handle 403s |
| `tests/plan-guard.test.js` | Create | Tests for requirePro and limitFree |
| `tests/subscription-handler.test.js` | Create | Tests for webhook verification and event handling |

---

## Task 1: Database Migration

**Files:**
- Run SQL in Supabase SQL editor (Dashboard → SQL Editor → New query)

- [ ] **Step 1: Run the migration SQL**

Copy and run this in Supabase SQL Editor:

```sql
-- profiles table (may already exist — CREATE IF NOT EXISTS is safe)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  ls_subscription_id text
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users see own profile'
  ) THEN
    CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;

-- Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Backfill profiles for existing users
INSERT INTO profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Daily usage tracking table
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  messages_count int NOT NULL DEFAULT 0,
  uploads_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'usage_daily' AND policyname = 'Users see own usage'
  ) THEN
    CREATE POLICY "Users see own usage" ON usage_daily FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- Atomic increment function (avoids race conditions)
CREATE OR REPLACE FUNCTION increment_and_check_usage(
  p_user_id uuid,
  p_type text,
  p_limit int
) RETURNS jsonb AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO usage_daily (user_id, date, messages_count, uploads_count)
  VALUES (p_user_id, CURRENT_DATE, 0, 0)
  ON CONFLICT (user_id, date) DO NOTHING;

  IF p_type = 'messages' THEN
    UPDATE usage_daily
    SET messages_count = messages_count + 1
    WHERE user_id = p_user_id
      AND date = CURRENT_DATE
      AND messages_count < p_limit
    RETURNING messages_count INTO v_count;
  ELSE
    UPDATE usage_daily
    SET uploads_count = uploads_count + 1
    WHERE user_id = p_user_id
      AND date = CURRENT_DATE
      AND uploads_count < p_limit
    RETURNING uploads_count INTO v_count;
  END IF;

  RETURN jsonb_build_object('allowed', v_count IS NOT NULL, 'count', COALESCE(v_count, p_limit));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Verify in Supabase Table Editor**

In Supabase Dashboard → Table Editor, confirm:
- `profiles` table exists with columns `id`, `plan`, `ls_subscription_id`
- `usage_daily` table exists with columns `user_id`, `date`, `messages_count`, `uploads_count`
- Existing users have rows in `profiles` with `plan = 'free'`

- [ ] **Step 3: Add Vercel env vars if not already done**

```bash
echo "YOUR_WEBHOOK_SECRET" | npx vercel env add LEMONSQUEEZY_WEBHOOK_SECRET production
echo "https://studybuddyrs.lemonsqueezy.com/checkout/buy/a2499643-a382-46e1-b10b-2ef2fe05858b" | npx vercel env add LEMONSQUEEZY_BUY_URL production
```

---

## Task 2: Plan Guard (`src/plan-guard.js`)

**Files:**
- Create: `src/plan-guard.js`
- Create: `tests/plan-guard.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/plan-guard.test.js`:

```js
const { makePlanGuard } = require('../src/plan-guard')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function makeProDb() {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { plan: 'pro' }, error: null })
    }),
    rpc: jest.fn()
  }
}

function makeFreeDb(rpcResult = { allowed: true, count: 1 }) {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { plan: 'free' }, error: null })
    }),
    rpc: jest.fn().mockResolvedValue({ data: rpcResult, error: null })
  }
}

test('requirePro allows pro users', async () => {
  const { requirePro } = makePlanGuard(makeProDb())
  const req = { user: { id: 'user-123' } }
  const res = mockRes()
  const next = jest.fn()
  await requirePro(req, res, next)
  expect(next).toHaveBeenCalled()
  expect(res.status).not.toHaveBeenCalled()
})

test('requirePro blocks free users with 403', async () => {
  const { requirePro } = makePlanGuard(makeFreeDb())
  const req = { user: { id: 'user-123' } }
  const res = mockRes()
  const next = jest.fn()
  await requirePro(req, res, next)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(res.json).toHaveBeenCalledWith({ error: 'pro_required' })
  expect(next).not.toHaveBeenCalled()
})

test('limitFree allows pro users without checking usage', async () => {
  const db = makeProDb()
  const { limitFree } = makePlanGuard(db)
  const req = { user: { id: 'user-123' } }
  const res = mockRes()
  const next = jest.fn()
  await limitFree('messages')(req, res, next)
  expect(db.rpc).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalled()
})

test('limitFree allows free user under limit', async () => {
  const { limitFree } = makePlanGuard(makeFreeDb({ allowed: true, count: 3 }))
  const req = { user: { id: 'user-123' } }
  const res = mockRes()
  const next = jest.fn()
  await limitFree('messages')(req, res, next)
  expect(next).toHaveBeenCalled()
})

test('limitFree blocks free user at limit with 403', async () => {
  const { limitFree } = makePlanGuard(makeFreeDb({ allowed: false, count: 10 }))
  const req = { user: { id: 'user-123' } }
  const res = mockRes()
  const next = jest.fn()
  await limitFree('messages')(req, res, next)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(res.json).toHaveBeenCalledWith({ error: 'limit_reached' })
  expect(next).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/plan-guard.test.js --no-coverage 2>&1 | tail -5
```
Expected: `Cannot find module '../src/plan-guard'`

- [ ] **Step 3: Create `src/plan-guard.js`**

```js
const { createClient } = require('@supabase/supabase-js')

const LIMITS = { messages: 10, uploads: 1 }

function makePlanGuard(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function getPlan(userId) {
    const { data } = await db
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single()
    return data?.plan || 'free'
  }

  async function getUsageToday(userId) {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await db
      .from('usage_daily')
      .select('messages_count, uploads_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single()
    return {
      messagesToday: data?.messages_count || 0,
      uploadsToday: data?.uploads_count || 0
    }
  }

  async function requirePro(req, res, next) {
    const plan = await getPlan(req.user.id)
    if (plan !== 'pro') return res.status(403).json({ error: 'pro_required' })
    next()
  }

  function limitFree(type) {
    return async (req, res, next) => {
      const plan = await getPlan(req.user.id)
      if (plan === 'pro') return next()
      const { data, error } = await db.rpc('increment_and_check_usage', {
        p_user_id: req.user.id,
        p_type: type,
        p_limit: LIMITS[type]
      })
      if (error || !data?.allowed) {
        return res.status(403).json({ error: 'limit_reached' })
      }
      next()
    }
  }

  return { requirePro, limitFree, getPlan, getUsageToday }
}

module.exports = { makePlanGuard }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/plan-guard.test.js --no-coverage 2>&1 | tail -5
```
Expected: `5 passed, 5 total`

- [ ] **Step 5: Commit**

```bash
git add src/plan-guard.js tests/plan-guard.test.js
git commit -m "feat: add plan guard middleware for Pro gating and daily limits"
```

---

## Task 3: Subscription Handler (`src/subscription-handler.js`)

**Files:**
- Create: `src/subscription-handler.js`
- Create: `tests/subscription-handler.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/subscription-handler.test.js`:

```js
const crypto = require('crypto')

process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'test-secret'

const { makeSubscriptionHandler } = require('../src/subscription-handler')

function sign(body, secret = 'test-secret') {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.sendStatus = jest.fn().mockReturnValue(res)
  return res
}

function makeDb(upsertResult = { error: null }) {
  const upsert = jest.fn().mockResolvedValue(upsertResult)
  const db = { from: jest.fn().mockReturnValue({ upsert }) }
  db._upsert = upsert
  return db
}

test('returns 401 when x-signature header is missing', async () => {
  const handler = makeSubscriptionHandler(makeDb())
  const req = { headers: {}, body: Buffer.from('{}') }
  const res = mockRes()
  await handler.handleWebhook(req, res)
  expect(res.status).toHaveBeenCalledWith(401)
})

test('returns 401 when signature is invalid', async () => {
  const handler = makeSubscriptionHandler(makeDb())
  const req = { headers: { 'x-signature': 'badsig' }, body: Buffer.from('{}') }
  const res = mockRes()
  await handler.handleWebhook(req, res)
  expect(res.status).toHaveBeenCalledWith(401)
})

test('sets plan to pro on subscription_created', async () => {
  const db = makeDb()
  const handler = makeSubscriptionHandler(db)
  const body = JSON.stringify({
    meta: { event_name: 'subscription_created', custom_data: { user_id: 'user-123' } },
    data: { id: 'sub-456' }
  })
  const req = { headers: { 'x-signature': sign(body) }, body: Buffer.from(body) }
  const res = mockRes()
  await handler.handleWebhook(req, res)
  expect(db._upsert).toHaveBeenCalledWith({ id: 'user-123', plan: 'pro', ls_subscription_id: 'sub-456' })
  expect(res.sendStatus).toHaveBeenCalledWith(200)
})

test('sets plan to pro on subscription_resumed', async () => {
  const db = makeDb()
  const handler = makeSubscriptionHandler(db)
  const body = JSON.stringify({
    meta: { event_name: 'subscription_resumed', custom_data: { user_id: 'user-123' } },
    data: { id: 'sub-456' }
  })
  const req = { headers: { 'x-signature': sign(body) }, body: Buffer.from(body) }
  const res = mockRes()
  await handler.handleWebhook(req, res)
  expect(db._upsert).toHaveBeenCalledWith({ id: 'user-123', plan: 'pro', ls_subscription_id: 'sub-456' })
})

test('sets plan to free on subscription_expired', async () => {
  const db = makeDb()
  const handler = makeSubscriptionHandler(db)
  const body = JSON.stringify({
    meta: { event_name: 'subscription_expired', custom_data: { user_id: 'user-123' } },
    data: { id: 'sub-456' }
  })
  const req = { headers: { 'x-signature': sign(body) }, body: Buffer.from(body) }
  const res = mockRes()
  await handler.handleWebhook(req, res)
  expect(db._upsert).toHaveBeenCalledWith({ id: 'user-123', plan: 'free', ls_subscription_id: null })
})

test('returns 200 without touching db when user_id is absent', async () => {
  const db = makeDb()
  const handler = makeSubscriptionHandler(db)
  const body = JSON.stringify({
    meta: { event_name: 'subscription_created', custom_data: {} },
    data: { id: 'sub-456' }
  })
  const req = { headers: { 'x-signature': sign(body) }, body: Buffer.from(body) }
  const res = mockRes()
  await handler.handleWebhook(req, res)
  expect(db._upsert).not.toHaveBeenCalled()
  expect(res.sendStatus).toHaveBeenCalledWith(200)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/subscription-handler.test.js --no-coverage 2>&1 | tail -5
```
Expected: `Cannot find module '../src/subscription-handler'`

- [ ] **Step 3: Create `src/subscription-handler.js`**

```js
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

function makeSubscriptionHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  function verifySignature(rawBody, signature) {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
    if (!secret || !signature) return false
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'))
    } catch {
      return false
    }
  }

  async function setUserPlan(userId, plan, subscriptionId) {
    await db.from('profiles').upsert({ id: userId, plan, ls_subscription_id: subscriptionId })
  }

  async function handleWebhook(req, res) {
    const signature = req.headers['x-signature']
    if (!signature) return res.status(401).json({ error: 'Missing signature' })

    const rawBody = req.body
    if (!verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' })
    }

    const payload = JSON.parse(rawBody.toString())
    const eventName = payload.meta?.event_name
    const userId = payload.meta?.custom_data?.user_id
    const subscriptionId = payload.data?.id

    if (!userId) return res.sendStatus(200)

    switch (eventName) {
      case 'subscription_created':
      case 'subscription_resumed':
        await setUserPlan(userId, 'pro', subscriptionId)
        break
      case 'subscription_expired':
        await setUserPlan(userId, 'free', null)
        break
      // subscription_cancelled: keep pro until subscription_expired fires
    }

    res.sendStatus(200)
  }

  return { handleWebhook }
}

module.exports = { makeSubscriptionHandler }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/subscription-handler.test.js --no-coverage 2>&1 | tail -5
```
Expected: `6 passed, 6 total`

- [ ] **Step 5: Commit**

```bash
git add src/subscription-handler.js tests/subscription-handler.test.js
git commit -m "feat: add LemonSqueezy webhook handler with signature verification"
```

---

## Task 4: Update `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add webhook route BEFORE express.json, add plan guard, update all routes**

Replace the entire `server.js` with this (compare carefully — the key change is the webhook route and plan-guard additions):

```js
require('dotenv').config()
const express = require('express')
const path = require('path')

const app = express()

// Webhook MUST come before express.json() — needs raw body for signature verification
const { makeSubscriptionHandler } = require('./src/subscription-handler')
const subscription = makeSubscriptionHandler()
app.post('/api/webhooks/lemonsqueezy',
  express.raw({ type: 'application/json' }),
  (req, res) => subscription.handleWebhook(req, res)
)

app.use(express.json({ limit: '30mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  })
})

const { makeAuthMiddleware } = require('./src/auth-middleware')
const { makeHistoryHandler } = require('./src/history-handler')
const { handleChat: handleClaude } = require('./src/chat-handler')
const { handleChat: handleOpenAI } = require('./src/openai-chat-handler')
const { handleChat: handleGemini } = require('./src/gemini-chat-handler')
const { makePlanGuard } = require('./src/plan-guard')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()
const { requirePro, limitFree, getPlan, getUsageToday } = makePlanGuard()

app.get('/api/history', requireAuth, (req, res) => history.listConversations(req, res))
app.post('/api/history', requireAuth, (req, res) => history.saveExchange(req, res))
app.get('/api/history/:id', requireAuth, (req, res) => history.getConversation(req, res))
app.delete('/api/history/:id', requireAuth, (req, res) => history.deleteConversation(req, res))
app.patch('/api/history/:id', requireAuth, (req, res) => history.updateConversationTitle(req, res))
app.put('/api/history/:id/messages', requireAuth, (req, res) => history.replaceMessages(req, res))

const { handleFollowup } = require('./src/followup-handler')
const { handleFlashcards } = require('./src/flashcard-handler')
const { handleQuiz } = require('./src/quiz-handler')
const { handleGlossary } = require('./src/glossary-handler')
const { handleSummary } = require('./src/summary-handler')
const { handleTitle } = require('./src/title-handler')

app.post('/api/followup',  requireAuth, requirePro, (req, res) => handleFollowup(req, res))
app.post('/api/flashcards', requireAuth, requirePro, (req, res) => handleFlashcards(req, res))
app.post('/api/quiz',      requireAuth, requirePro, (req, res) => handleQuiz(req, res))
app.post('/api/glossary',  requireAuth, requirePro, (req, res) => handleGlossary(req, res))
app.post('/api/summary',   requireAuth, requirePro, (req, res) => handleSummary(req, res))
app.post('/api/title',     requireAuth, (req, res) => handleTitle(req, res))

app.post('/api/chat', requireAuth, limitFree('messages'), (req, res) => {
  const provider = req.body?.provider || 'claude'
  if (provider === 'openai') return handleOpenAI(req, res)
  if (provider === 'gemini') return handleGemini(req, res)
  return handleClaude(req, res)
})

app.get('/api/subscription', requireAuth, async (req, res) => {
  const plan = await getPlan(req.user.id)
  const usage = await getUsageToday(req.user.id)
  res.json({
    plan,
    messagesToday: usage.messagesToday,
    uploadsToday: usage.uploadsToday,
    lsBuyUrl: process.env.LEMONSQUEEZY_BUY_URL || ''
  })
})

const { makeShareHandler } = require('./src/share-handler')
const { makeGroupsHandler } = require('./src/groups-handler')
const share = makeShareHandler()
const groups = makeGroupsHandler()

app.post('/api/conversations/:id/share', requireAuth, (req, res) => share.shareConversation(req, res))
app.delete('/api/conversations/:id/share', requireAuth, (req, res) => share.unshareConversation(req, res))
app.get('/api/share/:token', requireAuth, (req, res) => share.getShared(req, res))
app.post('/api/share/:token/fork', requireAuth, (req, res) => share.forkConversation(req, res))

app.post('/api/groups',            requireAuth, requirePro, (req, res) => groups.createGroup(req, res))
app.get('/api/groups',             requireAuth, requirePro, (req, res) => groups.listGroups(req, res))
app.get('/api/groups/:id',         requireAuth, requirePro, (req, res) => groups.getGroup(req, res))
app.post('/api/groups/:id/invite', requireAuth, requirePro, (req, res) => groups.inviteMember(req, res))
app.get('/api/groups/:id/messages',requireAuth, requirePro, (req, res) => groups.getMessages(req, res))
app.post('/api/groups/:id/messages',requireAuth, requirePro, (req, res) => groups.sendMessage(req, res))
app.delete('/api/groups/:id/leave',requireAuth, requirePro, (req, res) => groups.leaveGroup(req, res))
app.delete('/api/groups/:id',      requireAuth, requirePro, (req, res) => groups.deleteGroup(req, res))

const { makeNotesHandler } = require('./src/notes-handler')
const notesHandler = makeNotesHandler()
app.get('/api/notes', requireAuth, (req, res) => notesHandler.listNotes(req, res))
app.post('/api/notes', requireAuth, (req, res) => notesHandler.createNote(req, res))
app.patch('/api/notes/:id', requireAuth, (req, res) => notesHandler.updateNote(req, res))
app.delete('/api/notes/:id', requireAuth, (req, res) => notesHandler.deleteNote(req, res))

const { makeFilesHandler } = require('./src/files-handler')
const { makeConvFilesHandler } = require('./src/conversation-files-handler')
const filesHandler = makeFilesHandler()
const convFilesHandler = makeConvFilesHandler()

app.get('/api/files', requireAuth, (req, res) => filesHandler.listFiles(req, res))
app.post('/api/files', requireAuth, limitFree('uploads'), (req, res) => filesHandler.uploadFile(req, res))
app.delete('/api/files/:id', requireAuth, (req, res) => filesHandler.deleteFile(req, res))
app.get('/api/files/:id/url', requireAuth, (req, res) => filesHandler.getSignedUrl(req, res))
app.get('/api/conversations/:id/files', requireAuth, (req, res) => convFilesHandler.listConvFiles(req, res))
app.post('/api/conversations/:id/files', requireAuth, (req, res) => convFilesHandler.linkFile(req, res))

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

if (require.main === module) {
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`StudyBuddy running at http://localhost:${port}`))
}

module.exports = app
```

- [ ] **Step 2: Run all tests**

```bash
npm test 2>&1 | tail -10
```
Expected: `67 passed` (all existing tests still pass)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: wire plan guard and subscription endpoint into server routes"
```

---

## Task 5: i18n Keys

**Files:**
- Modify: `public/js/i18n.js`

- [ ] **Step 1: Add keys to `sr` block**

In `public/js/i18n.js`, find the closing `},` of the `sr` block (just before `en: {`) and insert before it:

```js
    upgradePro: 'Nadogradi na Pro',
    proBadge: 'PRO',
    paywallTitle: 'Pro funkcija',
    paywallMsg: 'Ova funkcija je dostupna samo Pro korisnicima.',
    paywallUpgrade: 'Nadogradi za €7.99/mes',
    messagesLimit: 'Dostigao/la si dnevni limit od 10 poruka.',
    uploadsLimit: 'Dostigao/la si dnevni limit od 1 fajla.',
    usageMessages: '{n}/10 poruka danas',
    usageUploads: '{n}/1 fajl danas',
```

- [ ] **Step 2: Add keys to `en` block**

Find the closing `}` of the `en` block (just before the final `}`) and insert before it:

```js
    upgradePro: 'Upgrade to Pro',
    proBadge: 'PRO',
    paywallTitle: 'Pro feature',
    paywallMsg: 'This feature is only available to Pro users.',
    paywallUpgrade: 'Upgrade for €7.99/mo',
    messagesLimit: "You've reached your daily limit of 10 messages.",
    uploadsLimit: 'You\'ve reached your daily upload limit.',
    usageMessages: '{n}/10 messages today',
    usageUploads: '{n}/1 upload today',
```

- [ ] **Step 3: Run i18n tests**

```bash
npx jest tests/i18n.test.js --no-coverage 2>&1 | tail -5
```
Expected: all passing

- [ ] **Step 4: Commit**

```bash
git add public/js/i18n.js
git commit -m "feat: add i18n keys for payments UI (upgrade, paywall, usage counter)"
```

---

## Task 6: Frontend HTML — Upgrade Button, Pro Badge, Usage Counter, Paywall Modal

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add LemonSqueezy JS script before `</body>`**

Find `</body>` at the bottom of `public/index.html` and add before it:

```html
  <script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
```

- [ ] **Step 2: Add Pro badge to sidebar brand area**

Find in `public/index.html`:
```html
      <span class="text-blue-300 text-[10px] font-semibold tracking-wide flex-1">BETA</span>
```
Replace with:
```html
      <span class="text-blue-300 text-[10px] font-semibold tracking-wide flex-1">BETA</span>
      <span id="pro-badge" class="hidden text-[10px] font-bold tracking-wide bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded-full">PRO</span>
```

- [ ] **Step 3: Add upgrade button in sidebar (before the disclaimer `<p>`)**

Find in `public/index.html`:
```html
    <!-- Disclaimer -->
    <p id="disclaimer"
```
Add before it:
```html
    <!-- Upgrade button (hidden for Pro users) -->
    <a id="upgrade-btn" href="#" class="lemonsqueezy-button hidden flex items-center justify-center gap-1.5 bg-yellow-400/20 hover:bg-yellow-400/30 border border-yellow-400/40 rounded-lg px-3 py-2 text-yellow-300 text-xs font-semibold transition">
      ⚡ <span data-i18n="upgradePro">Nadogradi na Pro</span>
    </a>
```

- [ ] **Step 4: Add usage counter below the message input**

Find in `public/index.html` the send button area. Look for the `</form>` or the closing tag of the input area and add after it:

```html
    <!-- Usage counter (hidden for Pro users) -->
    <div id="usage-counter" class="hidden text-center text-[11px] text-slate-400 dark:text-gray-500 pb-1">
      <span id="usage-msg-text"></span> · <span id="usage-upload-text"></span>
    </div>
```

- [ ] **Step 5: Add paywall modal before `</body>`**

Add before the LemonSqueezy script tag:

```html
  <!-- Paywall modal -->
  <div id="paywall-modal" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-slate-200 dark:border-gray-700 w-full max-w-sm p-6 text-center">
      <div class="text-4xl mb-3">⚡</div>
      <h2 id="paywall-title" class="text-base font-bold text-slate-800 dark:text-gray-100 mb-2"></h2>
      <p id="paywall-msg" class="text-sm text-slate-500 dark:text-gray-400 mb-5"></p>
      <a id="paywall-upgrade-btn" href="#" class="lemonsqueezy-button block w-full bg-yellow-400 hover:bg-yellow-300 text-yellow-900 font-semibold py-2.5 rounded-xl text-sm transition mb-3"></a>
      <button onclick="closePaywall()" class="text-xs text-slate-400 hover:text-slate-600 dark:text-gray-400 dark:hover:text-gray-200 transition">Zatvori / Close</button>
    </div>
  </div>
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add upgrade button, Pro badge, usage counter and paywall modal HTML"
```

---

## Task 7: Frontend JS — Subscription State, Gating, Paywall

**Files:**
- Modify: `public/js/chat.js`

- [ ] **Step 1: Add module-level subscription state variables**

At the top of `public/js/chat.js`, find the existing `let currentLang = ...` line and add after it:

```js
let appPlan = 'free'
let appMessagesToday = 0
let appUploadsToday = 0
let appLsBuyUrl = ''
let currentUserEmail = ''
```

- [ ] **Step 2: Add `loadSubscription` and `updateSubscriptionUI` functions**

Add these functions after the `updateProfileAvatar` function (around line 73):

```js
async function loadSubscription(token, email, userId) {
  try {
    const res = await fetch('/api/subscription', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data = await res.json()
    appPlan = data.plan || 'free'
    appMessagesToday = data.messagesToday || 0
    appUploadsToday = data.uploadsToday || 0
    appLsBuyUrl = data.lsBuyUrl || ''
    updateSubscriptionUI(email, userId)
  } catch {}
}

function updateSubscriptionUI(email, userId) {
  const isPro = appPlan === 'pro'

  const upgradeBtn = document.getElementById('upgrade-btn')
  if (upgradeBtn) {
    upgradeBtn.classList.toggle('hidden', isPro)
    if (appLsBuyUrl && email) {
      upgradeBtn.href = `${appLsBuyUrl}?checkout[email]=${encodeURIComponent(email)}&checkout[custom][user_id]=${userId}`
    }
  }

  const proBadge = document.getElementById('pro-badge')
  if (proBadge) proBadge.classList.toggle('hidden', !isPro)

  const usageCounter = document.getElementById('usage-counter')
  if (usageCounter) {
    usageCounter.classList.toggle('hidden', isPro)
    const t = I18N[currentLang]
    const msgEl = document.getElementById('usage-msg-text')
    const upEl = document.getElementById('usage-upload-text')
    if (msgEl) msgEl.textContent = t.usageMessages.replace('{n}', appMessagesToday)
    if (upEl) upEl.textContent = t.usageUploads.replace('{n}', appUploadsToday)
  }
}
```

- [ ] **Step 3: Call `loadSubscription` in the boot sequence**

Find the `DOMContentLoaded` handler. Find this block:

```js
  const email = session.user.email
  currentUserId = session.user.id
```

Add after it:

```js
  currentUserEmail = email
```

Then find `await loadConversations()` and add after it:

```js
  const token = await getAccessToken()
  await loadSubscription(token, email, session.user.id)
```

- [ ] **Step 4: Add `showPaywall` and `closePaywall` functions**

Add these functions after `updateSubscriptionUI`:

```js
function showPaywall(titleKey, msgKey) {
  const t = I18N[currentLang]
  const titleEl = document.getElementById('paywall-title')
  const msgEl = document.getElementById('paywall-msg')
  const btn = document.getElementById('paywall-upgrade-btn')
  if (titleEl) titleEl.textContent = t[titleKey] || t.paywallTitle
  if (msgEl) msgEl.textContent = t[msgKey] || t.paywallMsg
  if (btn) {
    btn.textContent = t.paywallUpgrade
    if (appLsBuyUrl && currentUserEmail) {
      btn.href = `${appLsBuyUrl}?checkout[email]=${encodeURIComponent(currentUserEmail)}&checkout[custom][user_id]=${currentUserId}`
    }
  }
  document.getElementById('paywall-modal').classList.remove('hidden')
}

function closePaywall() {
  document.getElementById('paywall-modal').classList.add('hidden')
}
```

- [ ] **Step 5: Gate study tool buttons in the frontend**

In `public/js/chat.js`, add a plan check as the **first line** of each gated function:

At line 1157 (start of `generateFlashcards` body, after the function declaration):
```js
  if (appPlan !== 'pro') { showPaywall('paywallTitle', 'paywallMsg'); return }
```

At line 1592 (start of `generateQuiz` body):
```js
  if (appPlan !== 'pro') { showPaywall('paywallTitle', 'paywallMsg'); return }
```

At line 1718 (start of `generateGlossary` body):
```js
  if (appPlan !== 'pro') { showPaywall('paywallTitle', 'paywallMsg'); return }
```

At line 1758 (start of `generateSummary` body):
```js
  if (appPlan !== 'pro') { showPaywall('paywallTitle', 'paywallMsg'); return }
```

At line 2178 (start of `openCreateGroupModal` body):
```js
  if (appPlan !== 'pro') { showPaywall('paywallTitle', 'paywallMsg'); return }
```

- [ ] **Step 6: Handle 403 responses from the chat API**

In `public/js/chat.js` at line 695, the existing check is:
```js
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return }
      bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError
      isSending = false; updateSendButton(false); return
    }
```

Replace it with:
```js
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return }
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}))
        bubble.remove()
        showPaywall('paywallTitle', data.error === 'limit_reached' ? 'messagesLimit' : 'paywallMsg')
        isSending = false; updateSendButton(false); return
      }
      bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError
      isSending = false; updateSendButton(false); return
    }
```

For file uploads, at line 541 the existing check is `if (res.ok) { ... }` with no else. Add after the closing `}` of the `if (res.ok)` block:
```js
        } else if (res.status === 403) {
          const data = await res.json().catch(() => ({}))
          attachedFiles.pop()
          renderAttachedFilesBar()
          showPaywall('paywallTitle', data.error === 'limit_reached' ? 'uploadsLimit' : 'paywallMsg')
        }
```

- [ ] **Step 7: Run all tests**

```bash
npm test 2>&1 | tail -10
```
Expected: `79 passed` (67 original + 5 plan-guard + 6 subscription-handler + 1 i18n)

- [ ] **Step 8: Commit**

```bash
git add public/js/chat.js
git commit -m "feat: fetch subscription on boot, gate study tools and groups, show paywall on limits"
```

---

## Task 8: Deploy and Manual Test

**Files:**
- No code changes — deploy and verify

- [ ] **Step 1: Push and deploy**

```bash
git push && npx vercel --prod
```

- [ ] **Step 2: Test webhook with LemonSqueezy test sender**

In LemonSqueezy Dashboard → Settings → Webhooks → your webhook → **Send test**. Choose `subscription_created` event. Check Supabase `profiles` table — your user's `plan` should change to `'pro'`.

- [ ] **Step 3: Test free tier limits locally**

```bash
node -e "
const fetch = require('node-fetch') // or use curl
// Send 11 chat messages via API and confirm the 11th returns 403
"
```

Or test manually: log in as a free user, send 10 messages, confirm the 11th shows the paywall modal.

- [ ] **Step 4: Test LemonSqueezy overlay checkout**

Click the "Nadogradi na Pro / Upgrade to Pro" button in the sidebar. Confirm the overlay checkout opens (not a redirect). Use LemonSqueezy test mode card `4242 4242 4242 4242` to complete a test purchase. Confirm plan updates to Pro in Supabase and UI shows Pro badge.
