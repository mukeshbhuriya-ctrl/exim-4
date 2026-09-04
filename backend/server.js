require("dotenv").config({ quiet: true });

/** Node on Windows often cannot query Atlas SRV via ISP DNS; Compass may still work. */
const dns = require("node:dns");
const mongoUriBoot = String(process.env.MONGODB_URI || "");
if (mongoUriBoot.startsWith("mongodb+srv://")) {
  const custom = String(process.env.MONGODB_DNS_SERVERS || "").trim();
  dns.setServers(
    custom
      ? custom.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
      : ["8.8.8.8", "1.1.1.1"]
  );
}

const express = require("express");

const companyAdminCombinationRoutes = require("#routes/company/admin/combination.routes");
const companyAdminConnectionRoutes = require("#routes/company/admin/connection.routes");
const companyAdminHeaderMappingRoutes = require("#routes/company/admin/headermapping.routes");
const companyAdminProcessRoutes = require("#routes/company/admin/process/process.routes");
const companyAdminPdfRoutes = require("#routes/company/admin/process/pdf.routes");
const companyAdminSalesRoutes = require("#routes/company/admin/process/sales.routes");
const companyAuthRoutes = require("#routes/company/auth.routes");
const siteAdminAuthRoutes = require("#routes/siteadmin/auth.routes");
const siteAdminCompanyRoutes = require("#routes/siteadmin/company.routes");
const siteAdminBillingRoutes = require("#routes/siteadmin/billing.routes");
const companyAdminSbRoutes = require("#routes/company/admin/sb.routes");
const companyAdminReportRoutes = require("#routes/company/admin/report.routes");
const companyAdminDgftRoutes = require("#routes/company/admin/djft.routes");
const companyAdminJvRoutes = require("#routes/company/admin/jv.routes");
const companyAdminChaRoutes = require("#routes/company/admin/cha.routes");
const companyAdminInvRoutes = require("#routes/company/admin/inv_data.routes");
const companyAdminPdfListRoutes = require("#routes/company/admin/pdf.routes");
const companyAdminEBrcRoutes = require("#routes/company/admin/eBRC_Bulk_Download.routes");
const companyAdminConfigurePdfRoutes = require("#routes/company/admin/configure/pdf.routes");
const companyAdminConfigureDgftRoutes = require("#routes/company/admin/configure/dgft.routes");
const companyAdminConfigureChaRoutes = require("#routes/company/admin/configure/cha.routes");
const companyAdminConfigureSalesRoutes = require("#routes/company/admin/configure/sales.routes");
const companyAdminConfigureAutomationRoutes = require("#routes/company/admin/configure/automation.routes");
const companyAdminDashboardRoutes = require("#routes/company/admin/dashboard.routes");
const companyAdminSalesDataCleanRoutes = require("#routes/company/admin/Initialization/sales_data_clean.routes");
const companyAdminRolesRoutes = require("#routes/company/admin/roles.routes");
const companyAdminUsersRoutes = require("#routes/company/admin/users.routes");


const corsMiddleware = require("#utils/cors");
const { ensureGmailOAuthLocalServer } = require("#fetch_utils/gmail");
const { migrateAndDropLegacyCredentialCollections } = require("#utils/configure");
const {
  connectDatabase,  
  ensureDefaultSiteAdmin,
  getSeedSiteAdminConfig,
} = require("#utils/siteadmin");
const { seedSystemRoles } = require("#utils/roleSeeder");

const app = express();
const port = Number(process.env.PORT) || 5000;
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "10mb").trim() || "10mb";

app.disable("x-powered-by");
app.use(corsMiddleware);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Siteadmin auth backend is running.",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "OK",
  });
});

app.use("/api/siteadmin/auth", siteAdminAuthRoutes);
app.use("/api/siteadmin/company", siteAdminCompanyRoutes);
app.use("/api/siteadmin/billing", siteAdminBillingRoutes);


app.use("/api/company/auth", companyAuthRoutes);
app.use("/api/company/admin/header-mapping", companyAdminHeaderMappingRoutes);
app.use("/api/company/admin/combination", companyAdminCombinationRoutes);
app.use("/api/company/admin/connection", companyAdminConnectionRoutes);
app.use("/api/company/admin/process", companyAdminProcessRoutes);
app.use("/api/company/admin/process/pdf", companyAdminPdfRoutes);
app.use("/api/company/admin/process/sales", companyAdminSalesRoutes);
app.use("/api/company/admin/sb", companyAdminSbRoutes);
app.use("/api/company/admin/report", companyAdminReportRoutes);
app.use("/api/company/admin/dgft", companyAdminDgftRoutes);
app.use("/api/company/admin/jv", companyAdminJvRoutes);
app.use("/api/company/admin/cha", companyAdminChaRoutes);
app.use("/api/company/admin/inv", companyAdminInvRoutes);
app.use("/api/company/admin/pdf", companyAdminPdfListRoutes);
app.use("/api/company/admin/ebrc", companyAdminEBrcRoutes);
app.use("/api/company/admin/configure/pdf", companyAdminConfigurePdfRoutes);
app.use("/api/company/admin/configure/dgft", companyAdminConfigureDgftRoutes);
app.use("/api/company/admin/configure/cha", companyAdminConfigureChaRoutes);
app.use("/api/company/admin/configure/sales", companyAdminConfigureSalesRoutes);
app.use("/api/company/admin/configure/automation", companyAdminConfigureAutomationRoutes);
app.use("/api/company/admin/dashboard", companyAdminDashboardRoutes);
app.use(
  "/api/company/admin/initialization/sales-data-clean",
  companyAdminSalesDataCleanRoutes
);
app.use("/api/company/admin/roles", companyAdminRolesRoutes);
app.use("/api/company/admin/users", companyAdminUsersRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: `Request body too large. Maximum allowed size is ${JSON_BODY_LIMIT}.`,
      limit: JSON_BODY_LIMIT,
      length: error.length,
    });
  }

  console.error("Unhandled error:", error);

  res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

async function startServer() {
  await connectDatabase();
  await migrateAndDropLegacyCredentialCollections();
  const seededSiteAdmin = await ensureDefaultSiteAdmin();
  const seedConfig = getSeedSiteAdminConfig();
  
  // Seed Roles for all existing companies
  await seedSystemRoles();

  const server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log("Siteadmin auth route: POST /api/siteadmin/auth/login");
    console.log("Siteadmin company routes: GET/POST /api/siteadmin/company");
    console.log(
      "Company auth routes: POST /api/company/auth/login, POST /api/company/auth/default-password-change"
    );
    console.log(
      "Company admin header-mapping: GET/POST /api/company/admin/header-mapping"
    );
    console.log("Company admin combination: GET/POST /api/company/admin/combination");
    console.log("Company admin connection: GET/POST /api/company/admin/connection");
    console.log("Company admin process: POST /api/company/admin/process/upload");
  });
  const httpServerTimeoutMs = Number.parseInt(
    process.env.HTTP_SERVER_TIMEOUT_MS || String(2 * 60 * 60 * 1000),
    10
  );
  server.setTimeout(
    Number.isFinite(httpServerTimeoutMs) && httpServerTimeoutMs > 0
      ? httpServerTimeoutMs
      : 2 * 60 * 60 * 1000
  );

  ensureGmailOAuthLocalServer(undefined).catch((error) => {
    console.warn(
      "Gmail OAuth local callback not started:",
      error instanceof Error ? error.message : String(error)
    );
  });

  // Start automation crontab scheduler in-process (reads AUTOMATION_CRON* from .env).
  try {
    const { startAutomationCron } = require("./automation/cron");
    startAutomationCron();
  } catch (error) {
    console.error(
      "[automation:cron] Failed to start scheduler:",
      error instanceof Error ? error.message : String(error)
    );
  }

  if (seededSiteAdmin.created) {
    console.log(
      `Default siteadmin created with email ${seededSiteAdmin.email}.`
    );
  } else {
    console.log(
      `Default siteadmin already exists with email ${seededSiteAdmin.email}.`
    );
  }

  if (!process.env.SITEADMIN_EMAIL || !process.env.SITEADMIN_PASSWORD) {
    console.warn(
      `Using fallback siteadmin credentials (${seedConfig.email}). Set SITEADMIN_EMAIL and SITEADMIN_PASSWORD in .env for production.`
    );
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Unable to start server:", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
};
