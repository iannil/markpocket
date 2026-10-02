import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db';

// DISABLE_SIGNUP=1 (or any truthy value) locks the instance to existing
// accounts — the self-host equivalent of closing open registration. Default
// (unset) keeps sign-up open.
const SIGNUP_DISABLED = !['', '0', 'false', 'no', 'off'].includes(
  (process.env.DISABLE_SIGNUP ?? '').trim().toLowerCase(),
);

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
  },
  ...(SIGNUP_DISABLED && {
    // Throwing from the create.before hook rejects sign-up with the friendly
    // message below (better-auth rethrows APIErrors from hooks verbatim).
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            throw new APIError('BAD_REQUEST', { message: 'Sign-up is disabled on this instance' });
          },
        },
      },
    },
  }),
  advanced: {
    cookiePrefix: 'markpocket',
  },
});

// Cookie-secureness tripwire (L-4): better-auth derives the Secure cookie flag
// from the baseURL it is configured with. In the standard self-host topology
// (app in a container speaking plain HTTP behind a TLS-terminating reverse
// proxy) the operator must set BETTER_AUTH_URL to the https:// origin the
// BROWSER sees — forget it and every login silently issues session cookies
// without Secure, which then travel over any plain-http hop and can be sniffed
// off the wire. We deliberately do NOT override the behavior (an explicit
// http:// baseURL can be a legitimate deliberate choice, e.g. an air-gapped
// LAN deployment) — we only fail loud at boot so the misconfiguration is
// visible instead of silent.
const baseURL = process.env.BETTER_AUTH_URL;
if (process.env.NODE_ENV === 'production' && baseURL?.startsWith('http://')) {
  console.warn(
    `[markpocket] BETTER_AUTH_URL is set to "${baseURL}" (plain http) in production. ` +
      'Session cookies will be issued WITHOUT the Secure flag. ' +
      'If the app runs behind a reverse proxy that terminates HTTPS, set ' +
      'BETTER_AUTH_URL to the https:// origin browsers actually use ' +
      '(e.g. BETTER_AUTH_URL=https://markpocket.example.com). ' +
      'Only leave http:// if this instance is deliberately served over an isolated plain-http network.',
  );
}

export type Session = typeof auth.$Infer.Session;
