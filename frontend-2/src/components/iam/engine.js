export function evaluateAccess(policies, resource, action) {
  if (!policies || !Array.isArray(policies)) return false;

  let isAllowed = false;
  let isDenied = false;

  for (const statement of policies) {
    const actionMatches = statement.Action.some(a => 
      a === '*' || a.toLowerCase() === action.toLowerCase()
    );
    
    const resourceMatches = statement.Resource.some(r => {
      if (r === '*') return true;
      if (r.toLowerCase() === resource.toLowerCase()) return true;
      if (r.endsWith('*')) {
        const prefix = r.substring(0, r.length - 1).toLowerCase();
        return resource.toLowerCase().startsWith(prefix);
      }
      return false;
    });

    if (actionMatches && resourceMatches) {
      if (statement.Effect === 'Deny') {
        isDenied = true;
      } else if (statement.Effect === 'Allow') {
        isAllowed = true;
      }
    }
  }

  // Explicit Deny always overrides Allow
  if (isDenied) return false;
  return isAllowed;
}
