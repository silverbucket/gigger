const { randomUUID } = require("node:crypto");

function createAuthHandler(store, clientId) {
  let pending = Promise.resolve();
  return async function handle(action, input) {
    const username =
      typeof input.username === "string"
        ? input.username.trim().toLowerCase()
        : "";
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(username))
      return {
        status: 400,
        body: {
          error:
            "Use a username of 2–64 letters, numbers, dots, underscores or dashes.",
        },
      };
    if (!["signup", "login", "logout"].includes(action))
      return { status: 404, body: { error: "Not found" } };
    const email =
      typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (action === "logout") {
      if (typeof input.token !== "string" || !input.token)
        return { status: 400, body: { error: "Missing session." } };
    } else {
      if (
        typeof input.password !== "string" ||
        input.password.length > 1024 ||
        input.password.length < (action === "signup" ? 8 : 1)
      )
        return {
          status: 400,
          body: { error: "Enter a password of at least eight characters." },
        };
      if (action === "signup") {
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return { status: 400, body: { error: "Enter a valid email." } };
        if (
          typeof input.bandName !== "string" ||
          !input.bandName.trim() ||
          input.bandName.length > 200
        )
          return {
            status: 400,
            body: { error: "Enter a band name (up to 200 characters)." },
          };
        if (
          input.currency !== undefined &&
          !(
            typeof input.currency === "string" &&
            /^[A-Za-z]{3}$/.test(input.currency)
          )
        )
          return {
            status: 400,
            body: { error: "Enter a three-letter currency code." },
          };
      }
    }
    // Serialize account writes, including email uniqueness checks across usernames.
    const task = pending.then(async () => {
      if (action === "logout") {
        if (await store.readAuth(username))
          await store.revokeAccess(username, input.token);
        return { status: 200, body: { ok: true } };
      }
      if (action === "signup") {
        if (await store.readAuth(username))
          return {
            status: 409,
            body: { error: "This username is already taken." },
          };
        if (await store.findUserByEmail(email))
          return {
            status: 409,
            body: {
              error: "This email already has an account. Log in instead.",
            },
          };
        await store.createUser({ username, email, password: input.password });
        try {
          const band = {
            id: randomUUID(),
            name: input.bandName.trim(),
            ...(input.currency
              ? { currency: input.currency.toUpperCase() }
              : {}),
            "@context": "http://remotestorage.io/spec/modules/gigger/band",
          };
          const saved = await store.put(
            username,
            `/gigger/bands/${band.id}/band`,
            "application/json",
            Buffer.from(JSON.stringify(band)),
          );
          if (!saved.created) throw new Error("Could not save initial band");
          const token = await store.authorize(clientId, username, {
            gigger: ["r", "w"],
          });
          return { status: 201, body: { username, token } };
        } catch (error) {
          await store.removeUser(username);
          throw error;
        }
      }
      try {
        await store.authenticate({ username, password: input.password });
      } catch {
        return {
          status: 401,
          body: { error: "Incorrect username or password." },
        };
      }
      const token = await store.authorize(clientId, username, {
        gigger: ["r", "w"],
      });
      return { status: 200, body: { username, token } };
    });
    pending = task.catch(() => {});
    return task;
  };
}
module.exports = { createAuthHandler };
