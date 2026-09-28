# VeinScope

VeinScope is a local research prototype for NIR-like vein visualization and temporal feature comparison.

## Repository structure

- `frontend/` — React + TypeScript + Vite interface
- `backend/` — FastAPI + OpenCV + scikit-image local analysis API

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the local API at `http://127.0.0.1:8000` by default. Override it with `VITE_API_BASE_URL` when needed.

## Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Scope

This is a research prototype. Its image-based visibility and temporal scores are experimental and are not clinical recommendations.
