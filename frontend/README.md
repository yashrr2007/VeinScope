# VeinScope

Frontend research prototype for NIR-like vein visualization and temporal feature comparison.

## Stack
- React + TypeScript
- Vite
- lucide-react
- recharts

## Run
```bash
npm install
npm run dev
```

The frontend expects a local API at `http://127.0.0.1:8000` by default. Set `VITE_API_BASE_URL` to override it.

## Important
`src/main.tsx` imports `src/styles.css`, but that stylesheet was not included in the files supplied for this upload. Add the project's original `styles.css` before treating this folder as the complete styled frontend.
