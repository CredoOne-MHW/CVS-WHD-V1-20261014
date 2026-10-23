"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

export type Privacy = { email: string; officer: string; legalName: string; address: string; product: string; consentVersion: string; platformUrl: string; updatedAt?: string };

/** Public legal pages (privacy, terms, data deletion). The contact details come from Super Admin › Platform Apps. */
export function LegalPage({ title, children }: { title: string; children: (p: Privacy) => ReactNode }) {
  const [p, setP] = useState<Privacy | null>(null);
  useEffect(() => {
    fetch("/api/public/privacy")
      .then((r) => r.json())
      .then(setP)
      .catch(() => setP({ email: "support@credovation.tech", officer: "Grievance Officer", legalName: "Credovation Solutions Private Limited", address: "Kolkata, West Bengal, India", product: "CredoOne", consentVersion: "", platformUrl: "" }));
  }, []);
  useEffect(() => {
    document.title = `${title} · ${p?.product || "CredoOne"}`;
  }, [title, p]);
  return (
    <main className="min-h-screen bg-[#f6f7f4] px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink-400/10 sm:p-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-hive-50 text-hive-700">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-ink-900">{title}</h1>
            <p className="text-sm text-ink-500">{p ? `${p.product} · ${p.legalName}` : " "}</p>
          </div>
        </div>
        <div className="legal space-y-4 text-[15px] leading-relaxed text-ink-700 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc [&_a]:font-semibold [&_a]:text-hive-700">
          {p ? children(p) : <div className="h-40 animate-pulse rounded-2xl bg-hive-50" />}
        </div>
      </article>
    </main>
  );
}

export const Contact = ({ p }: { p: Privacy }) => (
  <p>
    {p.officer}, {p.legalName}, {p.address}. Email: <a href={`mailto:${p.email}`}>{p.email}</a>
  </p>
);
