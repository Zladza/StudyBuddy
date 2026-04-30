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

test('buildMessages converts plain messages to Anthropic format', () => {
  const input = [
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  const result = buildMessages(input, null)
  expect(result).toEqual([
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ])
})

test('buildMessages wraps last user message with PDF document block', () => {
  const input = [
    { role: 'user', content: 'Sumiraj ovo' }
  ]
  const result = buildMessages(input, 'base64pdfdata==')
  expect(result[0].content[0]).toEqual({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'base64pdfdata==' }
  })
  expect(result[0].content[1].type).toBe('text')
  expect(result[0].content[1].text).toContain('Sumiraj ovo')
})

test('SYSTEM_PROMPT contains key StudyBuddy instructions', () => {
  expect(SYSTEM_PROMPT).toContain('StudyBuddy')
  expect(SYSTEM_PROMPT).toContain('seminarski')
  expect(SYSTEM_PROMPT).toContain('finalni tekst pišeš ti')
})
