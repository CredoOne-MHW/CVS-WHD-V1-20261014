"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2, Eye, X } from "lucide-react";
import { Field } from "@/components/ui";
import { normalise, visible, FIELD_TYPES, CORE_KEYS, ALWAYS_ON, toKey, type FormField, type FormSpec } from "@shared/formspec";
import { FormInput } from "@/components/FormInput";

/**
 * Designs the hosted QR / campaign form.
 *
 * Two rules shape this, and both are about not breaking a form that is already printed on something:
 *
 *   1  **The four original fields cannot be deleted or re-keyed.** Their keys are what puts an answer into
 *      the lead's name, phone, e-mail and comments columns. Renaming one would leave the form looking
 *      right while quietly filling nothing, so the label is editable and the key is not. Name and phone
 *      cannot even be switched off — a lead with neither is not a lead anybody can act on.
 *   2  **A form that has never been opened here is not changed by opening it.** What loads is the original
 *      form expressed as data; nothing is written until Save is pressed.
 *
 * Anything added beyond the four is carried onto the lead as a custom field, under its own label.
 */
export function FormBuilder({ cfg, set }: { cfg: any; set: (v: any) => void }) {
  const spec: FormSpec = useMemo(() => normalise(cfg?.form), [cfg]);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});

  const write = (patch: Partial<FormSpec>) => set({ ...(cfg || {}), form: { ...spec, ...patch } });
  const writeField = (i: number, patch: Partial<FormField>) => {
    const fields = spec.fields.map((f, n) => (n === i ? { ...f, ...patch } : f));
    write({ fields });
  };
  const move = (i: number, by: number) => {
    const fields = [...spec.fields];
    const j = i + by;
    if (j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j], fields[i]];
    write({ fields });
  };
  const add = () => {
    const n = spec.fields.filter((f) => !f.core).length + 1;
    write({ fields: [...spec.fields, { key: toKey(`question_${n}`), label: `Question ${n}`, type: "text", required: false, placeholder: "" }] });
  };
  const remove = (i: number) => write({ fields: spec.fields.filter((_, n) => n !== i) });

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-bold">Fields</h3>
          <button type="button" onClick={() => setPreview(true)} className="flex items-center gap-1.5 text-sm font-semibold text-hive-700 hover:underline">
            <Eye className="h-4 w-4" /> Preview
          </button>
        </div>

        <div className="space-y-2">
          {spec.fields.map((f, i) => {
            const locked = ALWAYS_ON.includes(f.key as any);
            const off = f.core && f.on === false;
            return (
              <div key={f.key} className={`rounded-2xl border border-ink-400/15 bg-white p-3 ${off ? "opacity-55" : ""}`}>
                <div className="flex items-start gap-2">
                  <div className="flex flex-col pt-1.5 text-ink-400">
                    <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="hover:text-hive-700 disabled:opacity-30" disabled={i === 0}>
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <GripVertical className="h-3.5 w-3.5 opacity-40" />
                    <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="hover:text-hive-700 disabled:opacity-30" disabled={i === spec.fields.length - 1}>
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid flex-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
                    <Field label="Label">
                      <input className="input" value={f.label} onChange={(e) => writeField(i, { label: e.target.value })} />
                    </Field>
                    <Field label="Type">
                      {f.core ? (
                        <input className="input bg-hive-50/60" value={FIELD_TYPES.find(([t]) => t === f.type)?.[1] || f.type} disabled title="Built-in fields keep their type — it is what fills the lead's column" />
                      ) : (
                        <select className="input" value={f.type} onChange={(e) => writeField(i, { type: e.target.value as any })}>
                          {FIELD_TYPES.map(([t, label]) => (
                            <option key={t} value={t}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>

                    {f.type !== "checkbox" && f.type !== "radio" && (
                      <Field label="Placeholder" className="sm:col-span-2">
                        <input className="input" value={f.placeholder || ""} onChange={(e) => writeField(i, { placeholder: e.target.value })} />
                      </Field>
                    )}

                    {(f.type === "select" || f.type === "radio") && (
                      <Field label="Options" hint="One per line" className="sm:col-span-2">
                        <textarea className="input min-h-[72px]" value={(f.options || []).join("\n")} onChange={(e) => writeField(i, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
                      </Field>
                    )}

                    <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={!!f.required} disabled={locked} onChange={(e) => writeField(i, { required: e.target.checked })} />
                        Required
                      </label>
                      {f.core && (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={f.on !== false} disabled={locked} onChange={(e) => writeField(i, { on: e.target.checked })} />
                          Show on the form
                        </label>
                      )}
                      <span className="mono text-[11px] text-ink-400">{f.key}</span>
                      {f.core ? (
                        <span className="rounded-full bg-hive-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hive-700">
                          {locked ? "always asked" : "built-in"}
                        </span>
                      ) : (
                        <button type="button" onClick={() => remove(i)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={add} className="mt-3 flex items-center gap-1.5 rounded-xl border border-dashed border-ink-400/35 px-3 py-2 text-sm font-semibold text-ink-600 hover:border-hive-400 hover:text-hive-700">
          <Plus className="h-4 w-4" /> Add a question
        </button>
        <p className="mt-2 text-xs text-ink-500">
          Answers to questions you add arrive on the lead as custom fields, under the label you give them. The four built-in fields fill the lead’s own name, phone, e-mail and comments.
        </p>
      </section>

      <section>
        <h3 className="mb-3 font-bold">Wording</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Heading" hint="Blank uses the company name">
            <input className="input" value={spec.heading || ""} onChange={(e) => write({ heading: e.target.value })} />
          </Field>
          <Field label="Line under the heading" hint="Blank uses the campaign name">
            <input className="input" value={spec.intro || ""} onChange={(e) => write({ intro: e.target.value })} />
          </Field>
          <Field label="Button" className="sm:col-span-2">
            <input className="input" value={spec.submitLabel} onChange={(e) => write({ submitLabel: e.target.value })} />
          </Field>
          <Field label="Consent line" className="sm:col-span-2" hint="Kept with the lead as the consent that was shown">
            <textarea className="input min-h-[60px]" value={spec.consentText} onChange={(e) => write({ consentText: e.target.value })} />
          </Field>
          <label className="flex items-start gap-3 rounded-2xl border border-ink-400/15 bg-white p-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={spec.consentRequired} onChange={(e) => write({ consentRequired: e.target.checked })} />
            <span>
              <b>Consent must be ticked to submit</b>
              <span className="block text-ink-500">Off by default, as before — the box starts ticked and a visitor may untick it and still send the form.</span>
            </span>
          </label>
          <Field label="Thank-you title">
            <input className="input" value={spec.thankYouTitle} onChange={(e) => write({ thankYouTitle: e.target.value })} />
          </Field>
          <Field label="Thank-you text">
            <input className="input" value={spec.thankYouText} onChange={(e) => write({ thankYouText: e.target.value })} />
          </Field>
        </div>
      </section>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/50 p-4" onClick={() => setPreview(false)}>
          <div className="my-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-white">
              <p className="text-sm font-bold">Preview · this is the page a visitor sees</p>
              <button type="button" aria-label="Close preview" onClick={() => setPreview(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="card p-6">
              <div className="mx-auto h-20 w-20 rounded-full bg-hive-100" />
              <h1 className="mt-4 text-center text-xl font-extrabold">{spec.heading || "Company name"}</h1>
              <p className="text-center text-sm text-ink-500">{spec.intro || "Campaign"}</p>
              <div className="mt-6 space-y-4">
                {visible(spec).map((f) => (
                  <FormInput key={f.key} field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                ))}
                <label className="flex items-start gap-2 text-xs text-ink-700">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" defaultChecked />
                  {spec.consentText}
                </label>
                <button type="button" className="btn w-full py-3" disabled>
                  {spec.submitLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { CORE_KEYS };
