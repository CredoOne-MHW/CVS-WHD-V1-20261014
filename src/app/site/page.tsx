"use client";
/**
 * The company's public website.
 *
 * Every section is drawn from the same registry the builder uses, so a section added there appears here
 * without a change to this file, and nothing is written for one trade. The enquiry form creates a lead.
 * The cookie banner and the DPDP consent link are part of the page, not an afterthought.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Menu, X, Phone, Mail, MapPin, Clock, Check, ExternalLink, ShieldCheck, Cookie, Quote, ArrowRight } from "lucide-react";
import { applyTheme } from "@shared/theme";
import { sectionOn, sectionData } from "@shared/site";

const VISITOR_KEY = "credoone.visitor";
const COOKIE_KEY = "credoone.cookies";
function visitorId() {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return `v_${Math.random().toString(36).slice(2)}`;
  }
}

export default function SitePage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [menu, setMenu] = useState(false);
  const qs = typeof window === "undefined" ? "" : window.location.search;
  const params = useMemo(() => new URLSearchParams(qs), [qs]);

  useEffect(() => {
    const c = params.get("c");
    const preview = params.get("preview");
    fetch(`/api/public/site?${new URLSearchParams({ ...(c ? { c } : {}), ...(preview ? { preview } : {}) })}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || "Not found")))))
      .then((x) => {
        setD(x);
        applyTheme(x.company.themeColor, x.company.accentColor);
        document.title = sectionData(x.site, "seo").title || x.company.name;
      })
      .catch((e) => setErr(e.message));
  }, [params]);

  if (err)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] p-6 text-center">
        <p className="max-w-md text-ink-500">{err}</p>
      </main>
    );
  if (!d)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] text-hive-700">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );

  const site = d.site;
  const on = (k: string) => sectionOn(site, k);
  const s = (k: string) => sectionData(site, k);
  const company = d.company;
  const design = s("design");
  const round = design.corners === "Square" ? "rounded-none" : design.corners === "Soft" ? "rounded-xl" : "rounded-3xl";

  return (
    <main className="min-h-screen bg-white text-ink-900" style={{ fontFamily: `"${design.font || "Plus Jakarta Sans"}", system-ui, sans-serif` }}>
      {on("announcement") && s("announcement").text && (
        <a href={s("announcement").href || "#"} className="block px-4 py-2 text-center text-sm font-semibold text-white" style={{ background: s("announcement").background || "rgb(var(--brand-700, 47 92 36))" }}>
          {s("announcement").text}
        </a>
      )}

      {/* menu */}
      <header className="sticky top-0 z-30 border-b border-ink-400/10 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <a href="#top" className="flex min-w-0 items-center gap-2.5">
            {s("menu").showLogo !== false && company.logoUrl && <img src={company.logoUrl} alt="" className="h-9 w-9 rounded-full object-contain" />}
            <span className="truncate font-bold">{company.shortName || company.name}</span>
          </a>
          <div className="ml-auto hidden items-center gap-6 md:flex">
            {(s("menu").items || []).map((m: any, i: number) => (
              <a key={i} href={m.href || "#"} className="text-sm font-semibold text-ink-600 hover:text-hive-700">
                {m.label}
              </a>
            ))}
            {s("menu").ctaLabel && (
              <a href={s("menu").ctaHref || "#enquiry"} className="rounded-xl bg-hive-700 px-4 py-2 text-sm font-bold text-white hover:bg-hive-900">
                {s("menu").ctaLabel}
              </a>
            )}
          </div>
          <button className="ml-auto md:hidden" aria-label="Menu" onClick={() => setMenu(!menu)}>
            {menu ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </nav>
        {menu && (
          <div className="border-t border-ink-400/10 px-5 py-3 md:hidden">
            {(s("menu").items || []).map((m: any, i: number) => (
              <a key={i} href={m.href || "#"} onClick={() => setMenu(false)} className="block py-2 font-semibold text-ink-700">
                {m.label}
              </a>
            ))}
          </div>
        )}
      </header>

      <div id="top" />

      {/* hero */}
      {on("hero") && (
        <section className="relative overflow-hidden">
          {s("hero").image && <img src={s("hero").image} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {s("hero").image && <div className="absolute inset-0 bg-ink-900" style={{ opacity: parseInt(s("hero").darken || "50") / 100 }} />}
          <div className={`relative mx-auto max-w-6xl px-5 ${s("hero").image ? "py-28 text-white" : "py-20"}`}>
            {s("hero").eyebrow && <p className="mb-2 text-sm font-bold uppercase tracking-widest opacity-80">{s("hero").eyebrow}</p>}
            <h1 className="max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">{s("hero").title || company.name}</h1>
            {s("hero").subtitle && <p className={`mt-4 max-w-2xl text-lg ${s("hero").image ? "opacity-90" : "text-ink-600"}`}>{s("hero").subtitle}</p>}
            <div className="mt-7 flex flex-wrap gap-3">
              {s("hero").button1 && (
                <a href={s("hero").button1Href || "#enquiry"} className="rounded-2xl bg-hive-700 px-6 py-3 font-bold text-white hover:bg-hive-900">
                  {s("hero").button1}
                </a>
              )}
              {s("hero").button2 && (
                <a href={s("hero").button2Href || "#contact"} className={`rounded-2xl px-6 py-3 font-bold ${s("hero").image ? "bg-white/15 text-white hover:bg-white/25" : "border border-ink-400/25 hover:bg-hive-50"}`}>
                  {s("hero").button2}
                </a>
              )}
            </div>
          </div>
          {s("hero").quote && <p className="bg-hive-50 px-5 py-4 text-center text-sm font-semibold italic text-ink-700">{s("hero").quote}</p>}
        </section>
      )}

      {/* story */}
      {on("story") && (s("story").body || s("story").image) && (
        <Band id="about">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <H2>{s("story").title || "Who we are"}</H2>
              <p className="mt-3 whitespace-pre-line text-ink-600">{s("story").body}</p>
            </div>
            {s("story").image && <img src={s("story").image} alt="" className={`${round} w-full object-cover`} />}
          </div>
        </Band>
      )}

      {/* what we do */}
      {on("highlights") && (s("highlights").items || []).length > 0 && (
        <Band id="services" tint>
          <H2>{s("highlights").title || "What we do"}</H2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(s("highlights").items || []).map((x: any, i: number) => (
              <div key={i} className={`${round} border border-ink-400/15 bg-white p-5`}>
                <h3 className="font-bold">{x.title}</h3>
                <p className="mt-1.5 text-sm text-ink-600">{x.text}</p>
              </div>
            ))}
          </div>
        </Band>
      )}

      {/* featured */}
      {on("featured") && (
        <Band>
          <H2>{s("featured").title || "Popular with our customers"}</H2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(s("featured").fromServices ? (d.services || []).map((n: string) => ({ name: n })) : s("featured").items || []).map((x: any, i: number) => (
              <div key={i} className={`${round} overflow-hidden border border-ink-400/15`}>
                {x.image && <img src={x.image} alt="" className="h-40 w-full object-cover" />}
                <div className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-bold">{x.name}</h3>
                    {x.price && <span className="font-bold text-hive-700">{x.price}</span>}
                  </div>
                  {x.text && <p className="mt-1 text-sm text-ink-600">{x.text}</p>}
                </div>
              </div>
            ))}
          </div>
        </Band>
      )}

      {/* offers */}
      {on("offers") && (s("offers").items || []).length > 0 && (
        <Band tint>
          <H2>{s("offers").title || "Offers"}</H2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {(s("offers").items || []).map((x: any, i: number) => (
              <div key={i} className={`${round} border border-honey-500/40 bg-white p-5`}>
                <h3 className="font-bold">{x.name}</h3>
                <p className="mt-1 text-sm text-ink-600">{x.text}</p>
                {x.until && <p className="mt-2 text-xs font-semibold text-honey-700">Valid until {x.until}</p>}
              </div>
            ))}
          </div>
        </Band>
      )}

      {/* testimonials */}
      {on("testimonials") && (s("testimonials").items || []).length > 0 && (
        <Band>
          <H2>{s("testimonials").title || "What our customers say"}</H2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(s("testimonials").items || []).map((x: any, i: number) => (
              <figure key={i} className={`${round} border border-ink-400/15 p-5`}>
                <Quote className="h-5 w-5 text-hive-700" />
                <blockquote className="mt-2 text-sm text-ink-700">{x.quote}</blockquote>
                <figcaption className="mt-3 text-xs font-semibold text-ink-500">
                  {x.name}
                  {x.role ? ` · ${x.role}` : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        </Band>
      )}

      {/* gallery */}
      {on("gallery") && (s("gallery").images || []).length > 0 && (
        <Band tint>
          <H2>{s("gallery").title || "A look around"}</H2>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {(s("gallery").images || []).map((x: any, i: number) => (
              <figure key={i}>
                <img src={x.url} alt={x.caption || ""} className={`${round} h-40 w-full object-cover`} />
                {x.caption && <figcaption className="mt-1 text-xs text-ink-500">{x.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </Band>
      )}

      {/* FAQ */}
      {on("faq") && (s("faq").items || []).length > 0 && (
        <Band>
          <H2>{s("faq").title || "Questions we are asked"}</H2>
          <div className="mt-6 divide-y divide-ink-400/10">
            {(s("faq").items || []).map((x: any, i: number) => (
              <details key={i} className="py-3">
                <summary className="cursor-pointer font-semibold">{x.q}</summary>
                <p className="mt-2 text-sm text-ink-600">{x.a}</p>
              </details>
            ))}
          </div>
        </Band>
      )}

      {/* enquiry */}
      {on("enquiry") && <EnquiryBand d={d} round={round} />}

      {/* contact */}
      {on("contact") && (
        <Band id="contact" tint>
          <H2>{s("contact").title || "Find us"}</H2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div className="space-y-2 text-sm text-ink-700">
              {s("contact").address && (
                <p className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-hive-700" /> <span className="whitespace-pre-line">{s("contact").address}</span>
                </p>
              )}
              {s("contact").phone && (
                <p className="flex gap-2">
                  <Phone className="h-4 w-4 text-hive-700" /> <a href={`tel:${s("contact").phone}`}>{s("contact").phone}</a>
                </p>
              )}
              {s("contact").email && (
                <p className="flex gap-2">
                  <Mail className="h-4 w-4 text-hive-700" /> <a href={`mailto:${s("contact").email}`}>{s("contact").email}</a>
                </p>
              )}
              {s("contact").mapUrl && (
                <a href={s("contact").mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-hive-700 hover:underline">
                  Open in maps <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {(s("contact").hours || []).length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 font-bold">
                  <Clock className="h-4 w-4 text-hive-700" /> Hours
                </p>
                <dl className="space-y-1 text-sm">
                  {(s("contact").hours || []).map((h: any, i: number) => (
                    <div key={i} className="flex justify-between gap-4">
                      <dt className="text-ink-500">{h.day}</dt>
                      <dd className="font-semibold">{h.time}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {(s("contact").social || []).length > 0 && (
              <div>
                <p className="mb-2 font-bold">Follow us</p>
                <div className="flex flex-wrap gap-2">
                  {(s("contact").social || []).map((x: any, i: number) => (
                    <a key={i} href={x.href} target="_blank" rel="noreferrer" className="rounded-xl border border-ink-400/20 px-3 py-1.5 text-sm font-semibold hover:bg-white">
                      {x.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Band>
      )}

      {/* downloads */}
      {on("downloads") && (s("downloads").items || []).length > 0 && (
        <Band>
          <H2>{s("downloads").title || "Downloads"}</H2>
          <div className="mt-5 flex flex-wrap gap-3">
            {(s("downloads").items || []).map((x: any, i: number) => (
              <a key={i} href={x.url} className={`${round} border border-ink-400/20 px-4 py-2.5 font-semibold hover:bg-hive-50`}>
                {x.name}
              </a>
            ))}
          </div>
        </Band>
      )}

      {/* closing */}
      {on("cta") && s("cta").title && (
        <section className="bg-hive-700 px-5 py-14 text-center text-white">
          <h2 className="text-2xl font-extrabold">{s("cta").title}</h2>
          {s("cta").text && <p className="mx-auto mt-2 max-w-xl opacity-90">{s("cta").text}</p>}
          {s("cta").button && (
            <a href={s("cta").href || "#enquiry"} className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3 font-bold text-hive-900">
              {s("cta").button} <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </section>
      )}

      <footer className="border-t border-ink-400/10 px-5 py-8 text-center text-sm text-ink-500">
        <p>{s("footer").text || `© ${new Date().getFullYear()} ${company.name}`}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-4">
          {(s("footer").links || []).map((x: any, i: number) => (
            <a key={i} href={x.href} className="hover:text-hive-700">
              {x.label}
            </a>
          ))}
          {s("policies").showConsentLink !== false && d.consent && (
            <a href={`/consent${params.get("c") ? `?c=${params.get("c")}` : ""}`} className="inline-flex items-center gap-1 font-semibold text-hive-700 hover:underline">
              <ShieldCheck className="h-3.5 w-3.5" /> Data protection notice
            </a>
          )}
        </div>
      </footer>

      {s("policies").showCookieBanner !== false && <CookieBanner c={params.get("c")} />}
    </main>
  );
}

const Band = ({ children, id, tint }: { children: any; id?: string; tint?: boolean }) => (
  <section id={id} className={tint ? "bg-[#f7f8f6]" : ""}>
    <div className="mx-auto max-w-6xl px-5 py-14">{children}</div>
  </section>
);
const H2 = ({ children }: { children: any }) => <h2 className="text-2xl font-extrabold sm:text-3xl">{children}</h2>;

/** The form that makes a lead. */
function EnquiryBand({ d, round }: { d: any; round: string }) {
  const s = sectionData(d.site, "enquiry");
  const [f, setF] = useState({ name: "", phone: "", email: "", companyName: "", service: "", message: "", consent: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const qs = typeof window === "undefined" ? "" : window.location.search;
  const c = new URLSearchParams(qs).get("c");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/public/site/enquiry${c ? `?c=${encodeURIComponent(c)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, visitorId: visitorId(), page: location.pathname }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not send your enquiry");
      setDone(j.thanks || "Thank you — we will be in touch shortly.");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Band id="enquiry">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <H2>{s.title || "Talk to us"}</H2>
          {s.text && <p className="mt-3 whitespace-pre-line text-ink-600">{s.text}</p>}
        </div>
        {done ? (
          <div className={`${round} border border-hive-500/30 bg-hive-50 p-6 text-center`}>
            <Check className="mx-auto h-8 w-8 text-hive-700" />
            <p className="mt-2 font-semibold">{done}</p>
          </div>
        ) : (
          <form onSubmit={send} className={`${round} border border-ink-400/15 p-5`}>
            <div className="grid gap-3">
              <input className="input" required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input" inputMode="numeric" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
                <input className="input" type="email" placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </div>
              {s.askCompany && <input className="input" placeholder="Company name" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />}
              {s.askService && (d.services || []).length > 0 && (
                <select className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>
                  <option value="">What are you looking for?</option>
                  {(d.services || []).map((x: string) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              )}
              {s.askMessage && <textarea className="input min-h-[90px]" placeholder="Your message" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}
              {/* a bot fills this; a person never sees it */}
              <input className="hidden" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} aria-hidden />
              <label className="flex items-start gap-2.5 text-sm text-ink-600">
                <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-hive-700" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
                <span>
                  I agree to {d.company.shortName || d.company.name} contacting me about this enquiry and to the{" "}
                  <a href={`/consent${c ? `?c=${c}` : ""}`} target="_blank" rel="noreferrer" className="font-semibold text-hive-700 underline">
                    data protection notice
                  </a>
                  .
                </span>
              </label>
              {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</p>}
              <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 rounded-2xl bg-hive-700 px-5 py-3 font-bold text-white hover:bg-hive-900 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send
              </button>
            </div>
          </form>
        )}
      </div>
    </Band>
  );
}

/** The cookie banner. What the visitor chooses is recorded, as the Act asks. */
function CookieBanner({ c }: { c: string | null }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [cats, setCats] = useState({ preferences: true, analytics: false, marketing: false });

  useEffect(() => {
    try {
      if (!localStorage.getItem(COOKIE_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const decide = async (choice: "all" | "necessary" | "custom", categories = cats) => {
    const body = { visitorId: visitorId(), choice, categories: choice === "all" ? { preferences: true, analytics: true, marketing: true } : choice === "necessary" ? { preferences: false, analytics: false, marketing: false } : categories, page: location.pathname };
    try {
      localStorage.setItem(COOKIE_KEY, JSON.stringify({ ...body, at: Date.now() }));
    } catch {}
    setOpen(false);
    fetch(`/api/public/cookies${c ? `?c=${encodeURIComponent(c)}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-400/15 bg-white/95 p-4 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-ink-700">
          <Cookie className="mt-0.5 h-4 w-4 shrink-0 text-hive-700" />
          <span>
            We use cookies to run this site and, with your permission, to understand how it is used. Strictly necessary cookies are always on.{" "}
            <button type="button" className="font-semibold text-hive-700 underline" onClick={() => setMore(!more)}>
              {more ? "Hide choices" : "Choose"}
            </button>
          </span>
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => decide("necessary")} className="rounded-xl border border-ink-400/25 px-4 py-2 text-sm font-semibold hover:bg-hive-50">
            Necessary only
          </button>
          {more && (
            <button type="button" onClick={() => decide("custom")} className="rounded-xl border border-ink-400/25 px-4 py-2 text-sm font-semibold hover:bg-hive-50">
              Save my choice
            </button>
          )}
          <button type="button" onClick={() => decide("all")} className="rounded-xl bg-hive-700 px-4 py-2 text-sm font-bold text-white hover:bg-hive-900">
            Accept all
          </button>
        </div>
      </div>
      {more && (
        <div className="mx-auto mt-3 flex max-w-5xl flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-2 text-ink-400">
            <input type="checkbox" checked disabled className="h-4 w-4 accent-hive-700" /> Strictly necessary
          </span>
          {(["preferences", "analytics", "marketing"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 capitalize">
              <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={cats[k]} onChange={(e) => setCats({ ...cats, [k]: e.target.checked })} /> {k}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
