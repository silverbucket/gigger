export const socialPlatforms = [
  "instagram",
  "facebook",
  "youtube",
  "spotify",
  "bandcamp",
  "tiktok",
  "soundcloud",
  "x",
] as const;
export type SocialPlatform = (typeof socialPlatforms)[number];

export const themePresets = [
  "night",
  "paper",
  "gold",
  "red",
  "custom",
] as const;
export type ThemePreset = (typeof themePresets)[number];

export interface PublicPageTheme {
  preset?: ThemePreset;
  background: string;
  text: string;
  accent: string;
}

export interface PublicSocialLink {
  platform: SocialPlatform;
  url: string;
}

export const PAGE_THEME_PRESETS: Record<
  Exclude<ThemePreset, "custom">,
  PublicPageTheme
> = {
  night: {
    preset: "night",
    background: "#201e1d",
    text: "#f3f2f2",
    accent: "#ec3013",
  },
  paper: {
    preset: "paper",
    background: "#f3f2f2",
    text: "#201e1d",
    accent: "#ec3013",
  },
  gold: {
    preset: "gold",
    background: "#e7c244",
    text: "#15120b",
    accent: "#15120b",
  },
  red: {
    preset: "red",
    background: "#ec3013",
    text: "#fff2ef",
    accent: "#201e1d",
  },
};

/** Default for new pages (Night); live pages with no theme render as Gold. */
export const defaultNewPageTheme = PAGE_THEME_PRESETS.night;
export const legacyLivePageTheme = PAGE_THEME_PRESETS.gold;

const handlePlatforms = new Set<SocialPlatform>(["instagram", "tiktok", "x"]);

export function normalizePublicWebsite(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

function stripAt(handle: string) {
  return handle.trim().replace(/^@+/, "");
}

export function normalizeSocialUrl(
  platform: SocialPlatform,
  raw: string,
): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (handlePlatforms.has(platform) && !/^https?:\/\//i.test(text)) {
    const handle = stripAt(text);
    if (!handle) return undefined;
    if (platform === "instagram")
      return `https://instagram.com/${encodeURIComponent(handle)}`;
    if (platform === "tiktok")
      return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
    return `https://x.com/${encodeURIComponent(handle)}`;
  }
  return normalizePublicWebsite(text);
}

export function migrateLegacyInstagram(
  instagram: unknown,
): PublicSocialLink | undefined {
  if (typeof instagram !== "string" || !instagram.trim()) return undefined;
  const url = normalizeSocialUrl("instagram", instagram);
  return url ? { platform: "instagram", url } : undefined;
}
