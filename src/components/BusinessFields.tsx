"use client";
import { ShieldCheck, Plus, Minus } from "lucide-react";
import { Field } from "./ui";
import { ServicePicker } from "./ServicePicker";
import { GST_RE, PAN_RE, aadhaarValid, type ServiceLine } from "@shared/clients";

/** Form state: business details as edited in the browser (Aadhaar is write-only: the server returns only XXXX XXXX 1234). */
export type BizForm = {
  gst: string;
  tradeLicence: string;
  pan: string;
  registeredAddress: string;
  communicationAddress: string;
  commSameAsRegistered: boolean;
  ownerEmail: string;
  ownerPhone: string;
  ownerPan: string;
  ownerAadhaar: string; // only when replacing
  ownerAadhaarMasked?: string;
  clearAadhaar?: boolean;
};
export const bizFrom = (b: any = {}): BizForm => ({
  gst: b.gst || "",
  tradeLicence: b.tradeLicence || "",
  pan: b.pan || "",
  registeredAddress: b.registeredAddress || "",
  communicationAddress: b.communicationAddress || "",
  commSameAsRegistered: !!b.commSameAsRegistered,
  ownerEmail: b.ownerEmail || "",
  ownerPhone: b.ownerPhone || "",
  ownerPan: b.ownerPan || "",
  ownerAadhaar: "",
  ownerAadhaarMasked: b.ownerAadhaarMasked || "",
});
/** What to send: never re-sends the masked Aadhaar; empty strings clear fields. */
export const bizPayload = (f: BizForm) => {
  const { ownerAadhaarMasked, ownerAadhaar, clearAadhaar, ...rest } = f;
  return { ...rest, ...(ownerAadhaar ? { ownerAadhaar } : {}), ...(clearAadhaar ? { clearAadhaar: true } : {}) };
};
/** First problem to show before saving (the server checks the same rules). */
export function bizError(f: BizForm) {
  if (f.gst && !GST_RE.test(f.gst)) return "Company GST looks wrong — 15 characters like 19AAACW1234F1Z5";
  if (f.pan && !PAN_RE.test(f.pan)) return "Company PAN looks wrong — like AAACW1234F";
  if (f.ownerPan && !PAN_RE.test(f.ownerPan)) return "Owner PAN looks wrong — like ABCDE1234F";
  if (f.ownerAadhaar && !aadhaarValid(f.ownerAadhaar)) return "Owner Aadhaar is not a valid 12-digit number";
  if (f.ownerPhone && f.ownerPhone.replace(/\D/g, "").length !== 10) return "Owner number should be 10 digits";
  if (f.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.ownerEmail)) return "Owner email looks wrong";
  return "";
}

/** First problem in the service rows (the server checks the same). */
export function linesError(lines: ServiceLine[]) {
  const named = lines.filter((l) => l.service);
  if (lines.some((l) => !l.service && String(l.licenses ?? "") !== "" && Number(l.licenses) !== 1)) return "Pick a service or product on every row";
  if (named.some((l) => !Number.isInteger(Number(l.licenses)) || Number(l.licenses) < 1)) return "No of Licenses must be a whole number of at least 1";
  const names = named.map((l) => l.service.toLowerCase());
  if (new Set(names).size !== names.length) return "A service is listed twice — put all its licences on one row";
  return "";
}
/** Rows to send (empty rows dropped, licences as numbers). */
export const linesPayload = (lines: ServiceLine[]) => lines.filter((l) => l.service).map((l) => ({ service: l.service, licenses: Number(l.licenses) || 1 }));

/**
 * Services / products opted for, one row each: service (from the Service master — type to add, trash to remove from the
 * list) + No of Licenses, with + / − to add or remove rows. Used on Lead and Client; Payment Details read the licences.
 */
export function ServiceField({ lines, onChange }: { lines: ServiceLine[]; onChange: (v: ServiceLine[]) => void }) {
  const rows = lines.length ? lines : [{ service: "", licenses: 1 }];
  const set = (i: number, p: Partial<ServiceLine>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const taken = (i: number) => rows.filter((_, j) => j !== i).map((r) => r.service.toLowerCase());
  return (
    <div className="sm:col-span-2">
      <div className="mb-1.5 hidden grid-cols-[1fr_9rem_2.5rem] gap-3 sm:grid">
        <p className="label mb-0">Service / product</p>
        <p className="label mb-0">No of Licenses</p>
        <span />
      </div>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_6.5rem_2.5rem] items-start gap-2 sm:grid-cols-[1fr_9rem_2.5rem] sm:gap-3">
            <div>
              <ServicePicker multiple={false} value={r.service} onChange={(v: string) => set(i, { service: v })} placeholder="Select service or product…" />
              {r.service && taken(i).includes(r.service.toLowerCase()) && <p className="mt-1 text-xs text-red-600">Already listed above</p>}
            </div>
            <input
              className="input tabular-nums"
              inputMode="numeric"
              aria-label={`No of Licenses for ${r.service || `row ${i + 1}`}`}
              placeholder="1"
              value={r.licenses === 0 ? "" : String(r.licenses ?? "")}
              onChange={(e) => set(i, { licenses: (e.target.value.replace(/\D/g, "").slice(0, 7) || 0) as any })}
              onBlur={() => !Number(r.licenses) && set(i, { licenses: 1 })}
            />
            <button
              type="button"
              aria-label="Remove this service"
              title="Remove this service"
              className="grid h-11 w-10 place-items-center rounded-xl border border-ink-400/20 text-ink-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              disabled={rows.length === 1 && !r.service}
              onClick={() => onChange(rows.length === 1 ? [] : rows.filter((_, j) => j !== i))}
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-hive-700 hover:underline" onClick={() => onChange([...rows, { service: "", licenses: 1 }])}>
          <Plus className="h-4 w-4" /> Add service / product
        </button>
        <p className="text-xs text-ink-500">Type in the list to add a new service; the trash icon removes one from the list.</p>
      </div>
    </div>
  );
}

export function BusinessFields({ v, set }: { v: BizForm; set: (b: BizForm) => void }) {
  const u = (k: keyof BizForm, val: any) => {
    const n: BizForm = { ...v, [k]: val } as BizForm;
    if (n.commSameAsRegistered) n.communicationAddress = n.registeredAddress;
    set(n);
  };
  const upper = (s: string) => s.toUpperCase().replace(/\s/g, "");
  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <p className="eyebrow text-ink-500 sm:col-span-2">Business details</p>
      <Field label="Company GST">
        <input className="input uppercase" maxLength={15} placeholder="NA" value={v.gst} onChange={(e) => u("gst", upper(e.target.value))} />
      </Field>
      <Field label="Trade licence">
        <input className="input" maxLength={60} placeholder="NA" value={v.tradeLicence} onChange={(e) => u("tradeLicence", e.target.value)} />
      </Field>
      <Field label="Company PAN">
        <input className="input uppercase" maxLength={10} placeholder="NA" value={v.pan} onChange={(e) => u("pan", upper(e.target.value))} />
      </Field>
      <div className="hidden sm:block" />
      <Field label="Company registered address" className="sm:col-span-2">
        <textarea className="input min-h-[64px]" maxLength={500} placeholder="NA" value={v.registeredAddress} onChange={(e) => u("registeredAddress", e.target.value)} />
      </Field>
      <Field label="Company communication address" className="sm:col-span-2">
        <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="h-4 w-4 accent-hive-700" checked={v.commSameAsRegistered} onChange={(e) => u("commSameAsRegistered", e.target.checked)} /> Same as registered address
        </label>
        <textarea className="input min-h-[64px] disabled:bg-[#f6f7f5] disabled:text-ink-500" maxLength={500} placeholder="NA" disabled={v.commSameAsRegistered} value={v.communicationAddress} onChange={(e) => u("communicationAddress", e.target.value)} />
      </Field>
      <Field label="Owner mail id">
        <input className="input" type="email" placeholder="NA" value={v.ownerEmail} onChange={(e) => u("ownerEmail", e.target.value.trim())} />
      </Field>
      <Field label="Owner number" hint="10 digits, no +91">
        <input className="input" inputMode="numeric" maxLength={10} placeholder="NA" value={v.ownerPhone} onChange={(e) => u("ownerPhone", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Owner PAN">
        <input className="input uppercase" maxLength={10} placeholder="NA" value={v.ownerPan} onChange={(e) => u("ownerPan", upper(e.target.value))} />
      </Field>
      <Field
        label="Owner Aadhaar"
        hint={
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-hive-600" />
            {v.ownerAadhaarMasked && !v.clearAadhaar ? `Saved as ${v.ownerAadhaarMasked} (encrypted). Type a new number to replace it.` : "Stored encrypted; only the last 4 digits are ever shown."}
          </span>
        }
      >
        <div className="flex gap-2">
          <input className="input font-mono" inputMode="numeric" maxLength={14} autoComplete="off" placeholder={v.ownerAadhaarMasked && !v.clearAadhaar ? v.ownerAadhaarMasked : "NA"} value={v.ownerAadhaar} onChange={(e) => set({ ...v, ownerAadhaar: e.target.value.replace(/[^\d]/g, "").slice(0, 12), clearAadhaar: false })} />
          {v.ownerAadhaarMasked && !v.clearAadhaar && (
            <button type="button" className="btn-ghost shrink-0 text-xs text-red-600" onClick={() => set({ ...v, ownerAadhaar: "", clearAadhaar: true })}>
              Remove
            </button>
          )}
        </div>
      </Field>
    </div>
  );
}
