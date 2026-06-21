// ─── API Base URL Configuration ───
// In production on Firebase Hosting, API calls go to the Oracle VM backend.
// In local development, they go to the same origin (Express dev server).
export const API_BASE = import.meta.env.VITE_API_BASE || "";
