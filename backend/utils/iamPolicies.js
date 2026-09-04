const IAM_POLICIES = {
  ADMIN: [
    {
      Effect: "Allow",
      Action: ["*"],
      Resource: ["*"]
    }
  ],
  OPERATOR: [
    {
      Effect: "Allow",
      Action: ["View", "Create", "Update", "Upload", "Start", "Export", "Approve"],
      Resource: [
        "dashboard:main",
        "initialization:header_mapping",
        "initialization:sales_data_clean",
        "initialization:combination",
        "initialization:connection",
        "configure:sap_setup",
        "configure:leo_copy_mail",
        "configure:icegate_cha",
        "configure:dgft_setup",
        "configure:automation",
        "configure:automation_logs",
        "process:leo_copy",
        "process:sales",
        "process:start_process",
        "process:manual_match",
        "process:matched_invoices",
        "cha:monthly_process",
        "shipping_bills:sb_records",
        "dgft:records",
        "dgft:ebrc_bulk_request",
        "dgft:store_bulk_download",
        "dgft:ebrc_pdfs",
        "jv:dbk",
        "jv:rodtp",
        "analytics:reports",
        "analytics:report_templates",
        "manual_fetch:sb_batch",
        "manual_fetch:dgft_batch_upload"
      ]
    },
    {
      Effect: "Deny",
      Action: ["Delete"],
      Resource: ["*"]
    },
    {
      Effect: "Deny",
      Action: ["*"],
      Resource: ["admin:users", "admin:roles", "admin:*"]
    }
  ],
  VIEWER: [
    {
      Effect: "Allow",
      Action: ["View"],
      Resource: ["*"]
    },
    {
      Effect: "Deny",
      Action: ["Create", "Update", "Delete", "Upload", "Start", "Export", "Approve"],
      Resource: ["*"]
    },
    {
      Effect: "Deny",
      Action: ["*"],
      Resource: ["admin:users", "admin:roles", "admin:*", "configure:*"]
    }
  ]
};

function getPoliciesForRole(roleStr) {
  // Map legacy string roles to the new IAM policy arrays
  const normalized = String(roleStr || '').toLowerCase().trim();
  if (normalized === 'admin') return IAM_POLICIES.ADMIN;
  if (normalized === 'operator') return IAM_POLICIES.OPERATOR;
  if (normalized === 'viewer') return IAM_POLICIES.VIEWER;
  return IAM_POLICIES.VIEWER; // Safest default fallback
}

module.exports = {
  IAM_POLICIES,
  getPoliciesForRole
};
