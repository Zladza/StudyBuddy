const { validateRequest, buildMessages, SYSTEM_PROMPT } = require('../src/chat-handler')

test('validateRequest returns error for missing messages', () => {
  expect(validateRequest({ language: 'sr' })).toBe('Messages must be an array.')
})

test('validateRequest returns error for invalid language', () => {
  expect(validateRequest({ messages: [], language: 'de' })).toBe('Language must be sr or en.')
})

test('validateRequest returns null for valid input', () => {
  expect(validateRequest({ messages: [], language: 'sr' })).toBeNull()
  expect(validateRequest({ messages: [], language: 'en' })).toBeNull()
})

test('buildMessages returns plain messages when no files', () => {
  const input = [
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  expect(buildMessages(input, [])).toEqual([
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ])
})

test('buildMessages defaults to empty files when omitted', () => {
  const input = [{ role: 'user', content: 'test' }]
  expect(buildMessages(input)).toEqual([{ role: 'user', content: 'test' }])
})

test('buildMessages wraps last user message with PDF document block', () => {
  const input = [{ role: 'user', content: 'Sumiraj ovo' }]
  const result = buildMessages(input, [{ base64: 'base64pdfdata==', mediaType: 'application/pdf', name: 'test.pdf' }])
  expect(result[0].content[0]).toEqual({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'base64pdfdata==' }
  })
  expect(result[0].content[1].type).toBe('text')
  expect(result[0].content[1].text).toContain('Sumiraj ovo')
})

test('buildMessages wraps last user message with image block', () => {
  const input = [{ role: 'user', content: 'Šta je ovo?' }]
  const result = buildMessages(input, [{ base64: 'imgdata==', mediaType: 'image/jpeg', name: 'foto.jpg' }])
  expect(result[0].content[0]).toEqual({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'imgdata==' }
  })
  expect(result[0].content[1].type).toBe('text')
  expect(result[0].content[1].text).toContain('Šta je ovo?')
})

test('buildMessages handles multiple files in order', () => {
  const input = [{ role: 'user', content: 'Analiziraj' }]
  const result = buildMessages(input, [
    { base64: 'pdfdata==', mediaType: 'application/pdf', name: 'doc.pdf' },
    { base64: 'imgdata==', mediaType: 'image/png', name: 'fig.png' }
  ])
  expect(result[0].content[0].type).toBe('document')
  expect(result[0].content[1].type).toBe('image')
  expect(result[0].content[2].type).toBe('text')
})

test('buildMessages uses PDF hint when any file is a PDF', () => {
  const input = [{ role: 'user', content: 'Pregled' }]
  const result = buildMessages(input, [{ base64: 'pdf==', mediaType: 'application/pdf', name: 'doc.pdf' }])
  const text = result[0].content.find(p => p.type === 'text').text
  expect(text).toContain('document has been uploaded')
})

test('buildMessages uses image hint when all files are images', () => {
  const input = [{ role: 'user', content: 'Pregled' }]
  const result = buildMessages(input, [{ base64: 'img==', mediaType: 'image/jpeg', name: 'foto.jpg' }])
  const text = result[0].content.find(p => p.type === 'text').text
  expect(text).toContain('image has been uploaded')
})

test('buildMessages fills empty content with placeholder in clean map', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildMessages(input, [])
  expect(result[0].content).toBe('[Priložen fajl]')
})

test('buildMessages uses fallback text when content empty and files present', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildMessages(input, [{ base64: 'pdf==', mediaType: 'application/pdf', name: 'doc.pdf' }])
  const textBlock = result[0].content.find(p => p.type === 'text')
  expect(textBlock.text).toContain('Analiziraj priloženi materijal.')
})

test('SYSTEM_PROMPT contains key StudyBuddy instructions', () => {
  expect(SYSTEM_PROMPT).toContain('StudyBuddy')
  expect(SYSTEM_PROMPT).toContain('seminarski')
  expect(SYSTEM_PROMPT).toContain('finalni tekst pišeš ti')
})
