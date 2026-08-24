const crypto = require("node:crypto");

/**
 * Hash for company users (`user` collection). Same format as legacy shared helper:
 * `saltHex:scryptKeyHex` (64-byte key, scrypt defaults).
 */
function hashCompanyUserPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto
    .scryptSync(String(password ?? ""), salt, 64)
    .toString("hex");

  return `${salt}:${derivedKey}`;
}

module.exports = {
  hashCompanyUserPassword,
};
