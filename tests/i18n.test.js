const I18N = require('../public/js/i18n.js')

test('Serbian strings are defined', () => {
  expect(I18N.sr.newChat).toBe('Novi razgovor')
  expect(I18N.sr.disclaimer).toBe('Ne pišem gotove ispite ni seminarske radove.')
  expect(I18N.sr.networkError).toBe('Nema konekcije. Proveri internet vezu i pokušaj ponovo.')
  expect(I18N.sr.tplExplain).toBe('Objasni mi ___ jednostavnim rečima.')
})

test('English strings are defined', () => {
  expect(I18N.en.newChat).toBe('New conversation')
  expect(I18N.en.disclaimer).toBe("I don't write finished exams or essays.")
  expect(I18N.en.tplExplain).toBe('Explain ___ in simple terms.')
})

test('Both languages have the same keys', () => {
  const srKeys = Object.keys(I18N.sr).sort()
  const enKeys = Object.keys(I18N.en).sort()
  expect(srKeys).toEqual(enKeys)
})
