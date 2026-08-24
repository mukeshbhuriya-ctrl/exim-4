export function eraseCookie(name) {
  if (typeof document === 'undefined') return

  // Best-effort client-side cookie deletion.
  // Note: if the cookie is HttpOnly, JS cannot delete it; backend logout must handle it.
  // We try a couple of SameSite variants because deletion must match cookie attributes.
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Strict`
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=None; Secure`
}

export function eraseCookies(names) {
  for (const name of names) eraseCookie(name)
}

