"use client";
/**
 * Super Admin › Mobile App Release › App store credentials.
 *
 * The iOS button is greyed out for exactly one reason: Apple's signing credentials are not here. This is
 * the screen that says which ones, what each is, where it comes from, and takes them.
 *
 * **The platform cannot make any of this.** A distribution certificate, a provisioning profile and an App
 * Store Connect key all come from an Apple Developer Program membership; the Play key comes from a Play
 * Console. So the honest thing to put on screen is the list and the instructions, not a button that looks
 * as though pressing it would conjure a certificate.
 *
 * Values are sealed to the build repository's public key and stored as repository secrets. Nothing is kept
 * in the database on the way through, and GitHub never gives a secret's value back — so this can show that
 * something is present, never what it is.
 */
import { useCallback, useEffect, useState } from "react";
import { Apple, CheckCircle2, Circle, Loader2, Lock, Upload, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { Btn, Badge, Spinner, useToast } from "@/components/ui";
import type { Cred, CredGroup } from "@shared/storecreds";

type Group = CredGroup & { ready: boolean; present: string[] };

export function StoreCredentials({ canEdit, onSaved }: { canEdit: boolean; onSaved?: () => void }) {
  const [data, setData] = useState<{ groups: Group[]; iosEnabled: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api<any>("/sa/mobile-releases/store-credentials")
      .then(setData)
      .catch(() => setData({ groups: [], iosEnabled: false }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /**
   * A file becomes base64 before it leaves the browser.
   *
   * A repository secret is text, and the workflow decodes these back with `base64 -d`. Doing it here means
   * the raw certificate never has to be handled as a file anywhere on the platform.
   */
  const takeFile = (key: string, file?: File | null) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      setVals((v) => ({ ...v, [key]: s.slice(s.indexOf(",") + 1) })); // strip the data: prefix
      setNames((n) => ({ ...n, [key]: `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` }));
    };
    r.readAsDataURL(file);
  };

  const save = async (g: Group) => {
    const mine = Object.fromEntries(g.creds.map((c) => [c.key, vals[c.key]]).filter(([, v]) => v));
    if (!Object.keys(mine).length) return toast("err", "Fill in at least one field first");
    setSaving(true);
    try {
      const out = await api<any>("/sa/mobile-releases/store-credentials", { method: "PUT", body: mine });
      const bad = (out.results || []).filter((r: any) => !r.ok);
      if (bad.length) toast("err", `${bad.length} could not be saved: ${bad[0].message}`);
      else toast("ok", g.id === "ios" && out.iosEnabled ? "Saved — iOS builds are now switched on" : "Saved to the build repository");
      setVals((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !(k in mine))));
      setNames({});
      load();
      onSaved?.();
    } catch (e: any) {
      toast("err", e?.message || "Those could not be saved");
    } finally {
      setSaving(false);
    }
  };

  if (!data)
    return (
      <div className="flex justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    );

  const ios = data.groups.find((g) => g.id === "ios");

  return (
    <section className="rounded-2xl border border-ink-400/15 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Apple className="h-4 w-4 text-ink-600" />
        <h3 className="text-sm font-extrabold">App store credentials</h3>
        {data.iosEnabled ? <Badge color="green">iOS builds on</Badge> : <Badge color="gray">iOS builds off</Badge>}
        <span className="ml-auto text-[11px] text-ink-500">Sealed to the build repository · never stored here</span>
      </div>

      {!data.iosEnabled && ios && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Why iOS is greyed out:</strong> {ios.creds.filter((c) => !ios.present.includes(c.key)).length} of {ios.creds.length} Apple credentials are missing. They cannot be
          generated here — they come from an Apple Developer Program membership. Add them below and the iOS button switches itself on.
        </p>
      )}

      <div className="space-y-2">
        {data.groups.map((g) => {
          const isOpen = open === g.id;
          const missing = g.creds.filter((c) => !g.present.includes(c.key)).length;
          return (
            <div key={g.id} className="overflow-hidden rounded-xl border border-ink-400/15">
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-hive-50/50" onClick={() => setOpen(isOpen ? null : g.id)}>
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />}
                {g.ready ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" /> : <Circle className="h-4 w-4 shrink-0 text-ink-300" />}
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{g.title}</span>
                  <span className="block text-[11px] text-ink-500">{g.unlocks}</span>
                </span>
                <span className="ml-auto shrink-0">{g.ready ? <Badge color="green">Ready</Badge> : <Badge color="gray">{missing} missing</Badge>}</span>
              </button>

              {isOpen && (
                <div className="border-t border-ink-400/15 bg-ink-50/40 p-3">
                  <p className="mb-3 text-[11px] text-ink-600">
                    <span className="font-bold">Where these come from:</span> {g.from}
                  </p>
                  <div className="space-y-3">
                    {g.creds.map((c: Cred) => {
                      const have = g.present.includes(c.key);
                      return (
                        <div key={c.key}>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold">{c.label}</span>
                            {have && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700">
                                <Lock className="h-3 w-3" /> saved
                              </span>
                            )}
                            <span className="mono ml-auto text-[10px] text-ink-400">{c.key}</span>
                          </div>
                          {c.kind === "file" ? (
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-ink-300 bg-white px-3 py-2 text-xs hover:border-hive-500">
                              <Upload className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                              <span className={names[c.key] ? "font-semibold text-hive-800" : "text-ink-500"}>{names[c.key] || (have ? "Choose a file to replace it" : "Choose a file")}</span>
                              <input type="file" className="hidden" accept={c.accept} disabled={!canEdit} onChange={(e) => takeFile(c.key, e.target.files?.[0])} />
                            </label>
                          ) : (
                            <input
                              className="input text-xs"
                              type={c.kind === "password" ? "password" : "text"}
                              autoComplete="off"
                              disabled={!canEdit}
                              placeholder={have ? "Saved — type to replace it" : "Not set"}
                              value={vals[c.key] || ""}
                              onChange={(e) => setVals((v) => ({ ...v, [c.key]: e.target.value }))}
                            />
                          )}
                          <p className="mt-1 text-[11px] text-ink-500">{c.help}</p>
                        </div>
                      );
                    })}
                  </div>
                  {canEdit && (
                    <div className="mt-3 flex justify-end">
                      <Btn onClick={() => save(g)} disabled={saving}>
                        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Save {g.title}
                      </Btn>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-ink-500">
        An Android build for direct install needs none of this — the platform makes and keeps that signing key itself.{" "}
        <a href="https://developer.apple.com/programs/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-hive-700 hover:underline">
          Apple Developer Program <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </section>
  );
}
