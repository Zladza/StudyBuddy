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
