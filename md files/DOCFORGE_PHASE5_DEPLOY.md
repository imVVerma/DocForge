# DocForge — Phase 5 Build Prompt
## Polish + Deploy: Railway (Backend) + Vercel (Frontend)

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

All four tools are complete and working locally. This phase:
1. Adds rate limiting to the backend
2. Creates Railway config so all system deps install automatically
3. Deploys backend to Railway
4. Deploys frontend to Vercel
5. Wires environment variables
6. Verifies the full production stack end-to-end

---

## Step 1 — Add rate limiting to the backend

Install slowapi:
```bash
pip install slowapi
```

Add to `backend/requirements.txt`:
```
slowapi==0.1.9
```

Read `backend/app/main.py`. Add rate limiting without removing anything:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Create limiter — add this near the top of main.py, before app creation
limiter = Limiter(key_func=get_remote_address)

# After app = FastAPI(...) line, add:
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

Read `backend/app/routers/upload.py`. Add the rate limit decorator to the upload route:

```python
from app.main import limiter
from fastapi import Request

# Add Request as first parameter and decorator to the upload route:
@router.post("/upload", ...)
@limiter.limit("20/minute")
async def upload_files(
    request: Request,   # ← add this as the FIRST parameter
    files: Annotated[list[UploadFile], File(...)],
) -> JobCreatedResponse:
    ...
```

**Verify:** `uvicorn app.main:app --reload` starts cleanly. Uploading a file still works.

---

## Step 2 — Create `backend/nixpacks.toml`

This file tells Railway exactly what system packages to install before running the app.
It installs all the binaries that don't work on Windows but are needed in production.

Create `backend/nixpacks.toml`:

```toml
[phases.setup]
nixPkgs = [
  "ghostscript",
  "tesseract",
  "tesseract-data-eng",
  "tesseract-data-hin",
  "poppler_utils",
  "libreoffice",
  "pandoc",
  "python311",
]

[phases.install]
cmds = ["pip install -r requirements.txt"]

[start]
cmd = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
```

> Note: Railway injects `$PORT` automatically — never hardcode a port number.

---

## Step 3 — Create `backend/Procfile`

Fallback start command in case nixpacks.toml start section is ignored:

```
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

---

## Step 4 — Create `backend/runtime.txt`

Pin the Python version:
```
python-3.11.9
```

---

## Step 5 — Update `backend/app/config.py` for production

Read `config.py`. Update `TMP_BASE` to use the OS temp directory properly
on both Windows (dev) and Linux (production):

Find the `TMP_BASE` line and replace it:

```python
import tempfile

# Use OS temp dir as base — works on both Windows (dev) and Linux (Railway)
TMP_BASE: Path = Path(tempfile.gettempdir()) / "docforge"
```

If this change was already made during Phase 1 (Windows fix), skip this step.

---

## Step 6 — Create `backend/.railwayignore`

Prevent Railway from uploading unnecessary files:

```
__pycache__/
*.pyc
*.pyo
.env
.env.*
.venv/
venv/
*.egg-info/
.pytest_cache/
.ruff_cache/
```

---

## Step 7 — Push backend to GitHub

Ensure the full project is committed and pushed:

```bash
git add .
git commit -m "feat: phase 5 — rate limiting + railway config"
git push origin main
```

---

## Step 8 — Deploy backend on Railway

In the Railway dashboard:

1. Click **"GitHub Repository"**
2. Select your DocForge repo
3. Railway will detect the repo — it may try to deploy from root. We need it to
   deploy from `backend/` only. Set the **Root Directory** to `backend` in the
   Railway service settings before deploying.
4. Railway will read `nixpacks.toml` and install all system dependencies automatically.
5. Once deployed, Railway gives you a public URL like:
   `https://docforge-backend-production.up.railway.app`

**Environment variables to set in Railway dashboard → Variables tab:**

| Key | Value |
|-----|-------|
| `PORT` | `8000` (Railway may set this automatically) |
| `ALLOWED_ORIGINS` | `https://your-vercel-app.vercel.app` (update after Vercel deploy) |

---

## Step 9 — Update CORS for production

Read `backend/app/main.py`. Find the CORS middleware configuration.
Update it to read allowed origins from an environment variable:

```python
import os

# Replace the existing CORSMiddleware setup with:
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"   # dev defaults
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Commit and push this change:
```bash
git add backend/app/main.py
git commit -m "feat: dynamic CORS origins from env var"
git push origin main
```

Railway will auto-redeploy on push.

---

## Step 10 — Verify Railway deployment

Once Railway shows the deployment as "Active":

```bash
# Replace with your actual Railway URL
curl https://docforge-backend-production.up.railway.app/api/ping
```

Expected:
```json
{"status": "ok", "tmp_base_exists": true}
```

Also open `https://your-railway-url.up.railway.app/docs` in the browser —
you should see the full FastAPI Swagger UI with all 5 routes:
- `POST /api/upload`
- `POST /api/convert`
- `POST /api/merge`
- `POST /api/compress`
- `POST /api/ocr`
- `GET /api/download/{job_id}`
- `DELETE /api/cleanup/{job_id}`

---

## Step 11 — Prepare frontend for production

Read `frontend/src/lib/api.ts`. The `BASE_URL` line should currently be:
```ts
const BASE_URL = import.meta.env.VITE_API_URL ?? "";
```

This is correct. In production, `VITE_API_URL` will point to the Railway backend URL.
In dev, it's empty (proxy handles it). No code change needed.

Create `frontend/.env.production`:
```
VITE_API_URL=https://docforge-backend-production.up.railway.app
```

Replace the URL with your actual Railway deployment URL.

> Note: `.env.production` is baked into the Vite build at build time.
> It is NOT a secret — it just points to your public API.
> Do NOT put API keys or secrets here.

---

## Step 12 — Create `frontend/vercel.json`

This tells Vercel how to handle client-side routing (wouter) so direct URL
navigation works correctly:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

## Step 13 — Deploy frontend to Vercel

Option A — Vercel CLI:
```bash
cd frontend
pnpm build   # confirm build passes locally first
npx vercel --prod
```
Follow prompts: link to existing project or create new, set root to `frontend/`.

Option B — Vercel Dashboard:
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. Set **Build Command** to `pnpm run build`
5. Set **Output Directory** to `dist`
6. Add environment variable:
   - Key: `VITE_API_URL`
   - Value: `https://docforge-backend-production.up.railway.app`
7. Click Deploy

Vercel will give you a URL like: `https://docforge.vercel.app`

---

## Step 14 — Update Railway CORS with Vercel URL

Now that you have the Vercel URL, go back to Railway → Variables tab.
Update `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS=https://docforge.vercel.app
```

Railway will redeploy automatically.

---

## Step 15 — End-to-end production smoke tests

Run all four tools against the live production URLs:

**Test 1 — Convert (PDF → TXT)**
- [ ] Open `https://docforge.vercel.app/convert`
- [ ] Drop a PDF, select TXT, click Convert
- [ ] File downloads correctly

**Test 2 — Merge (2 PDFs)**
- [ ] Open `/merge`, drop 2 PDFs, merge
- [ ] merged.pdf downloads

**Test 3 — Compress (DOCX)**
- [ ] Open `/compress`, drop a DOCX with images, compress on Medium
- [ ] Compressed file downloads, size reduction shown

**Test 4 — OCR (PNG → TXT)**
- [ ] Open `/ocr`, drop a scanned image, extract text
- [ ] TXT file downloads with readable content

**Test 5 — Previously broken paths (now fixed on Linux)**
- [ ] Convert: TXT → PDF (WeasyPrint works on Railway)
- [ ] Convert: MD → PDF (WeasyPrint works on Railway)
- [ ] Convert: DOCX → PDF (LibreOffice works on Railway)
- [ ] Convert: MD → DOCX (pandoc works on Railway)
- [ ] Compress: PDF → ghostscript compression works on Railway

**Test 6 — Rate limiting**
- [ ] Send 21 rapid requests to `/api/upload` — 21st returns HTTP 429

---

## Verification Checklist

- [ ] `curl https://your-railway-url/api/ping` returns `{"status":"ok",...}`
- [ ] `/docs` on Railway URL shows all routes
- [ ] Vercel build completes without errors
- [ ] All 4 tools work end-to-end in production
- [ ] TXT→PDF, MD→PDF, DOCX→PDF, MD→DOCX all work in production
- [ ] CORS: frontend on Vercel can reach backend on Railway (no CORS errors in DevTools)
- [ ] Rate limiting: 429 returned after 20 req/min
- [ ] Files are deleted after download (check Railway logs for cleanup messages)
- [ ] No Railway build errors in deploy logs

---

## Files created / modified this step

```
backend/
├── nixpacks.toml               ← NEW
├── Procfile                    ← NEW
├── runtime.txt                 ← NEW
├── .railwayignore              ← NEW
├── requirements.txt            ← updated (slowapi)
└── app/
    ├── main.py                 ← updated (rate limiter, dynamic CORS)
    ├── config.py               ← updated (TMP_BASE via tempfile, if not already)
    └── routers/
        └── upload.py           ← updated (rate limit decorator)

frontend/
├── vercel.json                 ← NEW
├── .env.production             ← NEW (Railway URL)
└── src/lib/api.ts              ← no change needed
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md`:

| Task | New status |
|------|-----------|
| 5.1 Error handling audit | ✅ Done |
| 5.2 Mobile responsive audit | ✅ Done |
| 5.3 Rate limiting | ✅ Done |
| 5.4 Railway deploy (backend) | ✅ Done |
| 5.5 Vercel deploy (frontend) | ✅ Done |

---

*DocForge v1 complete. All four tools live in production.*
