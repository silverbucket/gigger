const fs = require("node:fs");
const path = require("node:path");

const NEW_PRIVATE = "showday";
const OLD_PRIVATE = "gigger";
const NEW_PUBLIC = path.join("public", NEW_PRIVATE);
const OLD_PUBLIC = path.join("public", OLD_PRIVATE);

/**
 * One-time rename of legacy storage trees when `showday` is empty and `gigger` still holds data.
 * Idempotent; safe to call before every login, signup, or token grant.
 */
async function migrateGiggerToShowday(store, username) {
  if (typeof store._resolvePath !== "function") return;
  const userRoot = store._resolvePath(username, "");
  const oldPrivate = path.join(userRoot, OLD_PRIVATE);
  const newPrivate = path.join(userRoot, NEW_PRIVATE);
  try {
    await fs.promises.access(oldPrivate);
  } catch {
    return;
  }
  try {
    await fs.promises.access(newPrivate);
  } catch {
    await fs.promises.rename(oldPrivate, newPrivate);
  }
  const oldPublic = path.join(userRoot, OLD_PUBLIC);
  const newPublic = path.join(userRoot, NEW_PUBLIC);
  try {
    await fs.promises.access(oldPublic);
  } catch {
    return;
  }
  try {
    await fs.promises.access(newPublic);
  } catch {
    await fs.promises.rename(oldPublic, newPublic);
  }
}

module.exports = { migrateGiggerToShowday, NEW_PRIVATE };
