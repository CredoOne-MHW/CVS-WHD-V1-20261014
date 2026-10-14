"use client";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Btn } from "@/components/ui";

/** Hosted mobile form for QR-code / campaign connectors. Posts to the connector's intake endpoint. */
export default function CampaignForm() {
  const key = (useParams() as { key: string } | null)?.key || "";
  const sp = useSearchParams();
  const [info, setInfo] = useState<any>(null);
  const [done, setDone] = useState(sp?.get("ok") === "1");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "", consent: true, _hp: "" });

  useEffect(() => {
    fetch(`/api/forms/${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setErr("This form is no longer available."));
  }, [key]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const utm = Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => k.startsWith("utm_")));
    const r = await fetch(`/api/intake/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${key}-${f.phone}-${new Date().toISOString().slice(0, 13)}` },
      body: JSON.stringify({ ...f, ...utm, consent: f.consent ? "yes" : "no", consent_text: "I agree to be contacted on WhatsApp/phone about my enquiry." }),
    });
    setBusy(false);
    if (r.ok) setDone(true);
    else setErr((await r.json().catch(() => ({}))).error || "Could not submit. Please try again.");
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-hive-50 px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <img src={process.env.NEXT_PUBLIC_BRAND_LOGO || "/wellness-hive-logo.jpeg"} alt="" className="mx-auto h-20 w-20 rounded-full" />
        <h1 className="mt-4 text-center text-xl font-extrabold">{info?.company || "…"}</h1>
        <p className="text-center text-sm text-ink-500">{info?.campaign || info?.title}</p>
        {done ? (
          <div className="mt-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-hive-600" />
            <p className="mt-3 font-bold">Thank you!</p>
            <p className="text-sm text-ink-500">Our team will contact you shortly.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input className="input" required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="input" required inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} placeholder="Mobile number (10 digits)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} />
            <input className="input" type="email" placeholder="Email (optional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <textarea className="input min-h-[90px]" placeholder="What are you looking for? (test, package, consultation…)" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
            <input className="hidden" tabIndex={-1} autoComplete="off" value={f._hp} onChange={(e) => setF({ ...f, _hp: e.target.value })} aria-hidden />
            <label className="flex items-start gap-2 text-xs text-ink-600">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-hive-700" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />I agree to be contacted on WhatsApp / phone about my enquiry.
            </label>
            {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            <Btn type="submit" loading={busy} className="w-full py-3" disabled={!info}>
              Submit
            </Btn>
          </form>
        )}
      </div>
    </div>
  );
}
