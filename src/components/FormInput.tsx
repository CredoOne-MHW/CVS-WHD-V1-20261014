"use client";
import type { FormField } from "@shared/formspec";

/** One field, drawn the way its type says. Exported so the builder's preview shows the real thing. */
export function FormInput({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const ph = field.placeholder || field.label;
  const common = { className: "input", required: field.required, placeholder: ph } as const;

  if (field.type === "textarea") return <Label field={field}><textarea {...common} className="input min-h-[90px]" value={value || ""} onChange={(e) => onChange(e.target.value)} /></Label>;

  if (field.type === "phone")
    return (
      <Label field={field}>
        <input
          {...common}
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          maxLength={10}
          value={value || ""}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        />
      </Label>
    );

  if (field.type === "select")
    return (
      <Label field={field}>
        <select className="input" required={field.required} value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{ph}</option>
          {(field.options || []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Label>
    );

  if (field.type === "radio")
    return (
      <Label field={field} always>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {(field.options || []).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name={field.key} className="h-4 w-4 accent-hive-700" checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      </Label>
    );

  if (field.type === "checkbox")
    return (
      <label className="flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
        {field.required && <span className="text-red-600">*</span>}
      </label>
    );

  return (
    <Label field={field}>
      <input {...common} type={field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </Label>
  );
}

/**
 * A label above the control — but only for the fields that need one.
 *
 * The four original fields carried their wording in the placeholder and nothing above them, and that is
 * how they must keep looking. Anything a company adds gets a visible label, because a placeholder vanishes
 * the moment somebody types and a question you can no longer read is a question answered wrongly.
 */
function Label({ field, children, always }: { field: FormField; children: React.ReactNode; always?: boolean }) {
  if (field.core && !always) return <>{children}</>;
  return (
    <div>
      <p className="label">
        {field.label}
        {field.required && <span className="text-red-600"> *</span>}
      </p>
      {children}
    </div>
  );
}
