/**
 * How this company's sign-in screen looks, fetched rather than built in.
 *
 * The screen used to draw two initials, the company name and one sentence written into the source, all
 * from values baked into the build. Changing a word meant a new build, a new release and everybody
 * reinstalling. These values now come from the server, so a change reaches an installed app.
 *
 * **Nothing here is ever on the path between opening the app and seeing the screen.** The cached copy is
 * read first and the screen draws from it immediately; the network copy arrives afterwards and is stored
 * for next time. With no cache and no network, the values the app was built with are used — so the screen
 * is always complete, never half-drawn and never blank.
 *
 * This deliberately does not import from `shared/`: the build repository receives only `mobile/`, and a
 * `shared/` import is what broke the app bundle once before (checklist row 14). The shape below is the
 * server's payload, which `tests/forms.test.ts` checks the two ends agree on.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE, BRAND, api } from "./api";

export type AppBrand = {
  appName: string;
  heading: string;
  subtitle: string;
  footerNote: string;
  showVersion: boolean;
  initials: string;
  logoUrl?: string;
  bannerUrl?: string;
  primary: string;
  accent: string;
};

const CACHE_KEY = "lms.brand";

/** The wording the app shipped with — the same sentence that used to be written into the screen. */
export const DEFAULT_SUBTITLE = "Sign in with the e-mail and password your administrator gave you.";

/** What the app was built with. Always complete, so it can stand in for the server's copy. */
export const builtIn = (): AppBrand => ({
  appName: BRAND.companyName,
  heading: BRAND.companyName,
  subtitle: DEFAULT_SUBTITLE,
  footerNote: "",
  showVersion: true,
  initials: BRAND.companyName.slice(0, 2).toUpperCase(),
  primary: BRAND.primary,
  accent: BRAND.accent,
});

/** Image addresses arrive relative to the platform, because that is where they are served from. */
const absolute = (b: AppBrand): AppBrand => ({
  ...b,
  logoUrl: b.logoUrl && !/^https?:/i.test(b.logoUrl) ? `${API_BASE}${b.logoUrl}` : b.logoUrl,
  bannerUrl: b.bannerUrl && !/^https?:/i.test(b.bannerUrl) ? `${API_BASE}${b.bannerUrl}` : b.bannerUrl,
});

/**
 * The last known look, or what the app was built with.
 *
 * Merged over the built-in values rather than used as-is, so a cache written by an older version of the
 * app — missing a field added since — still produces a complete screen instead of an empty line.
 */
export async function cachedBrand(): Promise<AppBrand> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? absolute({ ...builtIn(), ...JSON.parse(raw) }) : builtIn();
  } catch {
    return builtIn();
  }
}

/** Asks the platform for the current look and remembers it. Returns nothing if it could not be reached. */
export async function refreshBrand(): Promise<AppBrand | undefined> {
  if (!BRAND.companyCode) return undefined; // built before the code was carried in; the built-in values stand
  try {
    const b = await api<AppBrand>(`/public/app-brand?code=${encodeURIComponent(BRAND.companyCode)}`);
    if (!b || typeof b.appName !== "string") return undefined;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(b)).catch(() => undefined);
    return absolute({ ...builtIn(), ...b });
  } catch {
    return undefined;
  }
}
