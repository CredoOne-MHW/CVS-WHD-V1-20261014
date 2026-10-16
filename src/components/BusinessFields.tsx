"use client";
import { ShieldCheck } from "lucide-react";
import { Field } from "./ui";
import { ServicePicker } from "./ServicePicker";
import { GST_RE, PAN_RE, aadhaarValid } from "@shared/clients";

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

export function ServiceField({ services, onChange }: { services: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label="Service" className="sm:col-span-2" hint="Pick from the list — type to add a new service, trash icon removes one from the list">
      <ServicePicker value={services} onChange={onChange} />
    </Field>
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
