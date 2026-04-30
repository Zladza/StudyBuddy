# File Storage — Design Spec
**Date:** 2026-04-30
**Status:** Approved

## Overview

Add Supabase Storage so uploaded files (PDFs and images) are persisted per user. Students can attach multiple files per conversation, reopen a conversation and see its files, and manage all their files through a library.

The AI processing path does not change — files still travel as base64 in the request body. Storage is a persistence layer on top of the existing flow.

---

## Database Schema

### `files` table
```sql
id           uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
name         text NOT NULL
size         integer NOT NULL
mime_type    text NOT NULL
storage_path text NOT NULL
created_at   timestamptz DEFAULT now()
```
RLS: users see and modify only their own rows.

### `conversation_files` join table
```sql
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL
file_id          uuid REFERENCES files(id) ON DELETE CASCADE NOT NULL
created_at       timestamptz DEFAULT now()
```
RLS: users see only rows where the conversation belongs to them.

### Supabase Storage bucket: `study-files`
- Path structure: `{user_id}/{file_id}-{filename}`
- RLS: users can only read/write paths prefixed with their own `user_id`

---

## API Layer

### `src/files-handler.js`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/files` | Upload file to Storage, insert `files` row, return metadata + signed URL |
| `GET` | `/api/files` | List all files for the user (library) |
| `DELETE` | `/api/files/:id` | Delete from Storage + DB (cascades to `conversation_files`) |
| `GET` | `/api/files/:id/url` | Return a fresh signed URL for download/preview |

### `src/conversation-files-handler.js`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/conversations/:id/files` | Link an existing file to a conversation |
| `GET` | `/api/conversations/:id/files` | List files attached to a conversation (with fresh signed URLs) |

### Vercel adapters
- `api/files.js` — handles GET + POST
- `api/files/[id].js` — handles DELETE
- `api/files/[id]/url.js` — handles GET
- `api/conversations/[id]/files.js` — handles GET + POST

---

## Upload Flow

**Current:** file → base64 in memory → sent with message → gone  
**New:** file → base64 in memory AND `POST /api/files` in background → Storage + DB

1. User selects file
2. Browser reads it as base64 (`FileReader`)
3. Client fires `POST /api/files` immediately (non-blocking)
4. Server uploads bytes to Supabase Storage, inserts `files` row, returns `{ id, name, mime_type, storage_path, signedUrl }`
5. Client stores `{ id, name, mime_type, base64, signedUrl }` in `attachedFiles`
6. User sends message — base64 travels to AI as before (no change to AI path)
7. After `conversation_id` is known, client fires `POST /api/conversations/:id/files` to record the link

If step 3–4 fails: file stays in memory, message still sends, user sees a non-blocking warning: *"Fajl nije sačuvan u biblioteku, ali je poslat AI-u."*

---

## Conversation Reopen Flow

1. `loadConversation(id)` runs as today
2. Also fires `GET /api/conversations/:id/files`
3. If files exist → render them in the **conversation files bar** above the input
4. Files shown in the bar are included in the next AI message (fetched via signed URL → base64)
5. User can click `×` to remove a file from the active session (doesn't delete from library)

Files are NOT automatically re-sent with every subsequent message — only when the user explicitly keeps them in the bar.

---

## Frontend Changes

### 1. File upload (`chat.js`)
- `handlePdfSelect` / `handleImageSelect`: after local `FileReader`, also fire `POST /api/files`
- `attachedFiles` array replaces the single `attachedPdf` / `attachedImage` — supports multiple files
- After send, also fire `POST /api/conversations/:id/files` for each file

### 2. Conversation files bar (new)
- Horizontal scrollable strip rendered above the input bar
- Shows: file icon + name + `×` button per file
- Clicking filename opens preview (signed URL in new tab)
- Populated on conversation load via `GET /api/conversations/:id/files`
- Hidden when empty

### 3. File library modal (new)
- New **📁 Fajlovi** button in sidebar (below Notes)
- Grid of file cards: icon, name, size, date
- Per-card actions: **Pregled**, **Preuzmi**, **Obriši**
- **Priloži u chat** button on each card — adds file to the active files bar
- If no active conversation when attaching, file is queued in `attachedFiles` in memory

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Storage upload fails | Non-blocking warning; file still sent to AI via base64 |
| File deleted from library | Conversation files bar silently omits deleted files on reopen |
| Signed URL expired | `GET /api/files/:id/url` always generates a fresh URL — never cached |
| File over size limit | Rejected client-side before upload (20MB PDF, 5MB image) |
| Re-attach before conversation exists | File queued in memory; link created when first message fires |

---

## Supabase Setup Required

1. Create `study-files` Storage bucket (private)
2. Add Storage RLS policy: users can access only `{their_user_id}/*`
3. Run migration SQL for `files` and `conversation_files` tables

---

## Out of Scope

- File deduplication by hash
- Per-user storage quota enforcement
- File versioning
