import type { AuthConfig } from 'convex/server'

export default {
  providers: [
    {
      // Replace with your Clerk Frontend API URL from the Convex integration
      // setup in the Clerk Dashboard, or configure CLERK_FRONTEND_API_URL
      // in your local environment or on the Convex Dashboard.
      // See https://clerk.com/docs/guides/development/integrations/databases/convex#configure-convex-with-the-clerk-issuer-domain
      // Should look similar to 'https://main-swine-30.clerk.accounts.dev'.
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
