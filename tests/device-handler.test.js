const { makeDeviceHandler, DEVICE_LIMIT } = require('../src/device-handler')

function makeRes() {
  const res = { statusCode: 200, body: null }
  res.status = jest.fn().mockImplementation(code => { res.statusCode = code; return res })
  res.json = jest.fn().mockImplementation(data => { res.body = data; return res })
  return res
}

function makeReq(body = {}, params = {}) {
  return { body, params, user: { id: 'user-1' } }
}

function makeDb({ existing = null, count = 0, insertError = null } = {}) {
  return {
    from: jest.fn().mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      insert: jest.fn().mockResolvedValue({ error: insertError }),
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnThis() }),
      maybeSingle: jest.fn().mockResolvedValue({ data: existing, error: null }),
      // count query
      head: true,
      then: undefined,
      // For the count select call we need to resolve with { count }
      // We'll handle this by checking the test-specific setup below
    }))
  }
}

// More precise mock that handles both maybeSingle and count queries
function makeFullDb({ existing = null, count = 0, insertError = null, devices = [] } = {}) {
  let callIndex = 0
  const fromImpl = jest.fn().mockImplementation((table) => {
    const chain = {
      select: jest.fn().mockImplementation(function() { return this }),
      eq: jest.fn().mockImplementation(function() { return this }),
      order: jest.fn().mockResolvedValue({ data: devices, error: null }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null })
      }),
      insert: jest.fn().mockResolvedValue({ error: insertError }),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        then: undefined
      }),
      maybeSingle: jest.fn().mockResolvedValue({ data: existing, error: null }),
    }
    // When select is called with { count, head } it's the count query
    chain.select.mockImplementation(function(...args) {
      const opts = args[1]
      if (opts && opts.count === 'exact') {
        chain._isCount = true
      }
      return chain
    })
    // Override then to resolve with count data when it's a count query
    Object.defineProperty(chain, 'then', {
      get() {
        if (chain._isCount) {
          return (resolve) => resolve({ count, error: null })
        }
        return undefined
      }
    })
    return chain
  })
  return { from: fromImpl }
}

test('DEVICE_LIMIT is 3', () => {
  expect(DEVICE_LIMIT).toBe(3)
})

test('register returns 400 when deviceId missing', async () => {
  const { register } = makeDeviceHandler(makeFullDb())
  const res = makeRes()
  await register(makeReq({}), res)
  expect(res.statusCode).toBe(400)
})

test('register updates last_seen for existing device', async () => {
  const db = makeFullDb({ existing: { id: 'dev-row-1' } })
  const { register } = makeDeviceHandler(db)
  const res = makeRes()
  await register(makeReq({ deviceId: 'dev-1', label: 'Mac · Chrome' }), res)
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual({ ok: true })
})

test('register allows new device when under limit', async () => {
  const db = makeFullDb({ existing: null, count: 1 })
  const { register } = makeDeviceHandler(db)
  const res = makeRes()
  await register(makeReq({ deviceId: 'dev-new', label: 'Windows · Edge' }), res)
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual({ ok: true })
})

test('register blocks new device when at limit', async () => {
  const db = makeFullDb({ existing: null, count: DEVICE_LIMIT })
  const { register } = makeDeviceHandler(db)
  const res = makeRes()
  await register(makeReq({ deviceId: 'dev-4', label: 'Linux · Firefox' }), res)
  expect(res.statusCode).toBe(403)
  expect(res.body.error).toBe('device_limit')
  expect(res.body.limit).toBe(DEVICE_LIMIT)
})

test('list returns devices for user', async () => {
  const devices = [
    { device_id: 'dev-1', label: 'Mac · Chrome', last_seen: '2026-05-12T10:00:00Z', created_at: '2026-05-01T00:00:00Z' },
    { device_id: 'dev-2', label: 'iPhone', last_seen: '2026-05-11T08:00:00Z', created_at: '2026-05-01T00:00:00Z' },
  ]
  const { list } = makeDeviceHandler(makeFullDb({ devices }))
  const res = makeRes()
  await list(makeReq(), res)
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual(devices)
})

test('remove deletes device and returns ok', async () => {
  const { remove } = makeDeviceHandler(makeFullDb())
  const res = makeRes()
  await remove(makeReq({}, { deviceId: 'dev-1' }), res)
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual({ ok: true })
})
