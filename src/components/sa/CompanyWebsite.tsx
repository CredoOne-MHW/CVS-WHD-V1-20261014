"use client";
/**
 * Super Admin › Company › Website — the company's own small site.
 *
 * The left rail is the list of sections with a switch on each; the right pane edits whichever is selected.
 * Both are drawn from the section registry in shared/site.ts, so a section added there appears here with no
 * change to this file. Nothing in it is written for one trade.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe2, Save, Eye, Copy, Plus, Trash2, GripVertical, ExternalLink, Image as ImageIcon, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Field, Btn, Badge, Spinner, useToast } from "@/components/ui";
import { SITE_GROUPS, type SiteField, type SiteSection } from "@shared/site";

export function WebsiteTab({ id }: { id: string }) {
  const [d, setD] = useState<any>(null);
  const [sections, setSections] = useState<Record<string, any>>({});
  const [published, setPublished] = useState(false);
  const [sel, setSel] = useState("hero");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(
    () =>
      api(`/sa/companies/${id}/site`).then((r) => {
        setD(r);
        setSections(r.site.sections || {});
        setPublished(!!r.site.published);
        setDirty(false);
      }),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);

  if (!d)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const defs: SiteSection[] = d.sections;
  const def = defs.find((s) => s.key === sel) || defs[0];
  const data = sections[def.key] || {};
  const on = (k: string) => defs.find((s) => s.key === k)?.always || sections[k]?.on !== false;

  const set = (field: string, value: any) => {
    setDirty(true);
    setSections((p) => ({ ...p, [def.key]: { ...(p[def.key] || {}), [field]: value } }));
  };
  const toggle = (k: string, v: boolean) => {
    setDirty(true);
    setSections((p) => ({ ...p, [k]: { ...(p[k] || {}), on: v } }));
  };

  async function save(publish?: boolean) {
    setBusy(true);
    try {
      const r = await api(`/sa/companies/${id}/site`, { method: "PUT", body: { sections, published: publish ?? published } });
      setPublished(!!r.site.published);
      setDirty(false);
      toast("ok", publish === true ? "Website published" : publish === false ? "Website taken down" : "Saved");
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-hive-50/70 p-4">
        <p className="flex min-w-0 flex-1 items-start gap-3 text-sm text-ink-700">
          <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
          <span>
            The company’s own site. Every enquiry on it lands in <b>Leads</b>, with the campaign set below. Switch a section off to keep it off the page; the ones the site needs cannot be switched off.{" "}
            {published ? <Badge color="green">live</Badge> : <Badge color="gray">not published</Badge>}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <code className="truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-ink-600">{d.url}</code>
          <Btn type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(d.url).then(() => toast("ok", "Copied"))}>
            <Copy className="h-4 w-4" />
          </Btn>
          <a className="btn-secondary inline-flex items-center gap-2" href={d.url} target="_blank" rel="noreferrer">
            <Eye className="h-4 w-4" /> Preview
          </a>
          <Btn type="button" variant={published ? "ghost" : "secondary"} onClick={() => save(!published)} loading={busy}>
            {published ? "Take down" : "Publish"}
          </Btn>
          <Btn type="button" onClick={() => save()} loading={busy} disabled={!dirty}>
            <Save className="h-4 w-4" /> Save
          </Btn>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* the sections, with a switch on each */}
        <aside className="h-fit overflow-hidden rounded-2xl border border-ink-400/15 bg-white">
          {SITE_GROUPS.map((g) => (
            <div key={g}>
              <p className="eyebrow bg-ink-400/[0.04] px-4 py-2 text-ink-500">{g}</p>
              {defs
                .filter((s) => s.group === g)
                .map((s) => (
                  <div key={s.key} className={`flex items-center gap-2 border-b border-ink-400/10 px-3 py-2 last:border-0 ${sel === s.key ? "bg-hive-50" : ""}`}>
                    <button type="button" className={`min-w-0 flex-1 text-left text-sm font-semibold ${on(s.key) ? "" : "text-ink-400 line-through"}`} onClick={() => setSel(s.key)}>
                      {s.label}
                    </button>
                    {s.always ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">always</span>
                    ) : (
                      <label className="inline-flex shrink-0 cursor-pointer items-center">
                        <input type="checkbox" className="peer sr-only" checked={on(s.key)} onChange={(e) => toggle(s.key, e.target.checked)} aria-label={`${s.label} on`} />
                        <span className="relative h-5 w-9 rounded-full bg-ink-400/30 transition peer-checked:bg-hive-700 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
                      </label>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </aside>

        {/* the chosen section */}
        <section className="rounded-2xl border border-ink-400/15 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{def.label}</h3>
              <p className="max-w-2xl text-sm text-ink-500">{def.description}</p>
            </div>
            {!def.always && (
              <label className="flex items-center gap-2 rounded-xl bg-hive-50 px-3 py-1.5 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={on(def.key)} onChange={(e) => toggle(def.key, e.target.checked)} />
                Shown on the website
              </label>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {def.fields.map((f) => (
              <FieldEditor key={f.key} f={f} value={data[f.key]} onChange={(v) => set(f.key, v)} services={d.services} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** One field, drawn from its type. A list field edits its own rows. */
function FieldEditor({ f, value, onChange, services }: { f: SiteField; value: any; onChange: (v: any) => void; services: string[] }) {
  const wide = f.type === "textarea" || f.type === "richtext" || f.type === "list";
  if (f.type === "toggle")
    return (
      <label className="flex items-start gap-3 rounded-xl border border-ink-400/15 p-3 sm:col-span-1">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-sm">
          <b>{f.label}</b>
          {f.hint && <span className="block text-ink-500">{f.hint}</span>}
        </span>
      </label>
    );

  if (f.type === "list") {
    const rows: any[] = Array.isArray(value) ? value : [];
    const setRow = (i: number, k: string, v: any) => onChange(rows.map((r, j) => (i === j ? { ...r, [k]: v } : r)));
    return (
      <div className="sm:col-span-2">
        <p className="label">
          {f.label} <span className="font-normal text-ink-400">· {rows.length}{f.max ? ` of ${f.max}` : ""}</span>
        </p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-ink-400/15 p-2">
              <GripVertical className="mt-2 h-4 w-4 shrink-0 text-ink-300" />
              <div className="grid flex-1 gap-2 sm:grid-cols-2">
                {(f.of || []).map((c) =>
                  c.type === "textarea" ? (
                    <textarea key={c.key} className="input min-h-[60px] sm:col-span-2" placeholder={c.label} value={r[c.key] || ""} onChange={(e) => setRow(i, c.key, e.target.value)} />
                  ) : (
                    <input key={c.key} className="input" placeholder={c.placeholder || c.label} value={r[c.key] || ""} onChange={(e) => setRow(i, c.key, e.target.value)} />
                  )
                )}
              </div>
              <button type="button" aria-label="Remove" className="btn-ghost mt-0.5 text-ink-400 hover:text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <Btn type="button" variant="secondary" className="mt-2" disabled={!!f.max && rows.length >= f.max} onClick={() => onChange([...rows, {}])}>
          <Plus className="h-4 w-4" /> Add
        </Btn>
      </div>
    );
  }

  return (
    <Field label={f.label} hint={f.hint} className={wide ? "sm:col-span-2" : ""}>
      {f.type === "textarea" || f.type === "richtext" ? (
        <textarea className={`input ${f.type === "richtext" ? "min-h-[220px]" : "min-h-[80px]"}`} maxLength={f.max} placeholder={f.placeholder} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      ) : f.type === "select" ? (
        <select className="input" value={value || (f.options || [])[0]} onChange={(e) => onChange(e.target.value)}>
          {(f.options || []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : f.type === "color" ? (
        <div className="flex items-center gap-2">
          <input type="color" aria-label={f.label} className="h-11 w-14 cursor-pointer rounded-xl border border-ink-400/25 bg-white p-1" value={value || "#2f5c24"} onChange={(e) => onChange(e.target.value)} />
          <input className="input font-mono" placeholder="Auto" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      ) : f.type === "image" ? (
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 shrink-0 text-ink-400" />
          <input className="input" placeholder="https://… (paste a link)" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      ) : (
        <input className="input" placeholder={f.placeholder} maxLength={f.max} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}
