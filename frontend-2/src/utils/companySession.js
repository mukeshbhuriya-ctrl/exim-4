const AUTH_KEY = 'company_authenticated'
const EMAIL_KEY = 'company_user_email'
const COMPANY_NAME_KEY = 'company_name'

export function saveCompanySession({ email, companyName } = {}) {
  localStorage.setItem(AUTH_KEY, 'true')
  if (email != null && String(email).trim()) {
    localStorage.setItem(EMAIL_KEY, String(email).trim())
  }
  if (companyName != null && String(companyName).trim()) {
    localStorage.setItem(COMPANY_NAME_KEY, String(companyName).trim())
  }
}

export function clearCompanySession() {
  localStorage.removeItem(AUTH_KEY)
  localStorage.removeItem(EMAIL_KEY)
  localStorage.removeItem(COMPANY_NAME_KEY)
}

export function getCompanySession() {
  return {
    authenticated: localStorage.getItem(AUTH_KEY) === 'true',
    email: localStorage.getItem(EMAIL_KEY) || '',
    companyName: localStorage.getItem(COMPANY_NAME_KEY) || '',
  }
}
