"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Power, BellRing, LogIn, Trash2, Search, Bot, MoreHorizontal, Globe2, ImagePlus, X, Building2, KeyRound, Palette } from "lucide-react";
import { api, qs, fmtDate } from "@/lib/api";
import { PageHeader, Btn, Modal, Field, Badge, Empty, Pager, Confirm, Spinner, useToast } from "@/components/ui";
import { usePerm } from "@/components/Shell";
import { Tabs } from "@/components/Logs";
import { DnsModal } from "@/components/DnsPanel";
import { themeVars, THEME_PRESETS } from "@shared/theme";
import { TemplatePicker } from "@/components/TemplatePicker";
import { LogoDisc } from "@/components/LogoDisc";
import { TemplateThumb, templateOf, LOGIN_TEMPLATES, type LoginBrand } from "@/components/LoginTemplates";
import { LayoutTemplate } from "lucide-react";

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
const BLANK = { name: "", code: "", contactPerson: "", phone: "", whatsapp: "", email: "", plan: "Trial", gstin: "", address: "", loginEmail: "", password: "", slug: "", customDomain: "", branding: { ...BLANK_BRANDING } };
type Kind = "logo" | "banner" | "favicon";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);

export default function Companies() {
  const [data, setData] = useState<any>(null);
  const [f, setF] = useState({ q: "", plan: "", status: "", page: 1 });
  const [plans, setPlans] = useState<string[]>(["Trial", "Standard", "Pro", "Enterprise"]);
  const [base, setBase] = useState("");
  const [form, setForm] = useState<any>(null);
  const [tab, setTab] = useState<"company" | "login" | "brand">("company");
  const [files, setFiles] = useState<Partial<Record<Kind, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<Kind, string>>>({});
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<any>(null);
  const [remMsg, setRemMsg] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "delete" | "status"; c: any } | null>(null);
  const [ai, setAi] = useState<{ c: any; agents: any[]; alloc: Record<string, number> } | null>(null);
  const [dns, setDns] = useState<{ c: any; fresh?: boolean } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const perm = usePerm("companies");
  const toast = useToast();

  const load = useCallback(() => api(`/sa/companies${qs(f)}`).then(setData), [f]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api("/sa/plans").then((r) => setPlans(r.plans.map((p: any) => p.name))).catch(() => {});
    api("/sa/knowledgebase/config").then((r) => setBase(r.baseDomain)).catch(() => {});
  }, []);

  function openForm(c?: any) {
    setTab("company");
    setFiles({});
    setSlugTouched(!!c);
    if (c) {
      api(`/sa/companies/${c._id}`).then((d) => {
        setForm({ ...BLANK, ...d, password: "", loginEmail: d.loginEmail || "", customDomain: d.customDomain || "", slug: d.slug || "", branding: { ...BLANK_BRANDING, ...(d.branding || {}), loginTemplate: templateOf({ ...(d.branding || {}), kind: "company" }) } });
        setPreviews({ logo: d.brandingPublic?.logoUrl, banner: d.brandingPublic?.bannerUrl, favicon: d.branding?.faviconKey ? d.brandingPublic?.faviconUrl : undefined });
      });
    } else {
      setForm({ ...BLANK, branding: { ...BLANK_BRANDING } });
      setPreviews({});
    }
  }

  const set = (k: string, v: any) =>
    setForm((p: any) => {
      const n = { ...p, [k]: v };
      if (k === "name" && !slugTouched) n.slug = slugify(v);
      if (k === "name" && !p.branding.shortName) n.branding = { ...p.branding };
      return n;
    });
  const setB = (k: string, v: any) => setForm((p: any) => ({ ...p, branding: { ...p.branding, [k]: v } }));
  const pick = (kind: Kind, file?: File | null) => {
    if (!file) return;
    setFiles((x) => ({ ...x, [kind]: file }));
    setPreviews((x) => ({ ...x, [kind]: URL.createObjectURL(file) }));
  };

  async function save() {
    setBusy(true);
    try {
      const body = { ...form, branding: { ...form.branding, shortName: form.branding.shortName || form.name } };
      for (const k of ["_id", "createdAt", "updatedAt", "deletedAt", "domain", "brandingPublic", "allocations", "leadCount", "connectors", "platformUrl", "customUrl", "status", "trialEndsAt", "s3Folder", "dbName", "dbReadyAt", "__v"]) delete body[k];
      if (!body.password) delete body.password;
      if (!body.slug) delete body.slug;
      for (const k of ["logoKey", "bannerKey", "faviconKey", "updatedAt"]) delete body.branding[k];
      const saved = form._id ? await api(`/sa/companies/${form._id}`, { method: "PUT", body }) : await api("/sa/companies", { body });
      const id = form._id || saved._id;
      for (const kind of Object.keys(files) as Kind[]) {
        const fd = new FormData();
        fd.append("file", files[kind]!);
        await api(`/sa/companies/${id}/brand-asset/${kind}`, { form: fd });
      }
      toast("ok", form._id ? "Company updated" : "Company created");
      const created = !form._id;
      setForm(null);
      load();
      if (created || (form.customDomain && form.customDomain !== saved.customDomain) || body.customDomain) setDns({ c: { _id: id, name: body.name }, fresh: created });
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openAi(c: any) {
    const [agents, detail] = await Promise.all([api("/sa/ai-agents"), api(`/sa/companies/${c._id}`)]);
    const alloc: Record<string, number> = {};
    for (const a of detail.allocations) alloc[a.agentId] = a.credits;
    setAi({ c, agents, alloc });
  }
  async function forceLogin(c: any) {
    try {
      const r = await api(`/auth/impersonate/${c._id}`, { method: "POST" });
      window.location.href = r.redirect;
    } catch (e: any) {
      toast("err", e.message);
    }
  }

  const previewBrand = useMemo<LoginBrand | null>(
    () =>
      form
        ? {
            kind: "company",
            name: form.name || "Company",
            shortName: form.branding.shortName || form.name || "Company",
            tagline: form.branding.tagline,
            headline: form.branding.headline,
            subheadline: form.branding.subheadline,
            footerText: form.branding.footerText,
            logoUrl: previews.logo,
            bannerUrl: previews.banner,
            supportEmail: form.branding.supportEmail,
            supportPhone: form.branding.supportPhone,
          }
        : null,
    [form, previews]
  );
  const previewVars = useMemo(() => (form ? themeVars(form.branding.themeColor || "#2f5c24", form.branding.accentColor || "#d9b52a") : {}), [form?.branding.themeColor, form?.branding.accentColor]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Company"
        subtitle="Tenants, their plans, branding and admin logins"
        actions={
          perm.create && (
            <Btn onClick={() => openForm()}>
              <Plus className="h-4 w-4" /> Create
            </Btn>
          )
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-400/15 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input w-64 pl-9" placeholder="Search name, code, email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
          </div>
          <select className="input w-auto" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value, page: 1 })} aria-label="Plan">
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr>
                {["Company", "Contact", "Login", "Plan", "Created On", "Status", "Action"].map((h) => (
                  <th key={h} className={`th ${h === "Action" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c: any) => (
                <tr key={c._id} className="hover:bg-hive-50/40">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: c.branding?.themeColor || "#2f5c24" }} aria-hidden />
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {c.name} <span className="mono ml-1 text-ink-400">{c.code}</span>
                        </p>
                        {(c.customUrl || c.platformUrl) && (
                          <a href={c.customUrl || c.platformUrl} target="_blank" rel="noreferrer" className="block truncate font-mono text-[12px] text-hive-700 hover:underline">
                            {(c.customUrl || c.platformUrl).replace("https://", "")}
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <p>{c.contactPerson || "—"}</p>
                    <p className="text-xs text-ink-500">{c.whatsapp ? `WA ${c.whatsapp}` : c.phone || ""}</p>
                  </td>
                  <td className="td text-ink-700">{c.loginEmail || "—"}</td>
                  <td className="td">
                    <Badge color="honey">{c.plan}</Badge>
                  </td>
                  <td className="td whitespace-nowrap text-ink-500">{fmtDate(c.createdAt, false)}</td>
                  <td className="td">
                    <Badge color={c.status === "active" ? "green" : "red"}>{c.status === "active" ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-0.5">
                      {perm.update && (
                        <button className="btn-ghost" title="Edit" aria-label="Edit" onClick={() => openForm(c)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {perm.update && (
                        <button className="btn-ghost" title="Reminder" aria-label="Reminder" onClick={() => (setReminder(c), setRemMsg(`Dear ${c.contactPerson || c.name},\n`))}>
                          <BellRing className="h-4 w-4" />
                        </button>
                      )}
                      {perm.update && c.status === "active" && (
                        <button className="btn-ghost" title="Force Login" aria-label="Force Login" onClick={() => forceLogin(c)}>
                          <LogIn className="h-4 w-4" />
                        </button>
                      )}
                      <button className="btn-ghost" title="Domain & DNS" aria-label="Domain and DNS" onClick={() => setDns({ c })}>
                        <Globe2 className="h-4 w-4" />
                      </button>
                      <div className="relative">
                        <button className="btn-ghost" aria-label="More actions" onClick={() => setMenu(menu === c._id ? null : c._id)}>
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menu === c._id && (
                          <div className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-2xl border border-ink-400/15 bg-white py-1.5 shadow-lift" onMouseLeave={() => setMenu(null)}>
                            {perm.update && (
                              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-hive-50" onClick={() => (setMenu(null), openAi(c))}>
                                <Bot className="h-4 w-4" /> AI Agents & credits
                              </button>
                            )}
                            {perm.update && (
                              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-hive-50" onClick={() => (setMenu(null), setConfirm({ kind: "status", c }))}>
                                <Power className="h-4 w-4" /> {c.status === "active" ? "Deactivate" : "Activate"}
                              </button>
                            )}
                            {perm.delete && (
                              <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => (setMenu(null), setConfirm({ kind: "delete", c }))}>
                                <Trash2 className="h-4 w-4" /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && (
            <div className="flex justify-center py-16 text-hive-700">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {data && !data.items.length && <Empty title="No companies yet" hint="Create the first tenant to get started." />}
        </div>
        {data?.total > 0 && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </div>

      {/* Create / Edit */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? `Edit · ${form.name}` : "Create company"}
        size="xl"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Btn>
            <Btn loading={busy} onClick={save}>
              {form?._id ? "Save changes" : "Create company"}
            </Btn>
          </>
        }
      >
        {form && (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "company", label: "Company details" },
                { key: "login", label: "Login credentials" },
                { key: "brand", label: "Branding & domain" },
              ]}
            />
            {tab === "company" && (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Company name" required>
                  <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field
                  label="Company code"
                  required
                  hint={
                    form._id
                      ? `Database: ${form.dbName || form.code} (fixed${form.dbReadyAt ? "" : " — moves on first use"})`
                      : `Also the name of this company's own database${form.code ? `: ${form.code.toUpperCase()}` : ""}. Letters, numbers, - and _; can't be reused.`
                  }
                >
                  <input className="input uppercase" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
                </Field>
                <Field label="Contact person">
                  <input className="input" value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className="input" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label="WhatsApp" hint="10-digit number, omit +91">
                  <input className="input" inputMode="numeric" maxLength={10} value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label="Company email" required>
                  <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field label="Plan">
                  <select className="input" value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                    {plans.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="GSTIN">
                  <input className="input uppercase" maxLength={15} value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
                </Field>
                <Field label="Address" className="sm:col-span-2">
                  <textarea className="input min-h-[70px]" value={form.address} onChange={(e) => set("address", e.target.value)} />
                </Field>
              </div>
            )}
            {tab === "login" && (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-2xl bg-hive-50/70 p-4 sm:col-span-2">
                  <KeyRound className="mt-0.5 h-5 w-5 text-hive-700" />
                  <p className="text-sm text-ink-700">The company admin signs in at their own branded URL. They can add their team under Settings › Role Management.</p>
                </div>
                <Field label="Login email" hint="Defaults to company email">
                  <input className="input" type="email" placeholder={form.email} value={form.loginEmail} onChange={(e) => set("loginEmail", e.target.value)} />
                </Field>
                <Field label="Password" required={!form._id} hint={form._id ? "Leave blank to keep the current password" : "Min 8 characters"}>
                  <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
                </Field>
              </div>
            )}
            {tab === "brand" && (
              <div className="grid gap-7 lg:grid-cols-[1fr_420px]">
                <div className="space-y-7">
                  <section>
                    <h3 className="mb-3 flex items-center gap-2 font-bold">
                      <Globe2 className="h-4 w-4 text-hive-700" /> Web address
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Platform address" required hint="Made from the company name, e.g. sini-labs-technologies-llp — the support page is this address + /support">
                        <div className="flex overflow-hidden rounded-xl border border-ink-400/25 bg-white focus-within:border-hive-500 focus-within:ring-4 focus-within:ring-hive-100">
                          <input
                            className="min-w-0 flex-1 px-3.5 py-2.5 text-sm outline-none"
                            value={form.slug}
                            onChange={(e) => {
                              setSlugTouched(true);
                              set("slug", slugify(e.target.value));
                            }}
                          />
                          <span className="flex items-center whitespace-nowrap border-l border-ink-400/15 bg-hive-50 px-3 font-mono text-xs text-ink-500">.{base || "base-domain"}</span>
                        </div>
                      </Field>
                      <Field label="Company’s own domain" hint="Optional, e.g. leads.wellnesshive.in — DNS records appear after saving">
                        <input className="input font-mono" placeholder="leads.yourcompany.com" value={form.customDomain} onChange={(e) => set("customDomain", e.target.value.trim().toLowerCase())} />
                      </Field>
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 font-bold">
                      <ImagePlus className="h-4 w-4 text-hive-700" /> Images
                    </h3>
                    <p className="-mt-1 mb-3 text-xs text-ink-500">
                      Stored in S3 under <span className="mono">{form.s3Folder || form.name || "<Company name>"}/logo</span> and{" "}
                      <span className="mono">{form.s3Folder || form.name || "<Company name>"}/banner</span>; AI knowledge files go to{" "}
                      <span className="mono">…/brain</span>.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                      {(
                        [
                          ["logo", "Company logo", "PNG/SVG · shown in a circle, fitted whole"],
                          ["banner", "Side banner", "1600×1800 JPG/WebP"],
                          ["favicon", "Favicon", "Optional · 64 px"],
                        ] as [Kind, string, string][]
                      ).map(([kind, label, hint]) => (
                        <div key={kind}>
                          <p className="label">{label}</p>
                          <label className="group relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-ink-400/25 bg-[#fafbf9] text-center transition hover:border-hive-400 hover:bg-hive-50">
                            {previews[kind] && kind === "logo" ? (
                              <LogoDisc src={previews[kind]} name={form.name} size="72%" />
                            ) : previews[kind] ? (
                              <img src={previews[kind]} alt="" className={`h-full w-full ${kind === "banner" ? "object-cover" : "object-contain p-4"}`} />
                            ) : (
                              <>
                                <ImagePlus className="h-6 w-6 text-ink-400 group-hover:text-hive-600" />
                                <span className="mt-1.5 px-2 text-[11.5px] text-ink-500">{hint}</span>
                              </>
                            )}
                            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" className="sr-only" onChange={(e) => pick(kind, e.target.files?.[0])} />
                          </label>
                          {previews[kind] && (
                            <button
                              type="button"
                              className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-red-600"
                              onClick={async () => {
                                if (form._id && !files[kind]) await api(`/sa/companies/${form._id}/brand-asset/${kind}`, { method: "DELETE" });
                                setFiles((x) => ({ ...x, [kind]: undefined }));
                                setPreviews((x) => ({ ...x, [kind]: undefined }));
                              }}
                            >
                              <X className="h-3.5 w-3.5" /> Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 font-bold">
                      <Palette className="h-4 w-4 text-hive-700" /> Theme
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Theme color" hint="Sidebar, buttons, charts and login — the whole app">
                        <div className="flex items-center gap-2">
                          <input type="color" aria-label="Theme color" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={form.branding.themeColor} onChange={(e) => setB("themeColor", e.target.value)} />
                          <input className="input font-mono" value={form.branding.themeColor} onChange={(e) => setB("themeColor", e.target.value)} />
                        </div>
                        <div className="mt-2 flex gap-1.5">
                          {THEME_PRESETS.map((c) => (
                            <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => setB("themeColor", c)} className={`h-7 w-7 rounded-full ring-offset-2 ${form.branding.themeColor === c ? "ring-2 ring-ink-900" : ""}`} style={{ background: c }} />
                          ))}
                        </div>
                      </Field>
                      <Field label="Accent color" hint="Highlights and badges">
                        <div className="flex items-center gap-2">
                          <input type="color" aria-label="Accent color" className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={form.branding.accentColor} onChange={(e) => setB("accentColor", e.target.value)} />
                          <input className="input font-mono" value={form.branding.accentColor} onChange={(e) => setB("accentColor", e.target.value)} />
                        </div>
                      </Field>
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-1 flex items-center gap-2 font-bold">
                      <LayoutTemplate className="h-4 w-4 text-hive-700" /> Login page design
                    </h3>
                    <p className="mb-3 text-xs text-ink-500">10 designs, each shown with this company’s logo, colours and texts. The company’s login page uses the one you pick.</p>
                    <TemplatePicker value={form.branding.loginTemplate} onChange={(k) => setB("loginTemplate", k)} brand={previewBrand!} vars={previewVars as any} />
                  </section>

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 font-bold">
                      <Building2 className="h-4 w-4 text-hive-700" /> Login page text
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Display name">
                        <input className="input" placeholder={form.name} value={form.branding.shortName} onChange={(e) => setB("shortName", e.target.value)} />
                      </Field>
                      <Field label="Company tagline">
                        <input className="input" placeholder="Diagnostic Centre · Polyclinic · Elder Care" value={form.branding.tagline} onChange={(e) => setB("tagline", e.target.value)} />
                      </Field>
                      <Field label="Headline" className="sm:col-span-2">
                        <input className="input" value={form.branding.headline} onChange={(e) => setB("headline", e.target.value)} />
                      </Field>
                      <Field label="Sub-headline" className="sm:col-span-2">
                        <textarea className="input min-h-[70px]" value={form.branding.subheadline} onChange={(e) => setB("subheadline", e.target.value)} />
                      </Field>
                      <Field label="Support email" hint="Shown under the sign-in form">
                        <input className="input" type="email" value={form.branding.supportEmail} onChange={(e) => setB("supportEmail", e.target.value)} />
                      </Field>
                      <Field label="Support phone">
                        <input className="input" value={form.branding.supportPhone} onChange={(e) => setB("supportPhone", e.target.value)} />
                      </Field>
                      <Field label="Footer text" className="sm:col-span-2">
                        <input className="input" placeholder={`© ${new Date().getFullYear()} ${form.name || "Company"}`} value={form.branding.footerText} onChange={(e) => setB("footerText", e.target.value)} />
                      </Field>
                    </div>
                  </section>
                </div>

                {/* Live preview of the company login: the chosen design, themed with the chosen colours */}
                <div className="lg:sticky lg:top-0 lg:self-start">
                  <p className="label">Live preview · {LOGIN_TEMPLATES.find((t) => t.key === form.branding.loginTemplate)?.name || "login page"}</p>
                  <div style={previewVars as any} className="overflow-hidden rounded-2xl border border-ink-400/15 shadow-lift">
                    <TemplateThumb template={form.branding.loginTemplate} b={previewBrand!} />
                  </div>
                  <p className="mt-3 break-all font-mono text-xs text-ink-500">
                    https://{form.customDomain || `${form.slug || "short-name"}.${base || "base-domain"}`}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Reminder */}
      <Modal
        open={!!reminder}
        onClose={() => setReminder(null)}
        title={`Reminder · ${reminder?.name || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setReminder(null)}>
              Cancel
            </Btn>
            <Btn
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api(`/sa/companies/${reminder._id}/reminder`, { body: { message: remMsg } });
                  toast(r.sent ? "ok" : "err", r.sent ? `Sent to ${reminder.whatsapp || reminder.phone}` : r.reason || "Send failed — see WhatsApp Logs");
                  if (r.sent) setReminder(null);
                } catch (e: any) {
                  toast("err", e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send on WhatsApp
            </Btn>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-500">Goes to {reminder?.whatsapp || reminder?.phone || "—"} via the active “Company reminder” webhook(s).</p>
        <textarea className="input min-h-[150px]" value={remMsg} onChange={(e) => setRemMsg(e.target.value)} />
      </Modal>

      {/* AI allocation */}
      <Modal
        open={!!ai}
        onClose={() => setAi(null)}
        title={`AI Agents · ${ai?.c.name || ""}`}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setAi(null)}>
              Cancel
            </Btn>
            <Btn
              onClick={async () => {
                try {
                  await api(`/sa/companies/${ai!.c._id}/ai`, { method: "PUT", body: Object.entries(ai!.alloc).map(([agentId, credits]) => ({ agentId, credits })) });
                  toast("ok", "Credits allocated");
                  setAi(null);
                } catch (e: any) {
                  toast("err", e.message);
                }
              }}
            >
              Save allocation
            </Btn>
          </>
        }
      >
        {ai && !ai.agents.length && <Empty title="No AI agents defined" hint="Create one under AI Agents first." />}
        <div className="space-y-3">
          {ai?.agents.map((a: any) => (
            <div key={a._id} className="flex items-center justify-between gap-4 rounded-xl border border-ink-400/15 p-3">
              <div>
                <p className="font-semibold">{a.name}</p>
                <p className="text-xs text-ink-500">
                  {a.provider} · {a.llmVersion} · default {a.credits} credits
                </p>
              </div>
              <input type="number" min={0} className="input w-32" placeholder="0" aria-label={`Credits for ${a.name}`} value={ai.alloc[a._id] ?? ""} onChange={(e) => setAi({ ...ai, alloc: { ...ai.alloc, [a._id]: Number(e.target.value) } })} />
            </div>
          ))}
        </div>
      </Modal>

      <DnsModal company={dns?.c || null} fresh={dns?.fresh} onClose={() => setDns(null)} />

      <Confirm
        open={!!confirm}
        danger={confirm?.kind === "delete" || confirm?.c.status === "active"}
        title={confirm?.kind === "delete" ? "Delete company?" : confirm?.c.status === "active" ? "Deactivate company?" : "Activate company?"}
        body={confirm?.kind === "delete" ? `${confirm.c.name} and its logins will be removed. Leads are retained for audit but no longer accessible.` : confirm?.c.status === "active" ? `All users of ${confirm?.c.name} will be signed out and blocked from logging in.` : `${confirm?.c.name} users will be able to log in again.`}
        confirmLabel={confirm?.kind === "delete" ? "Delete" : confirm?.c.status === "active" ? "Deactivate" : "Activate"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            if (confirm!.kind === "delete") await api(`/sa/companies/${confirm!.c._id}`, { method: "DELETE" });
            else await api(`/sa/companies/${confirm!.c._id}/status`, { body: { status: confirm!.c.status === "active" ? "inactive" : "active" } });
            toast("ok", "Done");
            load();
          } catch (e: any) {
            toast("err", e.message);
          }
        }}
      />
    </>
  );
}
