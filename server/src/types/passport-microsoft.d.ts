// Minimal typings for passport-microsoft (no DefinitelyTyped package exists).
declare module "passport-microsoft" {
  import type { Request } from "express";
  import type { Strategy as PassportStrategy } from "passport";

  export interface Profile {
    id: string;
    displayName?: string;
    name?: { familyName?: string; givenName?: string };
    emails?: Array<{ value: string; type?: string }>;
    _json?: Record<string, unknown>;
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
    tenant?: string;
    passReqToCallback?: boolean;
  }

  export type VerifyCallback = (err: Error | null, user?: unknown, info?: object) => void;

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) => void;

  export type VerifyFunctionWithRequest = (
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) => void;

  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction | VerifyFunctionWithRequest);
    name: string;
    authenticate(req: Request, options?: object): void;
  }
}
