import { onRequest } from "firebase-functions/v2/https";
import app from "./server/index.js";

export const api = onRequest(
  {
    region: "asia-southeast1",
    memory: "1GiB",
    // A 10,000-row Excel import writes in bulk and needs more than 60 seconds.
    timeoutSeconds: 540,
    maxInstances: 20,
    concurrency: 40,
    secrets: ["AUTH_JWT_SECRET", "ID_HASH_SECRET", "ADMIN_ACCESS_KEY", "OWNER_INITIAL_PASSWORD"]
  },
  app
);
