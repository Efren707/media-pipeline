# frontend/

React + TypeScript (Vite). Runs locally during M2; moves to S3 + CloudFront in Phase 10.

The upload page asks the backend for a presigned URL (`POST /api/uploads`), PUTs the file straight to S3, then polls `GET /api/jobs/{jobId}` until the job settles and shows the thumbnail.

## Run locally

Start the backend first (see [../backend/README.md](../backend/README.md)), then:

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to localhost:8080
```

Port 5173 must stay in `MP_CORS_ORIGINS` (bucket CORS), because the browser uploads to S3 directly.

## Develop

```bash
npm run lint           # oxlint
npm run format         # Prettier
npm run build          # type-check + production build (what CI runs, with lint and format:check)
```
