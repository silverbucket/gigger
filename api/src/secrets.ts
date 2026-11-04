import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Page and storage tokens are stored AES-256-GCM encrypted with TOKEN_KEY (64 hex characters, `openssl rand -hex 32`). */
function key(env = process.env) {
  const hex = env.TOKEN_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new Error("TOKEN_KEY must be 64 hex characters");
  return Buffer.from(hex, "hex");
}
export function seal(text: string, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}
export function unseal(stored: string, env = process.env) {
  const [prefix, iv, tag, body] = stored.split(":");
  // shortcut: rows written before encryption are returned as they are, drop once every deployment has reconnected its Pages
  if (prefix !== "enc") return stored;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(env),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
