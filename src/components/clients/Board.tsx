"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Settings2, Plus, Trash2, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { api, qs } from "@/lib/api";
import { Btn, Modal, Spinner, useToast } from "../ui";
import { usePerm } from "../Shell";
import { ClientProfile } from "./ClientList";
import { ago } from "./common";

const SWATCHES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b", "#2f5c24"];

/** Service-status Kanban: drag a card to another column (or use “Move to” on touch screens). */
export function Board() {
  const [cols, setCols] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const perm = usePerm("clients");
  const toast = useToast();
  const t = useRef<any>();

  const load = useCallback(() => api(`/co/clients-board${qs({ q })}`).then((r) => setCols(r.columns)), [q]);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t.current);
  }, [load, q]);

  /** Optimistic move; rolls back if the server refuses. */
  async function move(id: string, from: string, to: string) {
    if (from === to || !cols) return;
    const prev = cols;
    const card = cols.find((c) => c.id === from)?.cards.find((x: any) => x._id === id);
    if (!card) return;
    setCols(cols.map((c) => (c.id === from ? { ...c, cards: c.cards.filter((x: any) => x._id !== id), total: c.total - 1 } : c.id === to ? { ...c, cards: [{ ...card, serviceStage: to, stageAt: new Date().toISOString() }, ...c.cards], total: c.total + 1 } : c)));
    try {
      await api(`/co/clients/${id}/stage`, { method: "PATCH", body: { stage: to } });
    } catch (e: any) {
      setCols(prev);
      toast("err", e.message);
    }
  }

  if (!cols)
    return (
      <div className="flex justify-center py-16 text-hive-700">
        <Spinner className="h-6 w-6" />
      </div>
    );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input w-72 pl-9" placeholder="Find a client on the board" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="text-sm text-ink-500">Drag a card to change its service status.</p>
        {perm.update && (
          <Btn variant="secondary" className="ml-auto" onClick={() => setEdit(true)}>
            <Settings2 className="h-4 w-4" /> Edit columns
          </Btn>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ scrollSnapType: "x proximity" }}>
        {cols.map((col) => (
          <section
            key={col.id}
            className={`flex max-h-[calc(100dvh-260px)] min-h-[320px] w-[290px] shrink-0 flex-col rounded-2xl border bg-[#f6f7f5] transition ${over === col.id ? "border-hive-500 ring-4 ring-hive-100" : "border-ink-400/15"}`}
            style={{ scrollSnapAlign: "start" }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (drag) move(drag.id, drag.from, col.id);
              setDrag(null);
            }}
          >
            <header className="flex items-center gap-2 border-b border-ink-400/10 px-3.5 py-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
              <h3 className="flex-1 truncate text-sm font-bold text-ink-900">{col.name}</h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-ink-500 ring-1 ring-ink-400/15">{col.total}</span>
            </header>
            <ul className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
              {col.cards.map((c: any) => (
                <li
                  key={c._id}
                  draggable={perm.update}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", c._id);
                    setDrag({ id: c._id, from: col.id });
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  className={`group rounded-xl border border-ink-400/10 bg-white p-3 shadow-card transition hover:shadow-lift ${perm.update ? "cursor-grab active:cursor-grabbing" : ""} ${drag?.id === c._id ? "opacity-40" : ""}`}
                >
                  <div className="flex items-start gap-1.5">
                    {perm.update && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-ink-400/60" />}
                    <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(c._id)}>
                      <p className="truncate text-sm font-semibold text-ink-900 group-hover:text-hive-700">{c.name || "NA"}</p>
                      <p className="mono text-[11.5px] text-hive-800">{c.clientCode}</p>
                    </button>
                    <span className="shrink-0 text-[11px] text-ink-400" title="Time in this status">
                      {ago(c.stageAt)}
                    </span>
                  </div>
                  {(c.services || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.services.slice(0, 3).map((s: string) => (
                        <span key={s} className="rounded-md bg-hive-50 px-1.5 py-0.5 text-[11px] font-semibold text-hive-800">
                          {s}
                        </span>
                      ))}
                      {c.services.length > 3 && <span className="text-[11px] text-ink-400">+{c.services.length - 3}</span>}
                    </div>
                  )}
                  {perm.update && (
                    <select className="mt-2 w-full rounded-lg border border-ink-400/15 bg-white px-2 py-1 text-xs text-ink-700 lg:hidden" value={col.id} onChange={(e) => move(c._id, col.id, e.target.value)} aria-label="Move to">
                      {cols.map((x) => (
                        <option key={x.id} value={x.id}>
                          Move to: {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
              {!col.cards.length && <li className="rounded-xl border-2 border-dashed border-ink-400/15 px-3 py-6 text-center text-xs text-ink-400">Drop clients here</li>}
              {col.total > col.cards.length && <li className="px-1 text-center text-xs text-ink-500">+{col.total - col.cards.length} more — search to find a client</li>}
            </ul>
          </section>
        ))}
      </div>
      <ColumnEditor
        open={edit}
        columns={cols}
        onClose={() => setEdit(false)}
        onSaved={(moved) => {
          setEdit(false);
          if (moved) toast("ok", `Columns saved — clients in removed columns moved to “${cols[0]?.name}”`);
          else toast("ok", "Columns saved");
          load();
        }}
      />
      <ClientProfile id={open} onClose={() => setOpen(null)} onSaved={load} />
    </>
  );
}

function ColumnEditor({ open, columns, onClose, onSaved }: { open: boolean; columns: any[]; onClose: () => void; onSaved: (moved: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) setRows(columns.map((c) => ({ id: c.id, name: c.name, color: c.color, total: c.total })));
  }, [open, columns]);
  const set = (i: number, k: string, v: any) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= rows.length) return;
    const n = [...rows];
    [n[i], n[j]] = [n[j], n[i]];
    setRows(n);
  };
  async function save() {
    setBusy(true);
    try {
      const r = await api("/co/clients-board/columns", { method: "PUT", body: { columns: rows.map(({ id, name, color }) => ({ id, name, color })) } });
      onSaved(r.moved);
    } catch (e: any) {
      toast("err", e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit board columns"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn loading={busy} onClick={save}>
            Save columns
          </Btn>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-500">Rename, recolour, reorder or delete columns. The first column is where new clients start; clients in a deleted column move there.</p>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id || i} className="flex items-center gap-2 rounded-xl border border-ink-400/15 p-2">
            <div className="flex flex-col">
              <button type="button" className="rounded p-0.5 text-ink-400 hover:bg-hive-50 disabled:opacity-30" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Move up">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="rounded p-0.5 text-ink-400 hover:bg-hive-50 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move down">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="relative">
              <select className="h-9 w-12 cursor-pointer appearance-none rounded-lg border border-ink-400/20 text-transparent" style={{ background: r.color }} value={r.color} onChange={(e) => set(i, "color", e.target.value)} aria-label="Colour">
                {SWATCHES.map((c) => (
                  <option key={c} value={c} style={{ background: c, color: "#fff" }}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <input className="input h-9 flex-1" maxLength={40} value={r.name} onChange={(e) => set(i, "name", e.target.value)} aria-label="Column name" />
            {r.total > 0 && <span className="text-xs text-ink-500">{r.total}</span>}
            <button type="button" className="btn-ghost text-red-600 disabled:opacity-30" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Delete ${r.name}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <Btn variant="secondary" className="mt-3" disabled={rows.length >= 20} onClick={() => setRows([...rows, { name: `New column ${rows.length + 1}`, color: SWATCHES[rows.length % SWATCHES.length], total: 0 }])}>
        <Plus className="h-4 w-4" /> Add column
      </Btn>
    </Modal>
  );
}
