import { Gigger, type GiggerStore } from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";
export const storage = new RemoteStorage({
  discovery: { allowPrivateAddresses: true, timeout: 5000 },
  changeEvents: { local: true, window: false, remote: true, conflict: true },
});
storage.addModule(Gigger);
storage.access.claim("gigger", "rw");
storage.caching.enable("/gigger/");
export const bands = (storage as RemoteStorage & { gigger: GiggerStore })
  .gigger;
