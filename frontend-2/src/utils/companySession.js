const AUTH_KEY = 'company_authenticated'
const EMAIL_KEY = 'company_user_email'
const COMPANY_NAME_KEY = 'company_name'

export function saveCompanySession({ email, companyName, iamPolicies } = {}) {
  localStorage.setItem(AUTH_KEY, 'true')
  if (email != null && String(email).trim()) {
    localStorage.setItem(EMAIL_KEY, String(email).trim())
  }
  if (companyName != null && String(companyName).trim()) {
    localStorage.setItem(COMPANY_NAME_KEY, String(companyName).trim())
  }
  if (iamPolicies) {
    localStorage.setItem('company_iam_policies', JSON.stringify(iamPolicies))
  }
}

export function clearCompanySession() {
  localStorage.removeItem(AUTH_KEY)
  localStorage.removeItem(EMAIL_KEY)
  localStorage.removeItem(COMPANY_NAME_KEY)
  localStorage.removeItem('company_iam_policies')
}

export function getCompanySession() {
  let iamPolicies = []
  try {
    const stored = localStorage.getItem('company_iam_policies')
    if (stored) iamPolicies = JSON.parse(stored)
  } catch (e) {
    // skip
  }

  return {
    authenticated: localStorage.getItem(AUTH_KEY) === 'true',
    email: localStorage.getItem(EMAIL_KEY) || '',
    companyName: localStorage.getItem(COMPANY_NAME_KEY) || '',
    iamPolicies,
  }
}
