export function createLogoutSync(
  onLogout: () => void,
  channel = new BroadcastChannel("showday-session"),
) {
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === "logout") onLogout();
  };
  return {
    broadcast: () => channel.postMessage("logout"),
    close: () => channel.close(),
  };
}
