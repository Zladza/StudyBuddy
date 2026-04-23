const { makeHistoryHandler } = require('../src/history-handler')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function makeChain(result) {
  const chain = {}
  const methods = ['from', 'select', 'eq', 'order', 'insert', 'update', 'single']
  methods.forEach(m => { chain[m] = jest.fn().mockReturnValue(chain) })
  chain.single = jest.fn().mockResolvedValue(result)
  // Make the last method in a chain resolve
  chain.order = jest.fn().mockResolvedValue(result)
  chain.eq = jest.fn().mockReturnValue(chain)
  return chain
}

test('listConversations returns conversations array', async () => {
  const fakeConvs = [{ id: 'c1', title: 'Test', language: 'sr', updated_at: '2026-01-01' }]
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: fakeConvs, error: null })
  }
  const fakeClient = chain
  const handler = makeHistoryHandler(fakeClient)

  const req = { user: { id: 'user-123' } }
  const res = mockRes()

  await handler.listConversations(req, res)

  expect(res.json).toHaveBeenCalledWith(fakeConvs)
})

test('listConversations returns 500 on database error', async () => {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: null, error: new Error('db error') })
  }
  const handler = makeHistoryHandler(chain)
  const req = { user: { id: 'user-123' } }
  const res = mockRes()

  await handler.listConversations(req, res)

  expect(res.status).toHaveBeenCalledWith(500)
})

test('saveExchange creates new conversation and saves messages', async () => {
  const insertSpy = jest.fn()
    .mockReturnValueOnce({ select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'new-conv-id' }, error: null }) })
    .mockReturnValueOnce({ then: jest.fn(), ...Promise.resolve({ data: null, error: null }) })

  let insertCallCount = 0
  const fakeClient = {
    from: jest.fn().mockReturnThis(),
    insert: jest.fn().mockImplementation(() => {
      insertCallCount++
      if (insertCallCount === 1) {
        return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'new-conv-id' }, error: null }) }
      }
      return Promise.resolve({ data: null, error: null })
    }),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  }

  const handler = makeHistoryHandler(fakeClient)
  const req = {
    user: { id: 'user-123' },
    body: {
      language: 'sr',
      messages: [
        { role: 'user', content: 'Objasni mi Thevenina', has_pdf: false },
        { role: 'assistant', content: 'Theveninova teorema...', has_pdf: false }
      ]
    }
  }
  const res = mockRes()

  await handler.saveExchange(req, res)

  expect(res.json).toHaveBeenCalledWith({ conversationId: 'new-conv-id' })
})
