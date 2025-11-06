# MCP Video Understanding

## Overview
This project is an MCP server for a video understanding system using the Gemini model.

## Requirements
- Node.js
- TypeScript
- Cloudflare Workers

## Setup Instructions
1. Install dependencies
```bash
npm install
```

2. Configure environment variables
Copy `.dev.vars.example` to `.dev.vars` and set the required environment variables. They will be automatically loaded when running `wrangler dev`.
```bash
cp .dev.vars.example .dev.vars
```
Replace `GOOGLE_API_KEY` and `SHARED_SECRET` with your own values.

## Development
- Build: `npm run build` (generates `build/index.js`, which can be run with `node build/index.js` in local MCP clients like Claude)
- Test: `npm test`
- Development server: `npm run dev`
  - On first run, `workers-mcp docgen src/index.ts` is automatically executed to update `dist/docs.json`.
  - Access the Worker at `http://127.0.0.1:8787/`
  - Test the SSE endpoint with `curl -H "Authorization: Bearer $SHARED_SECRET" http://127.0.0.1:8787/sse`

## Deployment
`npm run deploy`

## License
See the `LICENSE` file for details.
