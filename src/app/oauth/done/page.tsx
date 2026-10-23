"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

/** Last stop of the platform sign-in popup: tells the Connect window and closes itself. */
function Done() {
  const sp = useSearchParams();
  const ok = sp?.get("ok") === "1";
  const error = sp?.get("error") || "";
  const state = sp?.get("state") || "";
  useEffect(() => {
    try {
      // only the state id travels (no token); the Connect window also polls, so this is just a speed-up
      window.opener?.postMessage({ type: "credoone-sso", ok, error, state }, "*");
    } catch {}
    if (ok) setTimeout(() => window.close(), 900);
  }, [ok, error, state]);
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f4] p-6">
      <div className="max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-ink-400/10">
        {ok ? <CheckCircle2 className="mx-auto h-12 w-12 text-hive-600" /> : <XCircle className="mx-auto h-12 w-12 text-red-500" />}
        <h1 className="mt-3 text-lg font-bold text-ink-900">{ok ? "Signed in" : "Not connected"}</h1>
        <p className="mt-1 text-sm text-ink-500">{ok ? "Go back to the Connect window to pick what to connect. This window closes by itself." : error || "Something went wrong."}</p>
        <button className="btn-secondary mt-5" onClick={() => window.close()}>
          Close window
        </button>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Done />
    </Suspense>
  );
}
