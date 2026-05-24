/**
 * Passport setup for Google + Microsoft OAuth.
 *
 * Tenancy is carried through the OAuth `state` parameter: when the user
 * clicks "Continue with Google" on /login/<orgSlug>, the route handler
 * encodes that slug into `state` and passport persists it across the
 * redirect. On callback we decode `state` → resolve the Organization →
 * find-or-create the user within that org → done(null, user).
 *
 * If state doesn't carry a slug we reject. Email-domain matching is
 * available via Organization.settings.allowedDomains for a future phase.
 */

import passport from "passport";
import { Strategy as GoogleStrategy, type Profile as GoogleProfile } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy, type Profile as MicrosoftProfile } from "passport-microsoft";
import { AuthProvider } from "@prisma/client";

import { basePrismaUnscoped } from "../db.js";
import { env, oauthEnabled } from "../env.js";

type AnyProfile = GoogleProfile | MicrosoftProfile;

export interface OAuthState {
  slug: string;
  nonce: string;
}

export function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export function decodeState(raw: unknown): OAuthState | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!json || typeof json !== "object") return null;
    const slug = (json as { slug?: unknown }).slug;
    const nonce = (json as { nonce?: unknown }).nonce;
    if (typeof slug !== "string" || typeof nonce !== "string") return null;
    return { slug, nonce };
  } catch {
    return null;
  }
}

/**
 * Resolve the OAuth profile to an Express.User within the org identified by
 * `state`. Auto-creates the user the first time they sign in.
 */
async function resolveProfileToUser(
  profile: AnyProfile,
  provider: AuthProvider,
  state: string | undefined,
): Promise<Express.User> {
  const decoded = decodeState(state);
  if (!decoded) throw new Error("OAuth state missing organization slug");

  const org = await basePrismaUnscoped.organization.findUnique({
    where: { slug: decoded.slug },
  });
  if (!org) throw new Error(`Unknown organization slug: ${decoded.slug}`);
  if (org.suspendedAt) throw new Error("Organization is suspended");

  const email = profile.emails?.[0]?.value?.toLowerCase();
  if (!email) throw new Error("OAuth profile did not include an email address");

  const name =
    profile.displayName ||
    [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(" ") ||
    email;

  const existing = await basePrismaUnscoped.user.findUnique({
    where: { organizationId_email: { organizationId: org.id, email } },
  });

  const user =
    existing ??
    (await basePrismaUnscoped.user.create({
      data: {
        organizationId: org.id,
        email,
        name,
        passwordHash: null,
        authProvider: provider,
      },
    }));

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    organizationId: user.organizationId,
    organizationSlug: org.slug,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}

if (oauthEnabled.google) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        callbackURL: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/google/callback`,
        passReqToCallback: true,
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const state = (req.query?.state as string | undefined) ?? undefined;
          const user = await resolveProfileToUser(profile, AuthProvider.GOOGLE, state);
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}

if (oauthEnabled.microsoft) {
  passport.use(
    new MicrosoftStrategy(
      {
        clientID: env.MICROSOFT_CLIENT_ID as string,
        clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
        callbackURL: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/microsoft/callback`,
        scope: ["user.read"],
        tenant: env.MICROSOFT_TENANT,
        passReqToCallback: true,
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const state = (req.query?.state as string | undefined) ?? undefined;
          const user = await resolveProfileToUser(profile, AuthProvider.MICROSOFT, state);
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}

export { passport };
