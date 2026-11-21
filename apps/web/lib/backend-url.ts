export const BACKEND_URL =
  process.env.BACKEND_URL?.trim().replace(/(?:\\[rn])+$/, "").trim().replace(/\/+$/, "") ||
  "http://localhost:8000";
