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

test('uploadFile deletes DB row when storage upload fails', async () => {
  const db = makeDbMock({ storageError: { message: 'bucket not found' } })
  const { uploadFile } = makeFilesHandler(db)
  const req = makeReq({ name: 'doc.pdf', mime_type: 'application/pdf', size: 1024, base64: 'abc123' })
  const res = makeRes()
  await uploadFile(req, res)
  expect(res.statusCode).toBe(500)
})

test('deleteFile removes from storage and DB and returns success', async () => {
  const db = makeDbMock({ fileRow: { id: 'f1', storage_path: 'user-abc/f1-doc.pdf' } })
  const { deleteFile } = makeFilesHandler(db)
  const res = makeRes()
  await deleteFile(makeReq({}, { id: 'f1' }), res)
  expect(res.statusCode).toBe(200)
  expect(res.body.success).toBe(true)
  expect(db.storage.from).toHaveBeenCalledWith('study-files')
})

test('listFiles returns empty array when user has no files', async () => {
  const db = makeDbMock({ files: null })
  const { listFiles } = makeFilesHandler(db)
  const res = makeRes()
  await listFiles(makeReq(), res)
  expect(res.body).toEqual([])
})
