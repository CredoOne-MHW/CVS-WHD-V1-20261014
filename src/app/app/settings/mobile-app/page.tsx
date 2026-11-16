"use client";
/** The company's own page: download the apps, and what to do with them. */
import { useEffect, useState } from "react";
import { Smartphone, Download, Apple, ShieldCheck, Info } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { PageHeader, Badge, Spinner, Empty, Btn } from "@/components/ui";
import { platformLabel } from "@shared/mobile";

const size = (n?: number) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function Page() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    api("/co/mobile").then(setD).catch(() => setD({ latest: {} }));
  }, []);

  if (!d)
    return (
      <div className="flex justify-center py-20 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );

  const apps = Object.values(d.latest || {}) as any[];

  return (
    <>
      <PageHeader title="Mobile App" subtitle="Your company's own Android and iOS apps." />
      {apps.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {apps.map((b: any) => (
            <div key={b._id} className="card p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-hive-50 text-hive-700">{b.platform === "ios" ? <Apple className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {b.appName} <Badge color="green">v{b.version}</Badge>
                  </p>
                  <p className="text-xs text-ink-500">
                    {platformLabel(b.platform)} · {size(b.fileSize)} · built {fmtDate(b.finishedAt || b.createdAt, false)}
                  </p>
                </div>
              </div>
              <a className="btn mt-4 inline-flex w-full items-center justify-center gap-2" href={`/api/co/mobile/download/${b._id}`}>
                <Download className="h-4 w-4" /> Download for {platformLabel(b.platform)}
              </a>
              {b.platform === "android" && <p className="mt-2 text-xs text-ink-500">On the phone, allow “Install unknown apps” for your browser the first time. Later versions install over this one.</p>}
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No app yet" hint="Your administrator builds the apps for your company. They appear here as soon as one is ready." />
      )}

      <div className="card mt-5 flex items-start gap-3 p-5 text-sm text-ink-700">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-hive-700" />
        <p>
          Everyone signs in with the same e-mail and password they use here, and sees only what their role allows. At the first sign-in the app shows your data-protection notice, which has to be read to the end before it can be accepted — every acceptance appears under <b>DPDP › Acceptance status</b>.
        </p>
      </div>
    </>
  );
}
