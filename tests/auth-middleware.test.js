const jwt = require('jsonwebtoken')
const { makeAuthMiddleware } = require('../src/auth-middleware')

const TEST_SECRET = 'test-secret-key'

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET
})

test('returns 401 when Authorization header is missing', () => {
  const middleware = makeAuthMiddleware()
  const req = { headers: {} }
  const res = mockRes()
  const next = jest.fn()

  middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('returns 401 when token is invalid', () => {
  const middleware = makeAuthMiddleware()
  const req = { headers: { authorization: 'Bearer bad-token' } }
  const res = mockRes()
  const next = jest.fn()

  middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('calls next() and sets req.user when token is valid', () => {
  const token = jwt.sign(
    { sub: 'user-123', email: 'ana@etf.rs', user_metadata: {} },
    TEST_SECRET
  )
  const middleware = makeAuthMiddleware()
  const req = { headers: { authorization: `Bearer ${token}` } }
  const res = mockRes()
  const next = jest.fn()

  middleware(req, res, next)

  expect(next).toHaveBeenCalled()
  expect(req.user.id).toBe('user-123')
  expect(req.user.email).toBe('ana@etf.rs')
  expect(req.token).toBe(token)
})

test('returns 401 when token is expired', () => {
  const token = jwt.sign(
    { sub: 'user-123', email: 'ana@etf.rs' },
    TEST_SECRET,
    { expiresIn: -1 }
  )
  const middleware = makeAuthMiddleware()
  const req = { headers: { authorization: `Bearer ${token}` } }
  const res = mockRes()
  const next = jest.fn()

  middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})
