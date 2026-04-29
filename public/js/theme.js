const COLOR_PALETTES = {
  navy:   { ac: '#1F4E79', hover: '#1a4268' },
  forest: { ac: '#166534', hover: '#14532d' },
  violet: { ac: '#5B21B6', hover: '#4c1d95' },
  slate:  { ac: '#334155', hover: '#1e293b' },
  rose:   { ac: '#9F1239', hover: '#881337' },
}

function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('sb-theme', theme)
  const light = document.getElementById('hljs-light')
  const dark = document.getElementById('hljs-dark')
  if (light && dark) { light.disabled = theme === 'dark'; dark.disabled = theme !== 'dark' }
  if (typeof updateThemeButtons === 'function') updateThemeButtons()
}

function getCurrentTheme() {
  return localStorage.getItem('sb-theme') || 'light'
}

function setColorTheme(color) {
  localStorage.setItem('sb-color', color)
  if (color === 'navy') {
    document.documentElement.removeAttribute('data-color')
  } else {
    document.documentElement.dataset.color = color
  }
  if (typeof updateColorSwatches === 'function') updateColorSwatches()
}

function getCurrentColorTheme() {
  return localStorage.getItem('sb-color') || 'navy'
}

function getAccentColor() {
  const palette = COLOR_PALETTES[getCurrentColorTheme()] || COLOR_PALETTES.navy
  return palette.ac
}

function getAccentHover() {
  const palette = COLOR_PALETTES[getCurrentColorTheme()] || COLOR_PALETTES.navy
  return palette.hover
}
