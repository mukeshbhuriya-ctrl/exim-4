const DEFAULT_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const DEFAULT_HEADERS = "Content-Type,Authorization";

function getAllowedOrigin(origin) {
  const allowedOrigins = String(process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowedOrigins.includes("*")) {
    // If the frontend sends credentials, browsers won't accept `Access-Control-Allow-Origin: *`.
    // Echo back the request origin when available.
    return origin || "*";
  }

  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }

  return allowedOrigins[0] || "*";
}

function corsMiddleware(req, res, next) {
  const requestOrigin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(requestOrigin);

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");

  if (allowedOrigin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    process.env.CORS_METHODS || DEFAULT_METHODS
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    // Prefer preflight requested headers when present.
    req.headers["access-control-request-headers"] ||
      process.env.CORS_HEADERS ||
      DEFAULT_HEADERS
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
}

module.exports = corsMiddleware;
