import React from 'react';
import { getCompanySession } from '@/utils/companySession';
import { evaluateAccess } from './engine';

/**
 * AccessControl component evaluates the current user's IAM policies against a required action.
 * Usage:
 * <AccessControl required="process:sales:Create">
 *   <Button>Upload Sales</Button>
 * </AccessControl>
 */
export function AccessControl({ required, children, fallback = null }) {
  const { iamPolicies } = getCompanySession();
  
  if (!required) return <>{children}</>;

  const lastColonIdx = required.lastIndexOf(':');
  let resource = required;
  let action = 'View'; // Default action if none specified

  if (lastColonIdx !== -1) {
    resource = required.substring(0, lastColonIdx);
    action = required.substring(lastColonIdx + 1);
  }

  const hasAccess = evaluateAccess(iamPolicies, resource, action);

  if (hasAccess) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : null;
}
