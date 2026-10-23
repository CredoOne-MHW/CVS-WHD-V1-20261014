/**
 * Sign-in (SSO) connectors — shared by the API and the UI.
 *
 * A company clicks Connect → reads the consent notice (DPDP Act, 2023) → signs in on the platform's own page
 * (facebook.com / linkedin.com / accounts.google.com) through Credovation's Platform App → picks Pages / ad accounts /
 * a sheet → leads flow. Companies never see or enter App IDs or secrets.
 */

export type SsoProvider = "meta" | "linkedin" | "google";
export type SsoType = "facebook_leads" | "instagram_leads" | "linkedin_leads" | "google_sheets";

export const SSO_TYPES: SsoType[] = ["facebook_leads", "instagram_leads", "linkedin_leads", "google_sheets"];
export const isSsoType = (t: string): t is SsoType => (SSO_TYPES as string[]).includes(t);

/** Bump when the notice text or purposes change — every consent records the version it was given against. */
export const CONSENT_VERSION = "2026-10-dpdp-v1";

export interface ConsentPurpose {
  key: string;
  label: string;
  detail: string;
}

export const PROVIDER_INFO: Record<SsoProvider, { label: string; site: string; appLabel: string; idLabel: string; secretLabel: string; console: string }> = {
  meta: { label: "Meta (Facebook & Instagram)", site: "facebook.com", appLabel: "Meta app", idLabel: "App ID", secretLabel: "App Secret", console: "https://developers.facebook.com/apps" },
  linkedin: { label: "LinkedIn", site: "linkedin.com", appLabel: "LinkedIn app", idLabel: "Client ID", secretLabel: "Client Secret", console: "https://www.linkedin.com/developers/apps" },
  google: { label: "Google", site: "accounts.google.com", appLabel: "Google OAuth client", idLabel: "Client ID", secretLabel: "Client Secret", console: "https://console.cloud.google.com/apis/credentials" },
};

export const SSO_INFO: Record<SsoType, { provider: SsoProvider; platform: string; pick: string; purposes: ConsentPurpose[] }> = {
  facebook_leads: {
    provider: "meta",
    platform: "Facebook",
    pick: "Facebook Pages",
    purposes: [
      { key: "read_leads", label: "Receive your Facebook Lead Ad submissions", detail: "Names, phone numbers, emails and answers people submit on your lead forms, to create and update leads." },
      { key: "list_pages", label: "List the Facebook Pages you manage", detail: "Page names and IDs, so you can choose which Pages send leads." },
      { key: "store_login", label: "Keep the Page connection securely", detail: "Page access is stored encrypted and used only to fetch leads. Disconnect at any time to delete it." },
    ],
  },
  instagram_leads: {
    provider: "meta",
    platform: "Instagram",
    pick: "Instagram accounts",
    purposes: [
      { key: "read_leads", label: "Receive your Instagram Lead Ad submissions", detail: "Names, phone numbers, emails and answers people submit on your Instagram lead forms." },
      { key: "list_pages", label: "List your Instagram professional accounts and their Facebook Pages", detail: "Account names and IDs, so you can choose which accounts send leads." },
      { key: "store_login", label: "Keep the connection securely", detail: "Access is stored encrypted and used only to fetch leads. Disconnect at any time to delete it." },
    ],
  },
  linkedin_leads: {
    provider: "linkedin",
    platform: "LinkedIn",
    pick: "ad accounts and Pages",
    purposes: [
      { key: "read_leads", label: "Receive your LinkedIn Lead Gen Form responses", detail: "Names, phone numbers, emails and answers people submit on your lead gen forms." },
      { key: "list_accounts", label: "List your ad accounts and LinkedIn Pages", detail: "Account and Page names, so you can choose which ones send leads." },
      { key: "store_login", label: "Keep the LinkedIn login securely", detail: "The login is stored encrypted and used only to fetch leads. Disconnect at any time to delete it." },
    ],
  },
  google_sheets: {
    provider: "google",
    platform: "Google",
    pick: "a Google Sheet",
    purposes: [
      { key: "read_sheet", label: "Read the Google Sheet you choose", detail: "Only rows of the sheet you pick (e.g. Google Form responses), read-only, to create leads." },
      { key: "store_login", label: "Keep the Google login securely", detail: "The login is stored encrypted and used only to read that sheet. Disconnect at any time to delete it." },
    ],
  },
};

/** Default platform contact for privacy / grievance questions — editable in Super Admin › Platform Apps. */
export const DEFAULT_PRIVACY_EMAIL = "support@credovation.tech";
