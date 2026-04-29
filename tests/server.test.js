const request = require('supertest')

// Load env before requiring server
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'
process.env.ANTHROPIC_API_KEY = 'test-api-key'

const app = require('../server')

test('GET /api/health returns 200 with status ok', async () => {
  const res = await request(app).get('/api/health')
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ status: 'ok' })
})

test('GET /api/config returns supabaseUrl and supabaseAnonKey', async () => {
  const res = await request(app).get('/api/config')
  expect(res.status).toBe(200)
  expect(res.body).toEqual({
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon-key'
  })
})

test('GET /nonexistent returns 404', async () => {
  const res = await request(app).get('/nonexistent-route-xyz')
  expect(res.status).toBe(404)
})

test('GET /api/history returns 401 without token', async () => {
  const res = await request(app).get('/api/history')
  expect(res.status).toBe(401)
})

test('POST /api/history returns 401 without token', async () => {
  const res = await request(app).post('/api/history').send({})
  expect(res.status).toBe(401)
})

test('GET /api/history/some-id returns 401 without token', async () => {
  const res = await request(app).get('/api/history/some-id')
  expect(res.status).toBe(401)
})

test('POST /api/chat returns 401 without token', async () => {
  const res = await request(app)
    .post('/api/chat')
    .send({ messages: [], language: 'sr' })
  expect(res.status).toBe(401)
})
