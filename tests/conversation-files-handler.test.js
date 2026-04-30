const { makeConvFilesHandler } = require('../src/conversation-files-handler')

function makeDbMock({ convFound = true, fileFound = true, convFiles = [] } = {}) {
  return {
    from: jest.fn().mockImplementation((table) => {
      const single = jest.fn().mockImplementation(() => {
        if (table === 'conversations') return Promise.resolve(convFound ? { data: { id: 'conv-1' }, error: null } : { data: null, error: { message: 'not found' } })
        if (table === 'files') return Promise.resolve(fileFound ? { data: { id: 'file-1' }, error: null } : { data: null, error: { message: 'not found' } })
        return Promise.resolve({ data: null, error: null })
      })

      if (table === 'conversation_files') {
        const convFilesQuery = {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: convFiles, error: null }),
          }),
          upsert: jest.fn().mockResolvedValue({ error: null }),
        }
        return convFilesQuery
      }

      const eq = jest.fn().mockReturnThis()
      const select = jest.fn().mockReturnValue({
        eq,
        single,
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

test('listConvFiles returns files with signedUrl and without storage_path', async () => {
  const convFiles = [{
    file_id: 'f1',
    files: { id: 'f1', name: 'notes.pdf', size: 1024, mime_type: 'application/pdf', storage_path: 'user-abc/f1-notes.pdf' }
  }]
  const db = makeDbMock({ convFiles })
  const { listConvFiles } = makeConvFilesHandler(db)
  const res = makeRes()
  await listConvFiles(makeReq({}, { id: 'conv-1' }), res)
  expect(res.statusCode).toBe(200)
  expect(res.body).toHaveLength(1)
  expect(res.body[0].name).toBe('notes.pdf')
  expect(res.body[0].signedUrl).toBe('https://signed.url/test')
  expect(res.body[0].storage_path).toBeUndefined()
})
