function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('sb-theme', theme)
  if (typeof updateThemeButtons === 'function') updateThemeButtons()
}

function getCurrentTheme() {
  return localStorage.getItem('sb-theme') || 'light'
}
