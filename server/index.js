import express from "express";
import { assertRuntimeConfig, config, isCloudFunction, isProduction, uploadsDir } from "./lib/env.js";
import { usingFirestore } from "./lib/db.js";
import { errorHandler, notFound, route } from "./lib/http.js";
import { ensureOwnerAccount } from "./domain/users.js";
import authRoutes from "./routes/auth.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";

assertRuntimeConfig();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// JSON only — multipart routes opt in via the multipartBody middleware so the
// body parser never touches an upload stream.
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDir, { maxAge: "1h", index: false }));

app.get("/api/health", route(async (_req, res) => {
  const bootstrap = await ensureOwnerAccount();
  res.json({
    ok: true,
    storage: usingFirestore ? "firestore" : "local-json",
    runtime: isCloudFunction ? "cloud-function" : "node",
    ownerAccount: bootstrap.username,
    maxBatch: config.maxBatch
  });
}));

app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (_req, _res, next) => next(notFound("ไม่พบ endpoint ที่เรียก")));
app.use(errorHandler);

// Create the platform-owner account on boot outside Cloud Functions; inside
// Cloud Functions it happens lazily on the first /api/health or login request.
if (!isCloudFunction) {
  ensureOwnerAccount().catch((error) => console.error("bootstrap owner failed:", error.message));
  // Deliberately not `PORT`: tooling often injects PORT for the front-end dev
  // server, and the API must not fight it for the same port.
  const port = process.env.API_PORT || 3001;
  app.listen(port, () => {
    console.log(`Alumni yearbook API running on http://localhost:${port}`);
    console.log(`Storage backend: ${usingFirestore ? "Firestore" : "local JSON (data/db)"}`);
  });
}

export default app;
