# DocForge — Hotfix: Vite Proxy + API Base URL

## Problem
All API calls from the frontend are hitting `http://localhost:5173/api/upload` (the
Vite dev server) instead of `http://localhost:8000/api/upload` (the FastAPI backend).
This returns 404 on every request. Root cause: missing Vite proxy config + wrong
BASE_URL in api.ts.

## Fix — 3 files to edit, in this exact order.

---

## Step 1 — Read `frontend/vite.config.ts`

Read the file first. Then replace its entire contents with exactly this:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
```

---

## Step 2 — Read `frontend/src/lib/api.ts`

Find this line:
```ts
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
```

Replace it with:
```ts
const BASE_URL = import.meta.env.VITE_API_URL ?? "";
```

Also find the `getDownloadUrl` function:
```ts
export function getDownloadUrl(jobId: string): string {
  return `${BASE_URL}/api/download/${jobId}`;
}
```

Replace it with:
```ts
export function getDownloadUrl(jobId: string): string {
  return `/api/download/${jobId}`;
}
```

---

## Step 3 — Read `frontend/.env.development`

If the file exists and contains `VITE_API_URL=http://localhost:8000`, delete that line
so the file is empty (or delete the file entirely). The proxy now handles routing —
the env var must not override it in development.

---

## Step 4 — Restart the dev server

Stop the current `pnpm run dev` process (Ctrl+C), then restart:
```bash
cd frontend
pnpm run dev
```

**Vite must be restarted** for vite.config.ts changes to take effect.

---

## Step 5 — Verify

Confirm the backend is running at `http://localhost:8000`:
```bash
curl http://localhost:8000/api/ping
```
Expected: `{"status":"ok","tmp_base_exists":true}`

Then open `http://localhost:5173` in the browser, open DevTools → Network tab,
and try a conversion or merge. The upload request must now show:
- URL: `http://localhost:5173/api/upload` ← this is correct, Vite proxies it
- Status: `200` (not 404)
- The request actually reaches the backend (check backend terminal logs)

---

## Step 6 — Report back

After completing the steps, reply with:

1. Contents of `frontend/vite.config.ts` after edit
2. The `const BASE_URL` line from `frontend/src/lib/api.ts` after edit
3. Result of `curl http://localhost:8000/api/ping`
4. What the Network tab shows when you try to upload a file
   (URL, status code, and response body or error)
