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
