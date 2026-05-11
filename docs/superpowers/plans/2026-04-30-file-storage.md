# File Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist uploaded files in Supabase Storage so students can attach multiple files per conversation, reopen a conversation and see its files, and manage all files through a library modal.

**Architecture:** Files are uploaded to a private `study-files` Supabase Storage bucket and tracked in a `files` DB table. A `conversation_files` join table records which files belong to which conversation. The AI processing path is unchanged — files still travel as base64 in the request body. On the frontend, the single `attachedPdf`/`attachedImage` state is replaced by an `attachedFiles` array shown in a unified conversation files bar.

**Tech Stack:** Supabase Storage + Postgres, Express.js handlers (factory pattern), Vercel serverless adapters, vanilla JS frontend

---

## File Map

**Create:**
- `supabase/migration_files.sql` — `files` and `conversation_files` tables + RLS
- `src/files-handler.js` — upload, list, delete, get-url logic
- `src/conversation-files-handler.js` — link file to conversation, list conversation files
- `api/files.js` — Vercel adapter GET + POST `/api/files`
- `api/files/[id].js` — Vercel adapter DELETE `/api/files/:id`
- `api/files/[id]/url.js` — Vercel adapter GET `/api/files/:id/url`
- `api/conversations/[id]/files.js` — Vercel adapter GET + POST `/api/conversations/:id/files`
- `tests/files-handler.test.js`
- `tests/conversation-files-handler.test.js`

**Modify:**
- `src/chat-handler.js` — `buildMessages(messages, files=[])` replaces 3-arg signature; `handleChat` reads `files` array
- `server.js` — register 6 new routes
- `public/index.html` — add conv-files-bar, library modal, library button; remove old pdf-bar/image-bar
- `public/js/chat.js` — `attachedFiles[]` state, upload flow, `loadConversationFiles`, library UI, update `startNewChat`
- `tests/chat-handler.test.js` — update `buildMessages` tests to new signature

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migration_files.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- files table
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  name         text not null,
  size         integer not null,
  mime_type    text not null,
  storage_path text not null,
  created_at   timestamptz default now()
);

alter table public.files enable row level security;

create policy "users manage own files"
  on public.files for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- conversation_files join table
create table if not exists public.conversation_files (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.conversations(id) on delete cascade not null,
  file_id          uuid references public.files(id) on delete cascade not null,
  created_at       timestamptz default now(),
  unique (conversation_id, file_id)
);

alter table public.conversation_files enable row level security;

create policy "users see own conversation files"
  on public.conversation_files for all
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Run migration in Supabase SQL Editor**

Paste the contents of `supabase/migration_files.sql` into the Supabase dashboard SQL Editor and execute.

- [ ] **Step 3: Create Storage bucket in Supabase dashboard**

  - Go to Storage → New bucket
  - Name: `study-files`
  - Public: **OFF** (private)
  - Then add a Storage RLS policy:

```sql
-- Allow users to read/write only their own paths
create policy "users own storage paths"
  on storage.objects for all
  using (
    bucket_id = 'study-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'study-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_files.sql
git commit -m "chore: add files and conversation_files migration SQL"
```

---

### Task 2: `src/files-handler.js`

**Files:**
- Create: `src/files-handler.js`
- Create: `tests/files-handler.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/files-handler.test.js`:

```js
const { makeFilesHandler } = require('../src/files-handler')

function makeDbMock({ fileRow = { id: 'file-123' }, files = [], storageError = null, fileNotFound = false } = {}) {
  const fromMock = jest.fn().mockImplementation((table) => {
    const eq = jest.fn().mockReturnThis()
    const single = jest.fn().mockResolvedValue(
      fileNotFound ? { data: null, error: { message: 'not found' } } : { data: fileRow, error: null }
    )
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: fileRow, error: null }) })
      }),
      select: jest.fn().mockReturnValue({
        eq,
        order: jest.fn().mockResolvedValue({ data: files, error: null }),
        single,
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnThis() }),
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnThis() }),
    }
  })

  const storageMock = {
    from: jest.fn().mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: storageError }),
      remove: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.url/test' }, error: null }),
    })
  }

  return { from: fromMock, storage: storageMock }
}

function makeReq(body = {}, params = {}) {
  return { body, params, user: { id: 'user-abc' } }
}

function makeRes() {
  const res = { statusCode: 200, body: null }
  res.status = jest.fn().mockImplementation(code => { res.statusCode = code; return res })
  res.json = jest.fn().mockImplementation(data => { res.body = data; return res })
  return res
}

test('uploadFile returns 400 when required fields missing', async () => {
  const db = makeDbMock()
  const { uploadFile } = makeFilesHandler(db)
  const res = makeRes()
  await uploadFile(makeReq({ name: 'test.pdf' }), res)
  expect(res.statusCode).toBe(400)
})

test('uploadFile inserts row, uploads to storage, returns metadata', async () => {
  const db = makeDbMock({ fileRow: { id: 'file-123' } })
  const { uploadFile } = makeFilesHandler(db)
  const req = makeReq({ name: 'doc.pdf', mime_type: 'application/pdf', size: 1024, base64: 'abc123' })
  const res = makeRes()
  await uploadFile(req, res)
  expect(res.statusCode).toBe(200)
  expect(res.body.id).toBe('file-123')
  expect(res.body.signedUrl).toBe('https://signed.url/test')
  expect(db.storage.from).toHaveBeenCalledWith('study-files')
})

test('listFiles returns user files', async () => {
  const fileList = [{ id: 'f1', name: 'notes.pdf', size: 500, mime_type: 'application/pdf', created_at: '2026-01-01' }]
  const db = makeDbMock({ files: fileList })
  const { listFiles } = makeFilesHandler(db)
  const res = makeRes()
  await listFiles(makeReq(), res)
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual(fileList)
})

test('deleteFile returns 404 when file not found', async () => {
  const db = makeDbMock({ fileNotFound: true })
  const { deleteFile } = makeFilesHandler(db)
  const res = makeRes()
  await deleteFile(makeReq({}, { id: 'bad-id' }), res)
  expect(res.statusCode).toBe(404)
})

test('getSignedUrl returns 404 when file not found', async () => {
  const db = makeDbMock({ fileNotFound: true })
  const { getSignedUrl } = makeFilesHandler(db)
  const res = makeRes()
  await getSignedUrl(makeReq({}, { id: 'bad-id' }), res)
  expect(res.statusCode).toBe(404)
})

test('getSignedUrl returns fresh signed URL', async () => {
  const db = makeDbMock({ fileRow: { id: 'f1', storage_path: 'user-abc/f1-doc.pdf' } })
  const { getSignedUrl } = makeFilesHandler(db)
  const res = makeRes()
  await getSignedUrl(makeReq({}, { id: 'f1' }), res)
  expect(res.body.signedUrl).toBe('https://signed.url/test')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/files-handler.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../src/files-handler'`

- [ ] **Step 3: Implement `src/files-handler.js`**

```js
const { createClient } = require('@supabase/supabase-js')

function makeFilesHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function uploadFile(req, res) {
    const { name, mime_type, size, base64 } = req.body
    if (!name || !mime_type || !size || !base64) {
      return res.status(400).json({ error: 'name, mime_type, size, base64 required.' })
    }

    const { data: fileRow, error: insertError } = await db
      .from('files')
      .insert({ user_id: req.user.id, name, size, mime_type, storage_path: 'pending' })
      .select('id')
      .single()

    if (insertError) {
      console.error('uploadFile insert error:', insertError)
      return res.status(500).json({ error: 'Greška pri čuvanju fajla.' })
    }

    const fileId = fileRow.id
    const storagePath = `${req.user.id}/${fileId}-${name}`
    const buffer = Buffer.from(base64, 'base64')

    const { error: storageError } = await db.storage
      .from('study-files')
      .upload(storagePath, buffer, { contentType: mime_type })

    if (storageError) {
      console.error('uploadFile storage error:', storageError)
      await db.from('files').delete().eq('id', fileId)
      return res.status(500).json({ error: 'Greška pri uploadovanju fajla.' })
    }

    await db.from('files').update({ storage_path: storagePath }).eq('id', fileId)

    const { data: urlData } = await db.storage
      .from('study-files')
      .createSignedUrl(storagePath, 3600)

    res.json({ id: fileId, name, mime_type, size, storage_path: storagePath, signedUrl: urlData?.signedUrl || null })
  }

  async function listFiles(req, res) {
    const { data, error } = await db
      .from('files')
      .select('id, name, size, mime_type, storage_path, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('listFiles error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju fajlova.' })
    }
    res.json(data)
  }

  async function deleteFile(req, res) {
    const { id } = req.params
    const { data: file, error: fetchError } = await db
      .from('files')
      .select('storage_path')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single()

    if (fetchError || !file) return res.status(404).json({ error: 'Fajl nije pronađen.' })

    await db.storage.from('study-files').remove([file.storage_path])

    const { error } = await db
      .from('files')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)

    if (error) {
      console.error('deleteFile error:', error)
      return res.status(500).json({ error: 'Greška pri brisanju fajla.' })
    }
    res.json({ success: true })
  }

  async function getSignedUrl(req, res) {
    const { id } = req.params
    const { data: file, error } = await db
      .from('files')
      .select('storage_path')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single()

    if (error || !file) return res.status(404).json({ error: 'Fajl nije pronađen.' })

    const { data: urlData, error: urlError } = await db.storage
      .from('study-files')
      .createSignedUrl(file.storage_path, 3600)

    if (urlError || !urlData) {
      return res.status(500).json({ error: 'Greška pri generisanju URL-a.' })
    }
    res.json({ signedUrl: urlData.signedUrl })
  }

  return { uploadFile, listFiles, deleteFile, getSignedUrl }
}

module.exports = { makeFilesHandler }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/files-handler.test.js --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/files-handler.js tests/files-handler.test.js
git commit -m "feat: add files handler with upload, list, delete, signed URL"
```

---

### Task 3: `src/conversation-files-handler.js`

**Files:**
- Create: `src/conversation-files-handler.js`
- Create: `tests/conversation-files-handler.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/conversation-files-handler.test.js`:

```js
const { makeConvFilesHandler } = require('../src/conversation-files-handler')

function makeDbMock({ convFound = true, fileFound = true, convFiles = [] } = {}) {
  return {
    from: jest.fn().mockImplementation((table) => {
      const eq = jest.fn().mockReturnThis()
      const single = jest.fn().mockImplementation(() => {
        if (table === 'conversations') return Promise.resolve(convFound ? { data: { id: 'conv-1' }, error: null } : { data: null, error: { message: 'not found' } })
        if (table === 'files') return Promise.resolve(fileFound ? { data: { id: 'file-1' }, error: null } : { data: null, error: { message: 'not found' } })
        return Promise.resolve({ data: null, error: null })
      })
      const select = jest.fn().mockReturnValue({
        eq,
        single,
        order: jest.fn().mockResolvedValue({ data: convFiles, error: null }),
      })
      return {
        select,
        upsert: jest.fn().mockResolvedValue({ error: null }),
      }
    }),
    storage: {
      from: jest.fn().mockReturnValue({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.url/test' }, error: null }),
      })
    }
  }
}

function makeReq(body = {}, params = {}) {
  return { body, params, user: { id: 'user-abc' } }
}

function makeRes() {
  const res = { statusCode: 200, body: null }
  res.status = jest.fn().mockImplementation(code => { res.statusCode = code; return res })
  res.json = jest.fn().mockImplementation(data => { res.body = data; return res })
  return res
}

test('linkFile returns 404 when conversation not found', async () => {
  const db = makeDbMock({ convFound: false })
  const { linkFile } = makeConvFilesHandler(db)
  const res = makeRes()
  await linkFile(makeReq({ fileId: 'file-1' }, { id: 'conv-1' }), res)
  expect(res.statusCode).toBe(404)
})

test('linkFile returns 404 when file not found', async () => {
  const db = makeDbMock({ fileFound: false })
  const { linkFile } = makeConvFilesHandler(db)
  const res = makeRes()
  await linkFile(makeReq({ fileId: 'file-1' }, { id: 'conv-1' }), res)
  expect(res.statusCode).toBe(404)
})

test('linkFile returns success when both exist', async () => {
  const db = makeDbMock()
  const { linkFile } = makeConvFilesHandler(db)
  const res = makeRes()
  await linkFile(makeReq({ fileId: 'file-1' }, { id: 'conv-1' }), res)
  expect(res.body.success).toBe(true)
})

test('listConvFiles returns 404 when conversation not found', async () => {
  const db = makeDbMock({ convFound: false })
  const { listConvFiles } = makeConvFilesHandler(db)
  const res = makeRes()
  await listConvFiles(makeReq({}, { id: 'conv-bad' }), res)
  expect(res.statusCode).toBe(404)
})

test('listConvFiles returns empty array when no files', async () => {
  const db = makeDbMock({ convFiles: [] })
  const { listConvFiles } = makeConvFilesHandler(db)
  const res = makeRes()
  await listConvFiles(makeReq({}, { id: 'conv-1' }), res)
  expect(res.body).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/conversation-files-handler.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../src/conversation-files-handler'`

- [ ] **Step 3: Implement `src/conversation-files-handler.js`**

```js
const { createClient } = require('@supabase/supabase-js')

function makeConvFilesHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function linkFile(req, res) {
    const { id: conversationId } = req.params
    const { fileId } = req.body

    if (!fileId) return res.status(400).json({ error: 'fileId required.' })

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single()

    if (convError || !conv) return res.status(404).json({ error: 'Razgovor nije pronađen.' })

    const { data: file, error: fileError } = await db
      .from('files')
      .select('id')
      .eq('id', fileId)
      .eq('user_id', req.user.id)
      .single()

    if (fileError || !file) return res.status(404).json({ error: 'Fajl nije pronađen.' })

    const { error } = await db
      .from('conversation_files')
      .upsert({ conversation_id: conversationId, file_id: fileId }, { onConflict: 'conversation_id,file_id' })

    if (error) {
      console.error('linkFile error:', error)
      return res.status(500).json({ error: 'Greška pri povezivanju fajla.' })
    }
    res.json({ success: true })
  }

  async function listConvFiles(req, res) {
    const { id: conversationId } = req.params

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single()

    if (convError || !conv) return res.status(404).json({ error: 'Razgovor nije pronađen.' })

    const { data, error } = await db
      .from('conversation_files')
      .select('file_id, files(id, name, size, mime_type, storage_path)')
      .eq('conversation_id', conversationId)

    if (error) {
      console.error('listConvFiles error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju fajlova.' })
    }

    const files = await Promise.all((data || []).map(async row => {
      const f = row.files
      if (!f) return null
      const { data: urlData } = await db.storage
        .from('study-files')
        .createSignedUrl(f.storage_path, 3600)
      return { ...f, signedUrl: urlData?.signedUrl || null }
    }))

    res.json(files.filter(Boolean))
  }

  return { linkFile, listConvFiles }
}

module.exports = { makeConvFilesHandler }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/conversation-files-handler.test.js --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/conversation-files-handler.js tests/conversation-files-handler.test.js
git commit -m "feat: add conversation-files handler for linking and listing files per conversation"
```

---

### Task 4: Vercel API Adapters

**Files:**
- Create: `api/files.js`
- Create: `api/files/[id].js`
- Create: `api/files/[id]/url.js`
- Create: `api/conversations/[id]/files.js`

- [ ] **Step 1: Create `api/files.js`**

```js
const { makeAuthMiddleware } = require('../src/auth-middleware')
const { makeFilesHandler } = require('../src/files-handler')

const requireAuth = makeAuthMiddleware()
const files = makeFilesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  if (req.method === 'GET') return files.listFiles(req, res)
  if (req.method === 'POST') return files.uploadFile(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
```

- [ ] **Step 2: Create `api/files/[id].js`**

First run `mkdir -p api/files`.

```js
const { makeAuthMiddleware } = require('../../src/auth-middleware')
const { makeFilesHandler } = require('../../src/files-handler')

const requireAuth = makeAuthMiddleware()
const files = makeFilesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'DELETE') return files.deleteFile(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
```

- [ ] **Step 3: Create `api/files/[id]/url.js`**

First run `mkdir -p "api/files/[id]"`.

```js
const { makeAuthMiddleware } = require('../../../src/auth-middleware')
const { makeFilesHandler } = require('../../../src/files-handler')

const requireAuth = makeAuthMiddleware()
const files = makeFilesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'GET') return files.getSignedUrl(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
```

- [ ] **Step 4: Create `api/conversations/[id]/files.js`**

First run `mkdir -p "api/conversations/[id]"`.

```js
const { makeAuthMiddleware } = require('../../../src/auth-middleware')
const { makeConvFilesHandler } = require('../../../src/conversation-files-handler')

const requireAuth = makeAuthMiddleware()
const convFiles = makeConvFilesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'GET') return convFiles.listConvFiles(req, res)
  if (req.method === 'POST') return convFiles.linkFile(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
```

- [ ] **Step 5: Commit**

```bash
git add api/files.js "api/files/[id].js" "api/files/[id]/url.js" "api/conversations/[id]/files.js"
git commit -m "feat: add Vercel adapters for files and conversation-files endpoints"
```

---

### Task 5: Register Routes in `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add file routes after the notes routes**

In `server.js`, after the notes routes block (lines 70–74), add:

```js
const { makeFilesHandler } = require('./src/files-handler')
const { makeConvFilesHandler } = require('./src/conversation-files-handler')
const filesHandler = makeFilesHandler()
const convFilesHandler = makeConvFilesHandler()

app.get('/api/files', requireAuth, (req, res) => filesHandler.listFiles(req, res))
app.post('/api/files', requireAuth, (req, res) => filesHandler.uploadFile(req, res))
app.delete('/api/files/:id', requireAuth, (req, res) => filesHandler.deleteFile(req, res))
app.get('/api/files/:id/url', requireAuth, (req, res) => filesHandler.getSignedUrl(req, res))
app.get('/api/conversations/:id/files', requireAuth, (req, res) => convFilesHandler.listConvFiles(req, res))
app.post('/api/conversations/:id/files', requireAuth, (req, res) => convFilesHandler.linkFile(req, res))
```

- [ ] **Step 2: Run all existing tests to confirm nothing is broken**

```bash
npx jest --no-coverage
```

Expected: all existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: register files and conversation-files routes in Express server"
```

---

### Task 6: Update `src/chat-handler.js` — Multiple Files Support

**Files:**
- Modify: `src/chat-handler.js`
- Modify: `tests/chat-handler.test.js`

- [ ] **Step 1: Write failing tests for new `buildMessages` signature**

Replace the existing `buildMessages` tests in `tests/chat-handler.test.js` with:

```js
const { validateRequest, buildMessages, SYSTEM_PROMPT } = require('../src/chat-handler')

test('validateRequest returns error for missing messages', () => {
  expect(validateRequest({ language: 'sr' })).toBe('Messages must be an array.')
})

test('validateRequest returns error for invalid language', () => {
  expect(validateRequest({ messages: [], language: 'de' })).toBe('Language must be sr or en.')
})

test('validateRequest returns null for valid input', () => {
  expect(validateRequest({ messages: [], language: 'sr' })).toBeNull()
  expect(validateRequest({ messages: [], language: 'en' })).toBeNull()
})

test('buildMessages returns plain messages when no files', () => {
  const input = [
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  expect(buildMessages(input, [])).toEqual([
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ])
})

test('buildMessages defaults to empty files when omitted', () => {
  const input = [{ role: 'user', content: 'test' }]
  expect(buildMessages(input)).toEqual([{ role: 'user', content: 'test' }])
})

test('buildMessages wraps last user message with PDF document block', () => {
  const input = [{ role: 'user', content: 'Sumiraj ovo' }]
  const result = buildMessages(input, [{ base64: 'base64pdfdata==', mediaType: 'application/pdf', name: 'test.pdf' }])
  expect(result[0].content[0]).toEqual({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'base64pdfdata==' }
  })
  expect(result[0].content[1].type).toBe('text')
  expect(result[0].content[1].text).toContain('Sumiraj ovo')
})

test('buildMessages wraps last user message with image block', () => {
  const input = [{ role: 'user', content: 'Šta je ovo?' }]
  const result = buildMessages(input, [{ base64: 'imgdata==', mediaType: 'image/jpeg', name: 'foto.jpg' }])
  expect(result[0].content[0]).toEqual({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'imgdata==' }
  })
})

test('buildMessages handles multiple files in order', () => {
  const input = [{ role: 'user', content: 'Analiziraj' }]
  const result = buildMessages(input, [
    { base64: 'pdfdata==', mediaType: 'application/pdf', name: 'doc.pdf' },
    { base64: 'imgdata==', mediaType: 'image/png', name: 'fig.png' }
  ])
  expect(result[0].content[0].type).toBe('document')
  expect(result[0].content[1].type).toBe('image')
  expect(result[0].content[2].type).toBe('text')
})

test('buildMessages uses PDF hint when any file is a PDF', () => {
  const input = [{ role: 'user', content: 'Pregled' }]
  const result = buildMessages(input, [{ base64: 'pdf==', mediaType: 'application/pdf', name: 'doc.pdf' }])
  const text = result[0].content.find(p => p.type === 'text').text
  expect(text).toContain('document has been uploaded')
})

test('buildMessages uses image hint when all files are images', () => {
  const input = [{ role: 'user', content: 'Pregled' }]
  const result = buildMessages(input, [{ base64: 'img==', mediaType: 'image/jpeg', name: 'foto.jpg' }])
  const text = result[0].content.find(p => p.type === 'text').text
  expect(text).toContain('image has been uploaded')
})

test('buildMessages fills empty content with placeholder', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildMessages(input, [])
  expect(result[0].content).toBe('[Priložen fajl]')
})

test('SYSTEM_PROMPT contains key StudyBuddy instructions', () => {
  expect(SYSTEM_PROMPT).toContain('StudyBuddy')
  expect(SYSTEM_PROMPT).toContain('seminarski')
  expect(SYSTEM_PROMPT).toContain('finalni tekst pišeš ti')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/chat-handler.test.js --no-coverage
```

Expected: several FAIL — old `buildMessages` signature has 3 positional args, tests pass arrays now

- [ ] **Step 3: Update `buildMessages` and `handleChat` in `src/chat-handler.js`**

Replace the `buildMessages` function (lines 97–116) with:

```js
function buildMessages(messages, files = []) {
  const clean = messages.map(m => ({ role: m.role, content: m.content || '[Priložen fajl]' }))
  if (!files.length) return clean

  const hasPdf = files.some(f => f.mediaType === 'application/pdf')

  return clean.map((m, i) => {
    const isLastUser = m.role === 'user' && !clean.slice(i + 1).some(x => x.role === 'user')
    if (!isLastUser) return m

    const parts = []
    for (const f of files) {
      if (f.mediaType === 'application/pdf') {
        parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } })
      } else {
        parts.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } })
      }
    }

    const userText = m.content.trim()
    const fileHint = hasPdf
      ? '[MANDATORY: A document has been uploaded. You MUST read it fully and carefully before answering. Quote the relevant parts. Do not add information not present in the document.]'
      : '[MANDATORY: An image has been uploaded. You MUST transcribe ALL visible text exactly before answering — including handwritten text, numbers, formulas, and labels. Flag any unclear parts explicitly. Never guess at unclear content.]'
    const fullText = userText.length < 10 ? `${fileHint}\n${userText || 'Analiziraj priloženi materijal.'}` : `${fileHint}\n${userText}`
    parts.push({ type: 'text', text: fullText })
    return { role: 'user', content: parts }
  })
}
```

Replace the `handleChat` function body (lines 118–162) — update the destructuring and stream selection:

```js
async function handleChat(req, res, anthropicClient) {
  const validationError = validateRequest(req.body)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  const { messages, language, files = [] } = req.body
  const hasPdf = files.some(f => f.mediaType === 'application/pdf')
  const client = anthropicClient || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const contextLimit = files.length > 0 ? 8 : 20
  const recentMessages = messages.slice(-contextLimit)
  const anthropicMessages = buildMessages(recentMessages, files)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const streamParams = {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages
    }
    const stream = hasPdf
      ? client.beta.messages.stream({ ...streamParams, betas: ['pdfs-2024-09-25'] })
      : client.messages.stream(streamParams)

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
    })

    await stream.finalMessage()
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  } catch (err) {
    console.error('handleChat error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service error.' })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Nešto nije u redu sa asistentom. Pokušaj za koji trenutak.' })}\n\n`)
      res.end()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/chat-handler.test.js --no-coverage
```

Expected: PASS (11 tests)

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/chat-handler.js tests/chat-handler.test.js
git commit -m "feat: update buildMessages to accept files array; handleChat reads files[] from request body"
```

---

### Task 7: Frontend HTML — Files Bar + Library Modal

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace `pdf-bar` and `image-bar` with unified conv-files-bar**

Find the `pdf-bar` div block in `public/index.html` and the `image-bar` div block. Replace both with a single `conv-files-bar`:

```html
<!-- Remove this entire pdf-bar block: -->
<div id="pdf-bar" class="hidden ...">...</div>

<!-- Remove this entire image-bar block: -->
<div id="image-bar" class="hidden ...">...</div>

<!-- Add this unified files bar in their place (above the main-input-bar): -->
<div id="conv-files-bar" class="hidden mx-4 mb-2 flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin"></div>
```

- [ ] **Step 2: Add the library modal before the closing `</body>` tag**

```html
<!-- File Library Modal -->
<div id="library-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
  <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]">
    <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100 dark:border-gray-700 flex-shrink-0">
      <h2 class="font-bold text-lg text-slate-800 dark:text-white">Biblioteka fajlova</h2>
      <button onclick="closeLibrary()" class="text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
    </div>
    <div id="library-empty" class="hidden flex-1 flex items-center justify-center text-slate-400 dark:text-gray-500 text-sm py-12">
      Još nema fajlova u biblioteci.
    </div>
    <div id="library-grid" class="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3"></div>
  </div>
</div>
```

- [ ] **Step 3: Add library button in sidebar (below Notes button)**

Find the Notes sidebar button (has `onclick="openNotes()"`) and add immediately after it:

```html
<button onclick="openLibrary()" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-gray-700 transition text-left">
  <span class="text-xl">📁</span>
  <span class="text-sm font-medium text-slate-700 dark:text-gray-200">Fajlovi</span>
</button>
```

- [ ] **Step 4: Start dev server and verify sidebar shows Fajlovi button and modal structure exists**

```bash
node server.js
```

Open `http://localhost:3000` in the browser. Confirm:
- Sidebar has "📁 Fajlovi" button
- Library modal exists in DOM (hidden)
- Old pdf-bar/image-bar are gone
- conv-files-bar div exists above input

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add conv-files-bar, library modal, and library sidebar button"
```

---

### Task 8: Frontend JS — attachedFiles State + Upload Flow + Library

**Files:**
- Modify: `public/js/chat.js`

- [ ] **Step 1: Replace attachedPdf / attachedImage state with attachedFiles array**

At the top of `chat.js`, find lines:
```js
let attachedPdf = null
let attachedImage = null
```
Replace with:
```js
let attachedFiles = []
```

- [ ] **Step 2: Update `startNewChat` to clear attachedFiles**

Find `startNewChat()` and replace the pdf/image reset lines:
```js
// Remove these 4 lines:
attachedPdf = null
attachedImage = null
document.getElementById('pdf-bar').classList.add('hidden')
document.getElementById('image-bar').classList.add('hidden')

// Replace with:
attachedFiles = []
renderAttachedFilesBar()
```

- [ ] **Step 3: Add `renderAttachedFilesBar()`**

Add this function after `startNewChat`:

```js
function renderAttachedFilesBar() {
  const bar = document.getElementById('conv-files-bar')
  if (!bar) return
  bar.innerHTML = ''
  if (!attachedFiles.length) { bar.classList.add('hidden'); return }
  bar.classList.remove('hidden')
  attachedFiles.forEach((f, idx) => {
    const chip = document.createElement('div')
    chip.className = 'flex items-center gap-1.5 bg-slate-100 dark:bg-gray-700 rounded-lg px-3 py-1.5 flex-shrink-0 max-w-[200px]'
    const icon = f.mime_type === 'application/pdf' ? '📄' : '🖼️'
    const nameEl = document.createElement('span')
    nameEl.className = 'text-xs text-slate-700 dark:text-gray-200 truncate'
    nameEl.textContent = `${icon} ${f.name}`
    if (f.signedUrl) {
      nameEl.style.cursor = 'pointer'
      nameEl.onclick = () => window.open(f.signedUrl, '_blank')
    }
    const removeBtn = document.createElement('button')
    removeBtn.className = 'text-slate-400 hover:text-red-500 text-sm leading-none flex-shrink-0'
    removeBtn.textContent = '×'
    removeBtn.onclick = () => { attachedFiles.splice(idx, 1); renderAttachedFilesBar() }
    chip.appendChild(nameEl)
    chip.appendChild(removeBtn)
    bar.appendChild(chip)
  })
}
```

- [ ] **Step 4: Rewrite `handlePdfSelect` and `handleImageSelect`**

Replace `handlePdfSelect` (lines 448–460):

```js
function handlePdfSelect(event) {
  const file = event.target.files[0]
  if (!file) return
  if (file.size > 20 * 1024 * 1024) { showError(I18N[currentLang].fileTooLarge); return }
  const reader = new FileReader()
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1]
    const fileEntry = { name: file.name, mime_type: 'application/pdf', base64, size: file.size, id: null, signedUrl: null }
    attachedFiles.push(fileEntry)
    renderAttachedFilesBar()
    const token = getAccessToken()
    if (token) {
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, mime_type: 'application/pdf', size: file.size, base64 })
        })
        if (res.ok) {
          const data = await res.json()
          fileEntry.id = data.id
          fileEntry.signedUrl = data.signedUrl
          renderAttachedFilesBar()
        }
      } catch {}
    }
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}
```

Replace `removePdf` (lines 462–465) — delete it entirely (no longer needed, × button handles removal).

Replace `handleImageSelect` (lines 468–483):

```js
function handleImageSelect(event) {
  const file = event.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { showError(I18N[currentLang].imageTooLarge); return }
  const reader = new FileReader()
  reader.onload = async (e) => {
    const dataUrl = e.target.result
    const base64 = dataUrl.split(',')[1]
    const fileEntry = { name: file.name, mime_type: file.type, base64, size: file.size, id: null, signedUrl: null, previewUrl: dataUrl }
    attachedFiles.push(fileEntry)
    renderAttachedFilesBar()
    const token = getAccessToken()
    if (token) {
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, mime_type: file.type, size: file.size, base64 })
        })
        if (res.ok) {
          const data = await res.json()
          fileEntry.id = data.id
          fileEntry.signedUrl = data.signedUrl
          renderAttachedFilesBar()
        }
      } catch {}
    }
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}
```

Delete `removeImage` (lines 485–489) — no longer needed.

- [ ] **Step 5: Rewrite `sendMessage` to use `attachedFiles`**

In `sendMessage`, replace the old pdf/image logic. Find these lines:
```js
if (!text && !attachedPdf && !attachedImage) return
```
Replace with:
```js
if (!text && !attachedFiles.length) return
```

Find:
```js
const displayText = text || (attachedPdf ? '📎 ' + attachedPdf.name : attachedImage ? '📷 ' + attachedImage.name : '')
const messageContent = text || displayText
const userMsg = { role: 'user', content: messageContent, hasPdf: !!attachedPdf, sentAt: Date.now() }
```
Replace with:
```js
const firstFile = attachedFiles[0]
const displayText = text || (firstFile ? (firstFile.mime_type === 'application/pdf' ? '📎 ' : '🖼️ ') + firstFile.name : '')
const messageContent = text || displayText
const userMsg = { role: 'user', content: messageContent, hasPdf: attachedFiles.some(f => f.mime_type === 'application/pdf'), sentAt: Date.now() }
```

Find:
```js
const pdf = attachedPdf?.base64 || null
const image = attachedImage?.base64 || null
const imageType = attachedImage?.mediaType || null
removePdf()
removeImage()
```
Replace with:
```js
const filesSnapshot = [...attachedFiles]
attachedFiles = []
renderAttachedFilesBar()
```

Find the fetch body inside `sendMessage`:
```js
body: JSON.stringify({
  messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
  language: currentLang,
  pdf,
  image,
  imageType
}),
```
Replace with:
```js
body: JSON.stringify({
  messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
  language: currentLang,
  files: filesSnapshot.map(f => ({ base64: f.base64, mediaType: f.mime_type, name: f.name }))
}),
```

After `await saveExchange([userMsg, assistantMsg], token)`, add file linking:

```js
await saveExchange([userMsg, assistantMsg], token)
// Link stored files to conversation (non-blocking)
if (currentConversationId) {
  const storedFiles = filesSnapshot.filter(f => f.id)
  if (storedFiles.length) {
    const token2 = getAccessToken()
    storedFiles.forEach(f => {
      fetch(`/api/conversations/${currentConversationId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
        body: JSON.stringify({ fileId: f.id })
      }).catch(() => {})
    })
  }
}
```

- [ ] **Step 6: Add `loadConversationFiles` and call it from `loadConversation`**

Add this function after `loadConversation`:

```js
async function loadConversationFiles(conversationId) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/conversations/${conversationId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return
    const files = await res.json()
    if (!files.length) return
    attachedFiles = files.map(f => ({
      id: f.id,
      name: f.name,
      mime_type: f.mime_type,
      size: f.size,
      signedUrl: f.signedUrl,
      base64: null
    }))
    renderAttachedFilesBar()
  } catch {}
}
```

In `loadConversation`, after `scrollToBottom()` at the end, add:

```js
attachedFiles = []
await loadConversationFiles(id)
```

- [ ] **Step 7: Add library functions**

Add these functions at the end of `chat.js`:

```js
// ── File Library ───────────────────────────────────────────────────────────
async function openLibrary() {
  document.getElementById('library-modal').classList.remove('hidden')
  closeSidebar()
  await refreshLibrary()
}

function closeLibrary() {
  document.getElementById('library-modal').classList.add('hidden')
}

async function refreshLibrary() {
  const token = getAccessToken()
  if (!token) return
  const grid = document.getElementById('library-grid')
  const empty = document.getElementById('library-empty')
  grid.innerHTML = '<p class="text-xs text-slate-400 col-span-2 py-4 text-center">Učitavanje...</p>'

  try {
    const res = await fetch('/api/files', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { grid.innerHTML = ''; return }
    const files = await res.json()

    grid.innerHTML = ''
    if (!files.length) {
      empty.classList.remove('hidden')
      return
    }
    empty.classList.add('hidden')

    files.forEach(f => {
      const sizeKB = (f.size / 1024).toFixed(0)
      const date = new Date(f.created_at).toLocaleDateString('sr-Latn-RS')
      const icon = f.mime_type === 'application/pdf' ? '📄' : '🖼️'
      const card = document.createElement('div')
      card.className = 'flex items-start gap-3 bg-slate-50 dark:bg-gray-750 rounded-xl p-3 border border-slate-100 dark:border-gray-700'
      card.innerHTML = `
        <span class="text-2xl flex-shrink-0">${icon}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-slate-800 dark:text-white truncate" title="${f.name}">${f.name}</p>
          <p class="text-xs text-slate-400 dark:text-gray-500 mt-0.5">${sizeKB} KB · ${date}</p>
          <div class="flex gap-2 mt-2 flex-wrap">
            <button onclick="previewLibraryFile('${f.id}')" class="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition">Pregled</button>
            <button onclick="downloadLibraryFile('${f.id}', '${f.name}')" class="text-xs bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300 px-2 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-gray-600 transition">Preuzmi</button>
            <button onclick="attachLibraryFile('${f.id}', '${f.name}', '${f.mime_type}', ${f.size})" class="text-xs bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/50 transition">Priloži u čet</button>
            <button onclick="deleteLibraryFile('${f.id}')" class="text-xs bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 px-2 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition">Obriši</button>
          </div>
        </div>
      `
      grid.appendChild(card)
    })
  } catch {
    grid.innerHTML = ''
  }
}

async function previewLibraryFile(id) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/files/${id}/url`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const { signedUrl } = await res.json()
    window.open(signedUrl, '_blank')
  } catch {}
}

async function downloadLibraryFile(id, name) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/files/${id}/url`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const { signedUrl } = await res.json()
    const a = document.createElement('a')
    a.href = signedUrl
    a.download = name
    a.click()
  } catch {}
}

async function attachLibraryFile(id, name, mimeType, size) {
  const token = getAccessToken()
  if (!token) return
  try {
    const urlRes = await fetch(`/api/files/${id}/url`, { headers: { Authorization: `Bearer ${token}` } })
    if (!urlRes.ok) return
    const { signedUrl } = await urlRes.json()

    const fileRes = await fetch(signedUrl)
    const blob = await fileRes.blob()
    const base64 = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target.result.split(',')[1])
      reader.readAsDataURL(blob)
    })

    attachedFiles.push({ id, name, mime_type: mimeType, size, signedUrl, base64 })
    renderAttachedFilesBar()
    closeLibrary()
    showToast('Fajl priložen u čet', 'success')
  } catch { showToast('Greška pri prilaganju fajla', 'error') }
}

async function deleteLibraryFile(id) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/files/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) { showToast('Greška pri brisanju', 'error'); return }
    attachedFiles = attachedFiles.filter(f => f.id !== id)
    renderAttachedFilesBar()
    showToast('Fajl obrisan', 'success')
    await refreshLibrary()
  } catch { showToast('Greška pri brisanju', 'error') }
}
```

- [ ] **Step 8: Handle `sendMessage` lazy base64 fetch for files from library/reopen**

In `sendMessage`, replace the files mapping line:
```js
files: filesSnapshot.map(f => ({ base64: f.base64, mediaType: f.mime_type, name: f.name }))
```
with a pre-fetch step before the `fetch('/api/chat', ...)` call. Replace the entire fetch block starting with `currentAbortController = new AbortController()` preamble lines:

After `const filesSnapshot = [...attachedFiles]` and before `currentAbortController = new AbortController()`, add:

```js
// Fetch base64 for files that came from library/reopen (signedUrl only, no base64 yet)
const resolvedFiles = await Promise.all(filesSnapshot.map(async f => {
  if (f.base64) return f
  if (!f.signedUrl) return null
  try {
    const fileRes = await fetch(f.signedUrl)
    const blob = await fileRes.blob()
    const base64 = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target.result.split(',')[1])
      reader.readAsDataURL(blob)
    })
    return { ...f, base64 }
  } catch { return null }
}))
const filesToSend = resolvedFiles.filter(Boolean).filter(f => f.base64)
```

Then update the fetch body to use `filesToSend`:
```js
files: filesToSend.map(f => ({ base64: f.base64, mediaType: f.mime_type, name: f.name }))
```

- [ ] **Step 9: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests PASS

- [ ] **Step 10: Smoke-test in browser**

Start server: `node server.js`

Test these flows:
1. Attach a PDF → chip appears in files bar → send message → AI reads it
2. Attach an image → chip appears → send message → AI reads it
3. Attach multiple files → multiple chips → all sent to AI
4. Reopen a conversation with files → files bar shows them → send follow-up → AI reads them
5. Open library → uploaded files appear → Preview opens in new tab → Delete removes from library
6. Library "Priloži u čet" → file appears in bar → send message → AI reads it
7. New chat → files bar clears

- [ ] **Step 11: Commit**

```bash
git add public/js/chat.js
git commit -m "feat: replace attachedPdf/attachedImage with attachedFiles array; add upload flow, conversation files bar, and file library"
```

---

## Supabase Setup Reminder

Before testing end-to-end, ensure these are done (Task 1 covers the SQL, but confirm):

1. `study-files` bucket created (private) in Supabase Storage
2. Storage RLS policy added for `{user_id}/*` paths
3. `migration_files.sql` run in Supabase SQL Editor
4. `SUPABASE_SERVICE_KEY` env var present in `.env` and in Vercel project settings (needed for Storage uploads via service role)
