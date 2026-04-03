/**
 * Canva OAuth helper
 *
 * Usage:
 *   node scripts/canva-oauth.js auth-url --code-challenge <challenge> --state <state>
 *   node scripts/canva-oauth.js exchange --code <auth_code> --code-verifier <verifier>
 *   node scripts/canva-oauth.js refresh --refresh-token <refresh_token>
 *
 * Required env:
 *   CANVA_CLIENT_ID
 *   CANVA_CLIENT_SECRET
 *   CANVA_REDIRECT_URI
 */
require('dotenv').config();
const axios = require('axios');

const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) {
      out._.push(t);
      continue;
    }
    const key = t.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function exchangeCode({ code, codeVerifier }) {
  if (!code) throw new Error('--code is required');
  if (!codeVerifier) throw new Error('--code-verifier is required');

  const clientId = requiredEnv('CANVA_CLIENT_ID');
  const clientSecret = requiredEnv('CANVA_CLIENT_SECRET');
  const redirectUri = requiredEnv('CANVA_REDIRECT_URI');

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('redirect_uri', redirectUri);
  body.set('code', code);
  body.set('code_verifier', codeVerifier);

  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
  });
  return res.data;
}

async function refreshAccessToken({ refreshToken }) {
  if (!refreshToken) throw new Error('--refresh-token is required');

  const clientId = requiredEnv('CANVA_CLIENT_ID');
  const clientSecret = requiredEnv('CANVA_CLIENT_SECRET');

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('refresh_token', refreshToken);

  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
  });
  return res.data;
}

function buildAuthorizeUrl({ codeChallenge, state = 'canva_oauth', scope = 'asset:read asset:write design:content:read design:meta:read design:permission:read folder:read profile:read' }) {
  if (!codeChallenge) throw new Error('--code-challenge is required');
  const clientId = requiredEnv('CANVA_CLIENT_ID');
  const redirectUri = requiredEnv('CANVA_REDIRECT_URI');

  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('redirect_uri', redirectUri);
  params.set('response_type', 'code');
  params.set('scope', scope);
  params.set('state', state);
  params.set('code_challenge_method', 'S256');
  params.set('code_challenge', codeChallenge);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'auth-url') {
    const url = buildAuthorizeUrl({
      codeChallenge: args['code-challenge'],
      state: args.state || 'canva_oauth',
      scope: args.scope || undefined,
    });
    console.log(url);
    return;
  }

  if (cmd === 'exchange') {
    const tokens = await exchangeCode({
      code: args.code,
      codeVerifier: args['code-verifier'],
    });
    console.log(JSON.stringify(tokens, null, 2));
    return;
  }

  if (cmd === 'refresh') {
    const tokens = await refreshAccessToken({
      refreshToken: args['refresh-token'],
    });
    console.log(JSON.stringify(tokens, null, 2));
    return;
  }

  console.log(
    [
      'Usage:',
      '  node scripts/canva-oauth.js auth-url --code-challenge <challenge> --state <state>',
      '  node scripts/canva-oauth.js exchange --code <auth_code> --code-verifier <verifier>',
      '  node scripts/canva-oauth.js refresh --refresh-token <refresh_token>',
    ].join('\n')
  );
}

main().catch((err) => {
  const msg = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
  console.error(msg);
  process.exit(1);
});

