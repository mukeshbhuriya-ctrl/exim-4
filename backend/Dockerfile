# Backend API (+ in-process automation cron via server.js)
FROM node:20-bookworm-slim

WORKDIR /app

# tzdata is required so AUTOMATION_CRON_TZ / TZ (e.g. Asia/Kolkata) resolve correctly.
# Chromium deps are optional; Selenium Grid runs in a separate compose stack.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code + .env (dotenv loads /app/.env at runtime — do not override secrets with ENV here).
COPY . .
COPY .env .env

ENV NODE_ENV=production
ENV PORT=5000
# Default container timezone (override with AUTOMATION_CRON_TZ / TZ in compose or .env)
ENV TZ=Asia/Kolkata

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# `npm start` → server.js → startAutomationCron() when AUTOMATION_CRON_ENABLED=true
CMD ["npm", "start"]
