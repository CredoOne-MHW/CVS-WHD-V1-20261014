/**
 * How a company's mobile app looks before anyone signs in.
 *
 * Until now the app carried six values baked into the build — company name, code, two colours and the
 * version — and drew its sign-in screen from them: two initials in a circle, the company name, and one
 * English sentence written into the source. Changing any of it meant a new build.
 *
 * Everything here is delivered to the app **at runtime** and cached on the phone, so a wording or logo
 * change reaches an installed app without rebuilding it. The app still falls back to what it was built
 * with, so it is never left blank when it cannot reach the network.
 *
 * The defaults below reproduce the screen exactly as it is today. A company that sets nothing sees no
 * change whatsoever — and there is a test asserting that, value by value.
 *
 * Imported by the server and the Super Admin screen. **Not** by the app: the build repository only
 * receives `mobile/`, so a `shared/` import there breaks the Metro bundle (checklist row 14). The app
 * receives this as JSON instead.
 */

export type MobileBrand = {
  /** Name on the sign-in screen and under the icon. */
  appName: string;
  /** Big line. Blank falls back to the app name. */
  heading: string;
  /** The line under it. */
  subtitle: string;
  /** Small line beneath the card, above the version. */
  footerNote: string;
  showVersion: boolean;
  /** Two letters drawn in a circle when there is no logo. */
  initials: string;
  logoUrl?: string;
  bannerUrl?: string;
  primary: string;
  accent: string;
};

export const DEFAULT_SUBTITLE = "Sign in with the e-mail and password your administrator gave you.";

/** The two image kinds that belong to the app rather than the web login. */
export const APP_ASSET_KINDS = ["appLogo", "appBanner"] as const;

/**
 * Every brand image a company can have, in one place.
 *
 * The upload route, the delete route and the public streaming route each had their own copy of this list.
 * Three lists mean a kind that uploads and then 404s when it is read back — so there is one list now and
 * all three read it.
 */
export const BRAND_ASSET_KINDS = ["logo", "banner", "favicon", ...APP_ASSET_KINDS] as const;

const str = (v: any, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/**
 * Builds the payload the app reads.
 *
 * `assetUrl` is passed in rather than built here because only the server knows how a stored key becomes a
 * URL, and this file is also loaded in the browser.
 */
export function mobileBrand(c: any, assetUrl: (kind: string, key?: string) => string | undefined): MobileBrand {
  const b = c?.branding || {};
  const m = b.mobile || {};
  const name = str(c?.whiteLabel?.appNames?.mobile) || str(b.shortName) || str(c?.name, "Leads");

  return {
    appName: name,
    heading: str(m.heading, name),
    subtitle: str(m.subtitle, DEFAULT_SUBTITLE),
    footerNote: str(m.footerNote),
    showVersion: m.showVersion !== false,
    initials: name.slice(0, 2).toUpperCase(),
    /* the app's own logo if one was given, otherwise the company logo, otherwise initials */
    logoUrl: assetUrl("appLogo", b.appLogoKey) || (m.useCompanyLogo === false ? undefined : assetUrl("logo", b.logoKey)),
    bannerUrl: assetUrl("appBanner", b.appBannerKey),
    primary: str(b.themeColor, "#2f5c24"),
    accent: str(b.accentColor, "#d9b52a"),
  };
}
