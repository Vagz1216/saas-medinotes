This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/pages/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

For local testing of the streaming AI endpoint, run the Python API in a second terminal:

```bash
npm run dev:api
```

In development, Next.js proxies `POST /api` to `http://127.0.0.1:8001/api`. In production on Vercel, `/api` is served by `api/index.py`.

Azure OpenAI is the first/default AI provider in the fallback chain. Add these values to `.env.local` to use it locally:

```bash
AZURE_OPENAI_API_KEY=your-azure-openai-key
AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_WIRE_API=responses
```

`AZURE_OPENAI_DEPLOYMENT` must be the Azure deployment name, not just the raw model name. If your Azure deployment does not support the Responses API, set `AZURE_OPENAI_WIRE_API=chat`.

Check local environment formatting before starting the API:

```bash
npm run check:env
```

This catches missing Azure settings and copied smart quotes in keys, which can cause errors like `ascii codec can't encode character`.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/pages/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn-pages-router) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/pages/building-your-application/deploying) for more details.

## CI/CD checklist

Run the same validation used by CI:

```bash
npm ci
npm run lint
npm run build
```

GitHub Actions needs these repository variables or secrets:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` for the CI build.
- `VERCEL_ORG_ID` for production deployment.
- `VERCEL_PROJECT_ID` for production deployment.
- `VERCEL_TOKEN` as a repository secret for production deployment.

Vercel production environment variables should include:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWKS_URL`
- Azure OpenAI settings: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_WIRE_API`.
- Optional fallback provider keys: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, or `GROQ_API_KEY`.

Deploy from the CLI:

```bash
vercel login
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```
