export { account, api } from "./api";

export type MetaConfig = {
  appId: string;
  configId: string;
  graphVersion: string;
  humanAgent: boolean;
};
/** Server-wide settings for Messenger and Instagram. */
class Meta {
  config = $state<MetaConfig | null>(null);
  async load() {
    try {
      this.config = await (await fetch("/api/meta/config")).json();
    } catch {
      this.config = null;
    }
  }
}
export const meta = new Meta();
