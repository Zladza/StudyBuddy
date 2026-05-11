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
