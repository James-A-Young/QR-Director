import * as oidc from 'openid-client';
import type { Config } from '../config.js';

export interface Identity {
  /** Stable subject identifier (Entra object id). */
  oid: string;
  email: string | null;
  name: string | null;
  groups: string[];
}

export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export interface AuthProvider {
  readonly kind: 'entra' | 'dev';
  /** Build the URL to send the browser to, plus state to remember in a cookie until the callback. */
  beginLogin(returnTo: string): Promise<{ url: string; state: LoginState }>;
  /** Exchange the callback for a verified identity. `callbackUrl` is the full URL the IdP redirected to. */
  completeLogin(callbackUrl: URL, state: LoginState): Promise<Identity>;
}

export class EntraAuthProvider implements AuthProvider {
  readonly kind = 'entra' as const;
  private configPromise: Promise<oidc.Configuration> | null = null;

  constructor(private readonly cfg: Config) {}

  get redirectUri(): string {
    return `${this.cfg.PUBLIC_BASE_URL}/auth/callback`;
  }

  /** Discovery is lazy and retried on failure so a transient network issue at boot does not wedge the app. */
  private config(): Promise<oidc.Configuration> {
    if (!this.configPromise) {
      const issuer = new URL(`https://login.microsoftonline.com/${this.cfg.AZURE_TENANT_ID}/v2.0`);
      this.configPromise = oidc
        .discovery(issuer, this.cfg.AZURE_CLIENT_ID!, this.cfg.AZURE_CLIENT_SECRET!)
        .catch((err: unknown) => {
          this.configPromise = null;
          throw err;
        });
    }
    return this.configPromise;
  }

  async beginLogin(returnTo: string) {
    const config = await this.config();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });
    return { url: url.href, state: { state, nonce, verifier, returnTo } };
  }

  async completeLogin(callbackUrl: URL, state: LoginState): Promise<Identity> {
    const config = await this.config();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: state.verifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('No ID token returned');
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const oid = str(claims.oid) ?? claims.sub;
    return {
      oid,
      email: (str(claims.email) ?? str(claims.preferred_username))?.toLowerCase() ?? null,
      name: str(claims.name),
      groups: Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [],
    };
  }
}

/**
 * Development-only provider: shows a simple form instead of a real IdP. Refused in production by config.
 */
export class DevAuthProvider implements AuthProvider {
  readonly kind = 'dev' as const;

  constructor(private readonly baseUrl: string) {}

  async beginLogin(returnTo: string) {
    const state = { state: oidc.randomState(), nonce: '', verifier: '', returnTo };
    return { url: `${this.baseUrl}/auth/dev-login?state=${encodeURIComponent(state.state)}`, state };
  }

  async completeLogin(callbackUrl: URL, state: LoginState): Promise<Identity> {
    if (callbackUrl.searchParams.get('state') !== state.state) throw new Error('State mismatch');
    const email = (callbackUrl.searchParams.get('email') ?? 'dev@example.com').toLowerCase();
    return { oid: `dev:${email}`, email, name: callbackUrl.searchParams.get('name') || email.split('@')[0]!, groups: [] };
  }
}

export function isIdentityAllowed(identity: Identity, cfg: Pick<Config, 'allowedEmailDomains' | 'AUTH_REQUIRED_GROUP_ID'>): boolean {
  if (cfg.allowedEmailDomains.length > 0) {
    const domain = identity.email?.split('@')[1];
    if (!domain || !cfg.allowedEmailDomains.includes(domain)) return false;
  }
  if (cfg.AUTH_REQUIRED_GROUP_ID && !identity.groups.includes(cfg.AUTH_REQUIRED_GROUP_ID)) return false;
  return true;
}
