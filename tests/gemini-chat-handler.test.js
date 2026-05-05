const { buildGeminiHistory, buildGeminiParts } = require('../src/gemini-chat-handler')

test('buildGeminiHistory converts messages to gemini format', () => {
  const input = [
    { role: 'user', content: 'Objasni Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  expect(buildGeminiHistory(input)).toEqual([
    { role: 'user', parts: [{ text: 'Objasni Thevenina' }] },
    { role: 'model', parts: [{ text: 'Theveninova teorema...' }] }
  ])
})

test('buildGeminiHistory uses sr placeholder for empty content', () => {
  const input = [{ role: 'user', content: '' }]
  expect(buildGeminiHistory(input, 'sr')[0].parts[0].text).toBe('[Priložen fajl]')
})

test('buildGeminiHistory uses en placeholder for empty content', () => {
  const input = [{ role: 'user', content: '' }]
  expect(buildGeminiHistory(input, 'en')[0].parts[0].text).toBe('[Attached file]')
})

test('buildGeminiParts returns text-only parts when no files', () => {
  const msg = { role: 'user', content: 'Šta je integral?' }
  expect(buildGeminiParts(msg, [], 'sr')).toEqual([{ text: 'Šta je integral?' }])
})

test('buildGeminiParts includes inlineData for files', () => {
  const msg = { role: 'user', content: 'Šta je ovo?' }
  const files = [{ base64: 'imgdata==', mediaType: 'image/jpeg', name: 'f.jpg' }]
  const parts = buildGeminiParts(msg, files, 'sr')
  expect(parts[0].text).toContain('Šta je ovo?')
  expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'imgdata==' } })
})

test('buildGeminiParts uses sr fallback when content short and files present', () => {
  const msg = { role: 'user', content: '' }
  const files = [{ base64: 'img==', mediaType: 'image/png', name: 'f.png' }]
  const parts = buildGeminiParts(msg, files, 'sr')
  expect(parts[0].text).toContain('Analiziraj priloženi materijal.')
})

test('buildGeminiParts uses en fallback when content short and files present', () => {
  const msg = { role: 'user', content: '' }
  const files = [{ base64: 'img==', mediaType: 'image/png', name: 'f.png' }]
  const parts = buildGeminiParts(msg, files, 'en')
  expect(parts[0].text).toContain('Analyze the attached material.')
})

test('handleChat streams text chunks and ends with done', async () => {
  const { handleChat } = require('../src/gemini-chat-handler')

  const chunks = [
    { text: () => 'Hello' },
    { text: () => ' world' },
    { text: () => '' }
  ]

  const mockStream = {
    stream: (async function* () { for (const c of chunks) yield c })()
  }

  const mockChat = {
    sendMessageStream: jest.fn().mockResolvedValue(mockStream)
  }

  const mockModel = {
    startChat: jest.fn().mockReturnValue(mockChat)
  }

  const mockGenAI = {
    getGenerativeModel: jest.fn().mockReturnValue(mockModel)
  }

  const written = []
  const req = { body: { messages: [{ role: 'user', content: 'Hi' }], language: 'sr', files: [] } }
  const res = {
    setHeader: jest.fn(),
    write: jest.fn(d => written.push(d)),
    end: jest.fn(),
    headersSent: false
  }

  await handleChat(req, res, mockGenAI)

  expect(written.some(d => d.includes('"type":"text"'))).toBe(true)
  expect(written.some(d => d.includes('"type":"done"'))).toBe(true)
  expect(res.end).toHaveBeenCalled()
})
