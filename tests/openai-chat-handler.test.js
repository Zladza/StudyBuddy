const { buildOpenAIMessages } = require('../src/openai-chat-handler')

test('buildOpenAIMessages returns plain messages when no files', () => {
  const input = [
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  expect(buildOpenAIMessages(input, [])).toEqual([
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ])
})

test('buildOpenAIMessages defaults to empty files when omitted', () => {
  const input = [{ role: 'user', content: 'test' }]
  expect(buildOpenAIMessages(input)).toEqual([{ role: 'user', content: 'test' }])
})

test('buildOpenAIMessages fills empty content with sr placeholder', () => {
  const input = [{ role: 'user', content: '' }]
  expect(buildOpenAIMessages(input, [], 'sr')[0].content).toBe('[Priložen fajl]')
})

test('buildOpenAIMessages fills empty content with en placeholder', () => {
  const input = [{ role: 'user', content: '' }]
  expect(buildOpenAIMessages(input, [], 'en')[0].content).toBe('[Attached file]')
})

test('buildOpenAIMessages wraps last user message with image_url block', () => {
  const input = [{ role: 'user', content: 'Šta je ovo?' }]
  const result = buildOpenAIMessages(input, [{ base64: 'imgdata==', mediaType: 'image/jpeg', name: 'foto.jpg' }])
  expect(result[0].content[0]).toEqual({ type: 'text', text: expect.stringContaining('Šta je ovo?') })
  expect(result[0].content[1]).toEqual({
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,imgdata==' }
  })
})

test('buildOpenAIMessages uses sr fallback when content empty and files present', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildOpenAIMessages(input, [{ base64: 'img==', mediaType: 'image/png', name: 'f.png' }], 'sr')
  expect(result[0].content[0].text).toContain('Analiziraj priloženi materijal.')
})

test('buildOpenAIMessages uses en fallback when content empty and files present', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildOpenAIMessages(input, [{ base64: 'img==', mediaType: 'image/png', name: 'f.png' }], 'en')
  expect(result[0].content[0].text).toContain('Analyze the attached material.')
})

test('buildOpenAIMessages only wraps last user message', () => {
  const input = [
    { role: 'user', content: 'First message' },
    { role: 'assistant', content: 'Reply' },
    { role: 'user', content: 'Second message' }
  ]
  const result = buildOpenAIMessages(input, [{ base64: 'img==', mediaType: 'image/jpeg', name: 'f.jpg' }])
  expect(typeof result[0].content).toBe('string')
  expect(Array.isArray(result[2].content)).toBe(true)
})

test('handleChat streams text chunks and ends with done', async () => {
  const { handleChat } = require('../src/openai-chat-handler')

  const chunks = [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' world' } }] },
    { choices: [{ delta: {} }] }
  ]

  const mockStream = {
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c }
  }

  const mockClient = {
    chat: { completions: { stream: jest.fn().mockResolvedValue(mockStream) } }
  }

  const written = []
  const req = { body: { messages: [{ role: 'user', content: 'Hi' }], language: 'sr', files: [] } }
  const res = {
    setHeader: jest.fn(),
    write: jest.fn(d => written.push(d)),
    end: jest.fn(),
    headersSent: false
  }

  await handleChat(req, res, mockClient)

  expect(written.some(d => d.includes('"type":"text"'))).toBe(true)
  expect(written.some(d => d.includes('"type":"done"'))).toBe(true)
  expect(res.end).toHaveBeenCalled()
})
