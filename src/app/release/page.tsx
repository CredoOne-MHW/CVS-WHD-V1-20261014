"use client";
import { useEffect, useState } from "react";
import { Rocket, Tag } from "lucide-react";
import RELEASES from "@shared/releases.generated.json";

const DATA = RELEASES as { current: string; builtAt: string; commit: string | null; releases: { version: string; date: string; title: string; kind: string; html: string }[] };
const KIND: Record<string, { label: string; cls: string }> = {
  major: { label: "Major", cls: "bg-hive-700 text-white" },
  minor: { label: "Minor", cls: "bg-hive-100 text-hive-900" },
  patch: { label: "Bug fix", cls: "bg-honey-100 text-honey-900" },
};

/** Public release site: every version of this deployment, newest first. White-labelled per company. */
export default function Releases() {
  const [brand, setBrand] = useState<{ name?: string }>({});
  useEffect(() => {
    fetch("/api/public/branding")
      .then((r) => r.json())
      .then(setBrand)
      .catch(() => {});
    document.title = `Release notes · ${DATA.current}`;
  }, []);
  return (
    <main className="min-h-screen bg-[#f6f7f4] px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-hive-700">
              <Rocket className="h-3.5 w-3.5" /> Release notes
            </p>
            <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.02em] text-ink-900">{brand.name || "CredoOne"}</h1>
            <p className="mt-1 text-sm text-ink-500">
              Running <b className="text-ink-900">v{DATA.current}</b> · built {new Date(DATA.builtAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              {DATA.commit ? ` · ${DATA.commit}` : ""}
            </p>
          </div>
          <p className="text-xs text-ink-500">
            Versions follow <span className="mono">vX.Y.Z</span> — Z bug fix, Y minor, X major.
          </p>
        </header>
        <div className="space-y-5">
          {DATA.releases.map((r) => {
            const k = KIND[r.kind] || KIND.minor;
            return (
              <article key={r.version} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink-400/10 sm:p-7">
                <div className="mb-4 flex flex-wrap items-center gap-2.5 border-b border-ink-400/10 pb-3">
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-2.5 py-1 text-sm font-bold text-white">
                    <Tag className="h-3.5 w-3.5" /> v{r.version}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${k.cls}`}>{k.label}</span>
                  {r.version === DATA.current && <span className="rounded-full bg-hive-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-hive-800">Live</span>}
                  <span className="text-sm font-semibold text-ink-900">{r.title}</span>
                  <span className="ml-auto text-xs text-ink-500">{r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
                </div>
                <div className="kb-doc" dangerouslySetInnerHTML={{ __html: r.html }} />
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
