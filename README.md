# Gavel

Gavel helps you sell stuff by messaging an agent. Tell it what you want to sell, and it handles the work: creates the Craigslist post, manages buyer demand, drafts replies, compares offers, and coordinates the next steps. When it is ready to act, it messages you once for final confirmation, then finishes the sale flow.

The app is built with TanStack Start, Convex, Clerk, and Vite+.

## Development

Install dependencies:

```bash
vp install
```

Set up a Convex dev deployment:

```bash
npx convex dev
```

For normal local development, run the app and Convex together:

```bash
vp run dev
```

Useful checks:

```bash
vp check
vp test
vp build
```
