"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogIn, ExternalLink, Power, Save, Smartphone, ShieldCheck, FileText, Loader2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Btn, Badge, Spinner, Confirm, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { LogoDisc } from "@/components/LogoDisc";
import { ModuleAccessGrid } from "@/components/ModuleAccess";
import { templateOf, type LoginBrand } from "@/components/LoginTemplates";
import { OverviewTab, DetailsTab, SubscriptionTab, LoginTab, MobileModulesTab } from "@/components/sa/CompanyTabs";
import { BrandingTab, WhiteLabelTab, type Kind } from "@/components/sa/CompanyBranding";
import { RoleAccessTab, CronTab, RetentionTab, NotificationsTab } from "@/components/sa/CompanyOps";
import { Dpdp } from "@/components/Dpdp";
import { WebsiteTab } from "@/components/sa/CompanyWebsite";
import { MobileAppTab } from "@/components/sa/CompanyMobile";
import { COMPANY_MODULES } from "@shared/constants";

const BLANK_BRANDING = {
  shortName: "",
  tagline: "",
  headline: "Every enquiry, captured. Every follow-up, on time.",
  subheadline: "Website, WhatsApp, Meta and Google ads, calls and walk-ins land in one pipeline — qualified, routed and tracked to conversion.",
  footerText: "",
  themeColor: "#2f5c24",
  accentColor: "#d9b52a",
  loginLayout: "split",
  loginTemplate: "classic",
  supportEmail: "",
  supportPhone: "",
};

/** The tabs, in the order Super Admin works through a company. */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "details", label: "Company details" },
  { key: "subscription", label: "Subscription" },
  { key: "login", label: "Login credentials" },
  { key: "branding", label: "Branding & domain" },
  { key: "whitelabel", label: "White label" },
  { key: "roles", label: "Role access" },
  { key: "modules", label: "Modules" },
  { key: "mobile", label: "Mobile Modules" },
  { key: "notifications", label: "Notifications" },
  { key: "cron", label: "Cron Jobs" },
  { key: "retention", label: "Retention Policy" },
  { key: "dpdp", label: "DPDP" },
  { key: "mobileapp", label: "Mobile App" },
  { key: "website", label: "Website" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Tabs whose own screens arrive in a later release — shown, named and explained rather than hidden. */
const COMING: Partial<Record<TabKey, { icon: any; title: string; body: string }>> = {
};

export default function CompanyWorkspace() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const router = useRouter();
  const perm = usePerm("companies");
  const toast = useToast();

  const [form, setForm] = useState<any>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [plans, setPlans] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [files, setFiles] = useState<Partial<Record<Kind, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<Kind, string>>>({});
  const [slugTouched, setSlugTouched] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<"status" | null>(null);

  const load = useCallback(() => {
    return api(`/sa/companies/${id}`).then((d) => {
      setForm({ ...d, password: "", branding: { ...BLANK_BRANDING, ...(d.branding || {}), loginTemplate: templateOf({ ...(d.branding || {}), kind: "company" }) } });
      setPreviews({ logo: d.brandingPublic?.logoUrl, banner: d.brandingPublic?.bannerUrl, favicon: d.branding?.faviconKey ? d.brandingPublic?.faviconUrl : undefined });
      setFiles({});
      setDirty(false);
    });
  }, [id]);

  useEffect(() => {
    load().catch(() => toast("err", "Could not open this company"));
    api("/sa/plans").then((r) => setPlans(r.plans.map((p: any) => p.name))).catch(() => {});
    api("/sa/knowledgebase/config").then((r) => setBase(r.baseDomain)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = useCallback((k: string, v: any) => {
    setDirty(true);
    setForm((p: any) => ({ ...p, [k]: v }));
  }, []);
  const setB = useCallback((k: string, v: any) => {
    setDirty(true);
    setForm((p: any) => ({ ...p, branding: { ...p.branding, [k]: v } }));
  }, []);
  /** Says no to an image the upload would refuse, now, rather than after it has been sent. */
  const pick = (kind: Kind, file?: File | null) => {
    if (!file) return;
    const MAX_MB = 8;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast("err", `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The most an image can be is ${MAX_MB} MB — save it smaller and pick it again.`);
      return;
    }
    if (!/^image\/(png|jpe?g|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(file.type)) {
      toast("err", `${file.name} is not an image this accepts. Use PNG, JPG, WebP, SVG or ICO.`);
      return;
    }
    setDirty(true);
    setFiles((x) => ({ ...x, [kind]: file }));
    setPreviews((x) => ({ ...x, [kind]: URL.createObjectURL(file) }));
  };
  const removeImage = async (kind: Kind) => {
    if (!files[kind]) await api(`/sa/companies/${id}/brand-asset/${kind}`, { method: "DELETE" }).catch(() => {});
    setFiles((x) => ({ ...x, [kind]: undefined }));
    setPreviews((x) => ({ ...x, [kind]: undefined }));
  };

  const previewBrand = useMemo<LoginBrand>(
    () => ({
      kind: "company",
      name: form?.name || "Company",
      shortName: form?.branding?.shortName || form?.name || "Company",
      tagline: form?.branding?.tagline,
      headline: form?.branding?.headline,
      subheadline: form?.branding?.subheadline,
      footerText: form?.branding?.footerText,
      logoUrl: previews.logo,
      bannerUrl: previews.banner,
      supportEmail: form?.branding?.supportEmail,
      supportPhone: form?.branding?.supportPhone,
    }),
    [form, previews]
  );

  async function save() {
    setBusy(true);
    try {
      const body: any = { ...form, branding: { ...form.branding, shortName: form.branding.shortName || form.name } };
      for (const k of ["_id", "createdAt", "updatedAt", "deletedAt", "domain", "brandingPublic", "allocations", "leadCount", "connectors", "platformUrl", "customUrl", "trialEndsAt", "s3Folder", "s3CreatedAt", "s3", "dbName", "dbReadyAt", "__v", "slugAliases", "lastScheduledKey", "cron", "retention", "subAmount", "subFrequency", "subDueDate", "subDiscountType", "subDiscountValue"]) delete body[k];
      body.s3Enabled = form.s3Enabled !== false;
      if (!body.password) delete body.password;
      if (!body.slug) delete body.slug;
      for (const k of ["logoKey", "bannerKey", "faviconKey", "updatedAt", "sounds"]) delete body.branding[k];
      await api(`/sa/companies/${id}`, { method: "PUT", body });
      // the details save first and are already kept; an image that fails must say WHICH one, or the person
      // is left guessing between three uploads
      const failed: string[] = [];
      for (const kind of Object.keys(files) as Kind[]) {
        if (!files[kind] || form.s3Enabled === false) continue;
        const fd = new FormData();
        fd.append("file", files[kind]!);
        try {
          await api(`/sa/companies/${id}/brand-asset/${kind}`, { form: fd });
        } catch (e: any) {
          failed.push(`${kind}: ${e?.message || "upload failed"}`);
        }
      }
      if (failed.length) toast("err", `Details saved. ${failed.join(" · ")}`);
      else toast("ok", "Saved");
      await load();
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function forceLogin() {
    try {
      const r = await api(`/auth/impersonate/${id}`, { method: "POST" });
      window.location.href = r.redirect;
    } catch (e: any) {
      toast("err", e.message);
    }
  }

  if (!form)
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const url = form.customUrl || form.platformUrl;
  const Coming = COMING[tab];

  return (
    <>
      <Link href="/sa/companies" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-ink-500 hover:text-hive-700">
        <ArrowLeft className="h-4 w-4" /> All companies
      </Link>

      {/* Header — who this is, and the actions that act on the whole company */}
      <div className="card mb-4 flex flex-wrap items-start gap-4 p-4">
        <LogoDisc src={previews.logo} name={form.name} size="56px" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
            {form.name}
            <Badge color={form.status === "active" ? "green" : "red"}>{form.status === "active" ? "active" : "inactive"}</Badge>
            <Badge color="honey">{form.plan}</Badge>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
            <span className="mono">{form.code}</span>
            {form.loginEmail && <span>{form.loginEmail}</span>}
            <span>Created {fmtDate(form.createdAt, false)}</span>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-hive-700 hover:underline">
                {url.replace("https://", "")} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perm.update && form.status === "active" && (
            <Btn type="button" variant="secondary" onClick={forceLogin}>
              <LogIn className="h-4 w-4" /> Force login
            </Btn>
          )}
          {url && (
            <a className="btn-secondary inline-flex items-center gap-2" href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> Login page
            </a>
          )}
          {perm.update && (
            <Btn type="button" variant={form.status === "active" ? "danger" : "secondary"} onClick={() => setConfirm("status")}>
              <Power className="h-4 w-4" /> {form.status === "active" ? "Suspend" : "Activate"}
            </Btn>
          )}
          {perm.update && (
            <Btn type="button" onClick={save} loading={busy} disabled={!dirty} title={dirty ? "" : "No changes to save"}>
              <Save className="h-4 w-4" /> Save changes
            </Btn>
          )}
        </div>
      </div>

      {/* Tabs — one row, scrollable sideways on a narrow screen */}
      <div className="mb-5 overflow-x-auto border-b border-ink-400/15">
        <div className="flex min-w-max gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ${tab === t.key ? "border-b-2 border-hive-700 text-hive-900" : "border-b-2 border-transparent text-ink-500 hover:text-ink-900"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {dirty && tab !== "overview" && (
        <p className="mb-3 rounded-xl bg-honey-500/10 px-3 py-2 text-xs font-semibold text-ink-700">Unsaved changes on this page — press <b>Save changes</b> above. Role access, Cron Jobs and Retention Policy save on their own.</p>
      )}

      <div className="card p-5">
        {tab === "overview" && <OverviewTab id={id} company={form} />}
        {tab === "details" && <DetailsTab form={form} set={set} plans={plans} />}
        {tab === "subscription" && <SubscriptionTab form={form} set={set} plans={plans} id={id} />}
        {tab === "login" && <LoginTab form={form} set={set} />}
        {tab === "branding" && (
          <BrandingTab id={id} form={form} set={set} setB={setB} base={base} previews={previews} pick={pick} removeImage={removeImage} previewBrand={previewBrand} slugTouched={slugTouched} setSlugTouched={setSlugTouched} />
        )}
        {tab === "whitelabel" && <WhiteLabelTab form={form} set={set} />}
        {tab === "roles" && <RoleAccessTab id={id} companyName={form.name} />}
        {tab === "modules" && <ModuleAccessGrid plan={form.plan} value={form.moduleAccess || {}} onChange={(v) => set("moduleAccess", v)} disabled={!perm.update} />}
        {tab === "mobile" && <MobileModulesTab form={form} set={set} modules={COMPANY_MODULES} />}
        {tab === "notifications" && <NotificationsTab id={id} form={form} set={set} />}
        {tab === "cron" && <CronTab id={id} companyName={form.name} />}
        {tab === "retention" && <RetentionTab id={id} companyName={form.name} />}
        {tab === "dpdp" && <Dpdp base={`/sa/companies/${id}`} canEdit={perm.update} />}
        {tab === "website" && <WebsiteTab id={id} />}
        {tab === "mobileapp" && <MobileAppTab id={id} canEdit={perm.update} />}
        {Coming && (
          <div className="mx-auto max-w-xl py-12 text-center">
            <Coming.icon className="mx-auto h-10 w-10 text-hive-700" />
            <h3 className="mt-3 text-lg font-bold">{Coming.title}</h3>
            <p className="mt-2 text-sm text-ink-500">{Coming.body}</p>
          </div>
        )}
      </div>

      <Confirm
        open={confirm === "status"}
        danger={form.status === "active"}
        title={form.status === "active" ? "Suspend company?" : "Activate company?"}
        body={form.status === "active" ? `All users of ${form.name} will be signed out and blocked from signing in. Its data is kept.` : `${form.name} users will be able to sign in again.`}
        confirmLabel={form.status === "active" ? "Suspend" : "Activate"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await api(`/sa/companies/${id}/status`, { body: { status: form.status === "active" ? "inactive" : "active" } });
            toast("ok", "Done");
            await load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </>
  );
}
