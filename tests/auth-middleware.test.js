const { makeAuthMiddleware } = require('../src/auth-middleware')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

test('returns 401 when Authorization header is missing', async () => {
  const middleware = makeAuthMiddleware({ auth: { getUser: jest.fn() } })
  const req = { headers: {} }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('returns 401 when token is invalid', async () => {
  const fakeClient = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: new Error('invalid') })
    }
  }
  const middleware = makeAuthMiddleware(fakeClient)
  const req = { headers: { authorization: 'Bearer bad-token' } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('calls next() and sets req.user when token is valid', async () => {
  const fakeUser = { id: 'user-123', email: 'ana@etf.rs' }
  const fakeClient = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: fakeUser }, error: null })
    }
  }
  const middleware = makeAuthMiddleware(fakeClient)
  const req = { headers: { authorization: 'Bearer valid-token' } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(next).toHaveBeenCalled()
  expect(req.user).toEqual(fakeUser)
  expect(req.token).toBe('valid-token')
})
