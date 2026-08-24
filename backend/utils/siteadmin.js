const crypto = require("node:crypto");
const dns = require("node:dns");

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const DEFAULT_CONFIG = Object.freeze({
  mongoUri: "mongodb://127.0.0.1:27017/backend2",
  jwtSecret: "change-this-jwt-secret",
  jwtEncryptionKey: "change-this-encryption-key",
  jwtExpiresIn: "7d",
  jwtIssuer: "backend2",
  jwtAudience: "siteadmin",
  jwtAudienceCompany: "company_user",
  siteAdminName: "Site Admin",
  siteAdminEmail: "siteadmin@gmail.com",
  siteAdminPassword: "Admin@12345",
});

const siteAdminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

siteAdminSchema.methods.verifyPassword = function verifyPasswordFromDocument(password) {
  return verifyPassword(password, this.passwordHash);
};

const SiteAdmin =
  mongoose.models.SiteAdmin || mongoose.model("SiteAdmin", siteAdminSchema);

let connectionPromise;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || !passwordHash.includes(":")) {
    return false;
  }

  const [salt, storedHash] = passwordHash.split(":");

  if (!salt || !storedHash) {
    return false;
  }

  try {
    const incomingHash = crypto.scryptSync(password, salt, 64).toString("hex");
    const storedBuffer = Buffer.from(storedHash, "hex");
    const incomingBuffer = Buffer.from(incomingHash, "hex");

    if (storedBuffer.length !== incomingBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(storedBuffer, incomingBuffer);
  } catch (error) {
    return false;
  }
}

function configureDnsForMongoSrv() {
  const uri = String(process.env.MONGODB_URI || DEFAULT_CONFIG.mongoUri);
  if (!uri.startsWith("mongodb+srv://")) return;

  const custom = String(process.env.MONGODB_DNS_SERVERS || "").trim();
  dns.setServers(
    custom
      ? custom.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
      : ["8.8.8.8", "1.1.1.1"]
  );
}

/** Align with Atlas / Compass defaults (authSource, retryWrites). */
function normalizeAtlasMongoUri(uri) {
  const s = String(uri || "").trim();
  if (!s || !s.includes("mongodb")) return s || DEFAULT_CONFIG.mongoUri;

  const isAtlas = s.includes("mongodb.net");
  if (!isAtlas) return s;

  const sep = s.includes("?") ? "&" : "?";
  const parts = [];
  if (!/retryWrites=/i.test(s)) parts.push("retryWrites=true");
  if (!/w=majority/i.test(s)) parts.push("w=majority");
  if (!/authSource=/i.test(s)) parts.push("authSource=admin");
  if (!parts.length) return s;
  return `${s}${sep}${parts.join("&")}`;
}

function getMongoUri() {
  const direct = String(process.env.MONGODB_URI_DIRECT || "").trim();
  if (direct) return normalizeAtlasMongoUri(direct);
  return normalizeAtlasMongoUri(process.env.MONGODB_URI || DEFAULT_CONFIG.mongoUri);
}

function getMongoConnectOptions() {
  return {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_MS) || 15_000,
  };
}

function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_CONFIG.jwtSecret;
}

function getJwtEncryptionKey() {
  return process.env.JWT_ENCRYPTION_KEY || DEFAULT_CONFIG.jwtEncryptionKey;
}

function getJwtExpiresIn() {
  return process.env.JWT_EXPIRES_IN || DEFAULT_CONFIG.jwtExpiresIn;
}

function getJwtIssuer() {
  return process.env.JWT_ISSUER || DEFAULT_CONFIG.jwtIssuer;
}

function getJwtAudience() {
  return process.env.JWT_AUDIENCE || DEFAULT_CONFIG.jwtAudience;
}

function getCompanyJwtAudience() {
  return process.env.COMPANY_JWT_AUDIENCE || DEFAULT_CONFIG.jwtAudienceCompany;
}

function getSiteAdminCookieName() {
  return process.env.SITEADMIN_COOKIE_NAME || "siteadmin_token";
}

function getSiteAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true",
    sameSite: process.env.COOKIE_SAME_SITE || "lax",
    maxAge:
      Number.parseInt(process.env.COOKIE_MAX_AGE_MS, 10) ||
      7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

function parseCookieHeader(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();

      if (!key) {
        return cookies;
      }

      cookies[key] = decodeURIComponent(value);

      return cookies;
    }, {});
}

function getSiteAdminTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme === "Bearer" && token) {
    return token;
  }

  const cookies = parseCookieHeader(req.headers.cookie);

  return cookies[getSiteAdminCookieName()] || "";
}

function setSiteAdminAuthCookie(res, token) {
  res.cookie(getSiteAdminCookieName(), token, getSiteAdminCookieOptions());
}

function clearSiteAdminAuthCookie(res) {
  const { httpOnly, secure, sameSite, path } = getSiteAdminCookieOptions();

  res.clearCookie(getSiteAdminCookieName(), {
    httpOnly,
    secure,
    sameSite,
    path,
  });
}

function getCompanyUserCookieName() {
  return process.env.COMPANY_COOKIE_NAME || "token";
}

function getCompanyUserTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme === "Bearer" && token) {
    return token;
  }

  const cookies = parseCookieHeader(req.headers.cookie);

  return cookies[getCompanyUserCookieName()] || "";
}

function setCompanyUserAuthCookie(res, token) {
  res.cookie(getCompanyUserCookieName(), token, getSiteAdminCookieOptions());
}

function clearCompanyUserAuthCookie(res) {
  const { httpOnly, secure, sameSite, path } = getSiteAdminCookieOptions();

  res.clearCookie(getCompanyUserCookieName(), {
    httpOnly,
    secure,
    sameSite,
    path,
  });
}

function getEncryptionKeyBuffer() {
  return crypto
    .createHash("sha256")
    .update(String(getJwtEncryptionKey()))
    .digest();
}

function encryptJwt(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    getEncryptionKeyBuffer(),
    iv
  );
  const encryptedBuffer = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    encryptedBuffer.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

function decryptJwt(encryptedToken) {
  const [ivPart, payloadPart, tagPart] = String(encryptedToken || "").split(".");

  if (!ivPart || !payloadPart || !tagPart) {
    throw new Error("Encrypted JWT format is invalid.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKeyBuffer(),
    Buffer.from(ivPart, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const decryptedBuffer = Buffer.concat([
    decipher.update(Buffer.from(payloadPart, "base64url")),
    decipher.final(),
  ]);

  return decryptedBuffer.toString("utf8");
}

function getSeedSiteAdminConfig() {
  return {
    name: (process.env.SITEADMIN_NAME || DEFAULT_CONFIG.siteAdminName).trim(),
    email: normalizeEmail(
      process.env.SITEADMIN_EMAIL || DEFAULT_CONFIG.siteAdminEmail
    ),
    password: process.env.SITEADMIN_PASSWORD || DEFAULT_CONFIG.siteAdminPassword,
  };
}

function sanitizeSiteAdmin(siteAdmin) {
  return {
    id: siteAdmin._id.toString(),
    name: siteAdmin.name,
    email: siteAdmin.email,
    isActive: siteAdmin.isActive,
    lastLoginAt: siteAdmin.lastLoginAt,
    createdAt: siteAdmin.createdAt,
    updatedAt: siteAdmin.updatedAt,
  };
}

function signSiteAdminToken(siteAdmin) {
  const signedJwt = jwt.sign(
    {
      sub: siteAdmin._id.toString(),
      role: "siteadmin",
      email: siteAdmin.email,
    },
    getJwtSecret(),
    {
      expiresIn: getJwtExpiresIn(),
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
    }
  );

  return encryptJwt(signedJwt);
}

function verifySiteAdminToken(token) {
  const decryptedToken = decryptJwt(token);

  return jwt.verify(decryptedToken, getJwtSecret(), {
    issuer: getJwtIssuer(),
    audience: getJwtAudience(),
  });
}

function signCompanyUserToken(user) {
  const companyId =
    user.companyId && user.companyId.toString
      ? user.companyId.toString()
      : String(user.companyId || "");

  const signedJwt = jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
      companyId,
    },
    getJwtSecret(),
    {
      expiresIn: getJwtExpiresIn(),
      issuer: getJwtIssuer(),
      audience: getCompanyJwtAudience(),
    }
  );

  return encryptJwt(signedJwt);
}

function verifyCompanyUserToken(token) {
  const decryptedToken = decryptJwt(token);

  return jwt.verify(decryptedToken, getJwtSecret(), {
    issuer: getJwtIssuer(),
    audience: getCompanyJwtAudience(),
  });
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  configureDnsForMongoSrv();

  if (!connectionPromise) {
    const uri = getMongoUri();
    connectionPromise = mongoose
      .connect(uri, getMongoConnectOptions())
      .catch((error) => {
        connectionPromise = undefined;
        const hint =
          String(uri).startsWith("mongodb+srv://") && error?.message?.includes("querySrv")
            ? " Tip: set MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 or paste Compass connection string into MONGODB_URI_DIRECT (non-SRV)."
            : error?.message?.includes("whitelist") || error?.name === "MongooseServerSelectionError"
              ? " Tip: Atlas Network Access must include your IP (0.0.0.0/0 for dev). Use the same connection string as Compass in MONGODB_URI or MONGODB_URI_DIRECT."
              : "";
        const wrapped = new Error(`${error?.message || error}${hint}`);
        wrapped.cause = error;
        throw wrapped;
      });
  }

  await connectionPromise;

  return mongoose.connection;
}

async function ensureDefaultSiteAdmin() {
  const seedConfig = getSeedSiteAdminConfig();

  if (!seedConfig.email || !seedConfig.password) {
    throw new Error(
      "SITEADMIN_EMAIL and SITEADMIN_PASSWORD must be set before seeding the siteadmin user."
    );
  }

  const existingSiteAdmin = await SiteAdmin.findOne({ email: seedConfig.email });

  if (existingSiteAdmin) {
    return {
      created: false,
      email: existingSiteAdmin.email,
    };
  }

  const createdSiteAdmin = await SiteAdmin.create({
    name: seedConfig.name,
    email: seedConfig.email,
    passwordHash: hashPassword(seedConfig.password),
  });

  return {
    created: true,
    email: createdSiteAdmin.email,
  };
}

async function requireSiteAdminAuth(req, res, next) {
  const token = getSiteAdminTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authorization token is required.",
    });
  }

  try {
    const decoded = verifySiteAdminToken(token);

    if (decoded.role !== "siteadmin") {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization token.",
      });
    }

    const siteAdmin = await SiteAdmin.findById(decoded.sub);

    if (!siteAdmin || !siteAdmin.isActive) {
      return res.status(401).json({
        success: false,
        message: "Siteadmin account is not available.",
      });
    }

    req.siteAdmin = siteAdmin;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token is invalid or expired.",
    });
  }
}

module.exports = {
  SiteAdmin,
  clearCompanyUserAuthCookie,
  clearSiteAdminAuthCookie,
  connectDatabase,
  ensureDefaultSiteAdmin,
  getCompanyUserCookieName,
  getCompanyUserTokenFromRequest,
  getCompanyJwtAudience,
  getSeedSiteAdminConfig,
  getSiteAdminCookieName,
  getSiteAdminTokenFromRequest,
  hashPassword,
  normalizeEmail,
  requireSiteAdminAuth,
  sanitizeSiteAdmin,
  setCompanyUserAuthCookie,
  setSiteAdminAuthCookie,
  signCompanyUserToken,
  signSiteAdminToken,
  verifyCompanyUserToken,
  verifySiteAdminToken,
  verifyPassword,
};
