/** Third-party network substitute, preloaded ONLY by the isolated test process. */
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const namespace = process.env.AIMTHREAD_TEST_SCHEMA;
const database = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
if (
  !namespace?.match(/^aimthread_test_[a-f0-9]{32}$/) &&
  !(
    ["localhost", "127.0.0.1"].includes(database.hostname) &&
    database.pathname.endsWith("_test")
  )
) {
  throw new Error("OAuth fixtures require an isolated test database.");
}
const originalFetch = globalThis.fetch;
const keys = generateKeyPair("RS256");
export function oauthCode(profile) {
  return Buffer.from(JSON.stringify(profile)).toString("base64url");
}
function decode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString());
}
function json(data) {
  return Response.json(data);
}

globalThis.fetch = async (input, options) => {
  const request = new Request(input, options);
  const url = new URL(request.url);
  if (
    url.href === "https://oauth2.googleapis.com/token" ||
    url.href === "https://github.com/login/oauth/access_token"
  ) {
    const body = new URLSearchParams(await request.text());
    const code = body.get("code");
    const profile = decode(code);
    if (profile.failure) return json({ error: "invalid_grant" });
    const { privateKey } = await keys;
    const idToken = await new SignJWT({
      sub: profile.id,
      name: profile.name,
      email: profile.email,
      email_verified: profile.verified,
    })
      .setProtectedHeader({ alg: "RS256", kid: "isolated-fixture" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .setIssuer("https://accounts.google.com")
      .setAudience("isolated-google-client")
      .sign(privateKey);
    return json({
      access_token: code,
      refresh_token: `refresh-${code}`,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "email profile openid",
    });
  }
  if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
    const { publicKey } = await keys;
    return json({
      keys: [
        {
          ...(await exportJWK(publicKey)),
          kid: "isolated-fixture",
          alg: "RS256",
        },
      ],
    });
  }
  if (
    url.hostname === "api.github.com" &&
    ["/user", "/user/emails"].includes(url.pathname)
  ) {
    const profile = decode(
      request.headers.get("authorization").replace(/^Bearer /, ""),
    );
    return json(
      url.pathname === "/user/emails"
        ? [{ email: profile.email, primary: true, verified: profile.verified }]
        : {
            id: profile.id,
            name: profile.name,
            login: profile.id,
            email: profile.email,
          },
    );
  }
  return originalFetch(input, options);
};
