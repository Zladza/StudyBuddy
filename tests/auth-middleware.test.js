const jwt = require('jsonwebtoken')
const { makeAuthMiddleware } = require('../src/auth-middleware')

const TEST_SECRET = 'test-secret-key'

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function makeSupabaseClient(user) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue(
        user ? { data: { user }, error: null } : { data: { user: null }, error: new Error('invalid') }
      )
    }
  }
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET
})

test('returns 401 when Authorization header is missing', async () => {
  const middleware = makeAuthMiddleware(makeSupabaseClient(null))
  const req = { headers: {} }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('returns 401 when token is invalid and Supabase rejects it', async () => {
  const middleware = makeAuthMiddleware(makeSupabaseClient(null))
  const req = { headers: { authorization: 'Bearer bad-token' } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('calls next() and sets req.user when JWT is valid', async () => {
  const token = jwt.sign(
    { sub: 'user-123', email: 'ana@etf.rs', user_metadata: {} },
    TEST_SECRET
  )
  const middleware = makeAuthMiddleware(makeSupabaseClient(null))
  const req = { headers: { authorization: `Bearer ${token}` } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(next).toHaveBeenCalled()
  expect(req.user.id).toBe('user-123')
  expect(req.user.email).toBe('ana@etf.rs')
  expect(req.token).toBe(token)
})

test('falls back to Supabase API when JWT secret is wrong', async () => {
  process.env.SUPABASE_JWT_SECRET = 'wrong-secret'
  const fakeUser = { id: 'user-123', email: 'ana@etf.rs' }
  const token = jwt.sign({ sub: 'user-123', email: 'ana@etf.rs' }, TEST_SECRET)
  const middleware = makeAuthMiddleware(makeSupabaseClient(fakeUser))
  const req = { headers: { authorization: `Bearer ${token}` } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(next).toHaveBeenCalled()
  expect(req.user).toEqual(fakeUser)
})

test('returns 401 when token is expired and Supabase also rejects', async () => {
  const token = jwt.sign(
    { sub: 'user-123', email: 'ana@etf.rs' },
    TEST_SECRET,
    { expiresIn: -1 }
  )
  const middleware = makeAuthMiddleware(makeSupabaseClient(null))
  const req = { headers: { authorization: `Bearer ${token}` } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})
