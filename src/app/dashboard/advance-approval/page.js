"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  useMe,
  useAdvanceRequests,
  useCreateAdvanceRequest,
  useDecideAdvanceRequest,
  useDeleteAdvanceRequest,
} from "@/lib/queries";

const MODES = ["Train", "Flight", "Bus", "Car", "Cab", "Bike", "Others"];

const STATUS_META = {
  pending:  { label: "Pending",  cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
};

const EMPTY_FORM = {
  employee_names_raw: "",   // comma-separated input
  city: "",
  travel_date: "",
  return_date: "",
  mode_going: "",
  mode_return: "",
  purpose: "",
  accommodation_days: "",
  accommodation_rate: "",
  food_amount: "",
  conveyance_days: "",
  conveyance_rate: "",
};

function calcTourDays(from, to) {
  if (!from || !to) return 0;
  const d = (new Date(to) - new Date(from)) / 86400000;
  return Math.max(0, Math.round(d) + 1);
}

function calcTotal(form) {
  const acc = (Number(form.accommodation_days) || 0) * (Number(form.accommodation_rate) || 0);
  const food = Number(form.food_amount) || 0;
  const conv = (Number(form.conveyance_days) || 0) * (Number(form.conveyance_rate) || 0);
  return acc + food + conv;
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-IN");
}

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
}

// ── Apply Modal ───────────────────────────────────────────────────────────────
function ApplyModal({ onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const create = useCreateAdvanceRequest();

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const tourDays = calcTourDays(form.travel_date, form.return_date);
  const accTotal = (Number(form.accommodation_days) || 0) * (Number(form.accommodation_rate) || 0);
  const convTotal = (Number(form.conveyance_days) || 0) * (Number(form.conveyance_rate) || 0);
  const total = accTotal + (Number(form.food_amount) || 0) + convTotal;

  async function handleSubmit(e) {
    e.preventDefault();
    const names = form.employee_names_raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) { toast.error("Add at least one employee name"); return; }
    if (!form.travel_date || !form.return_date) { toast.error("Enter travel and return dates"); return; }
    if (!form.mode_going || !form.mode_return) { toast.error("Select mode of travel"); return; }
    await create.mutateAsync({
      employee_names: names,
      city: form.city,
      travel_date: form.travel_date,
      return_date: form.return_date,
      tour_days: tourDays,
      mode_going: form.mode_going,
      mode_return: form.mode_return,
      purpose: form.purpose,
      accommodation_days: Number(form.accommodation_days) || 0,
      accommodation_rate: Number(form.accommodation_rate) || 0,
      food_amount: Number(form.food_amount) || 0,
      conveyance_days: Number(form.conveyance_days) || 0,
      conveyance_rate: Number(form.conveyance_rate) || 0,
      total_amount: total,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-5xl bg-white shadow-2xl rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3">
          <h2 className="text-base font-semibold text-zinc-900">Apply for Travel Advance</h2>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4">
          {/* Two-column layout: Trip Details | Expense Summary */}
          <div className="flex gap-5 items-start">

            {/* ── Left: Trip Details ── */}
            <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden">
              <div className="bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-orange-700 border-b border-orange-100">
                Trip Details
              </div>
              <div className="divide-y divide-zinc-100">

                {/* Employee Names */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50">
                    <p className="text-xs font-semibold text-zinc-600">Name(s)</p>
                    <p className="text-[10px] text-zinc-400">Comma-separated if multiple</p>
                  </div>
                  <div className="px-3 py-3">
                    <textarea
                      rows={1}
                      className="w-full text-sm text-zinc-900 outline-none resize-none placeholder:text-zinc-300"
                      placeholder="Asim Equbal, Vishwanath Nandi, Vivek Sharma"
                      value={form.employee_names_raw}
                      onChange={(e) => set("employee_names_raw", e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* City of Travel */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">City of Travel</p>
                  </div>
                  <div className="px-3 py-3">
                    <input
                      type="text"
                      className="w-full text-sm text-zinc-900 outline-none placeholder:text-zinc-300"
                      placeholder="Maharashtra"
                      value={form.city}
                      onChange={(e) => set("city", e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Date of Travel */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">Date of Travel</p>
                  </div>
                  <div className="px-3 py-3">
                    <input
                      type="date"
                      className="text-sm text-zinc-900 outline-none"
                      value={form.travel_date}
                      onChange={(e) => set("travel_date", e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Date of Return */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">Date of Return</p>
                  </div>
                  <div className="px-3 py-3">
                    <input
                      type="date"
                      className="text-sm text-zinc-900 outline-none"
                      value={form.return_date}
                      min={form.travel_date}
                      onChange={(e) => set("return_date", e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Tour Days (auto) */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">No. of Tour Days</p>
                  </div>
                  <div className="px-3 py-3 flex items-center">
                    <span className="text-sm font-semibold text-zinc-900">{tourDays || "—"}</span>
                    <span className="ml-1 text-xs text-zinc-400">(auto-calculated)</span>
                  </div>
                </div>

                {/* Mode of Travel Going */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">Mode of Travel Going</p>
                  </div>
                  <div className="px-3 py-3">
                    <select
                      className="text-sm text-zinc-900 outline-none bg-transparent"
                      value={form.mode_going}
                      onChange={(e) => set("mode_going", e.target.value)}
                      required
                    >
                      <option value="">— Select —</option>
                      {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                {/* Mode of Travel Return */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">Mode of Travel Return</p>
                  </div>
                  <div className="px-3 py-3">
                    <select
                      className="text-sm text-zinc-900 outline-none bg-transparent"
                      value={form.mode_return}
                      onChange={(e) => set("mode_return", e.target.value)}
                      required
                    >
                      <option value="">— Select —</option>
                      {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                {/* Site Survey / Purpose */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">Site Survey / Purpose</p>
                  </div>
                  <div className="px-3 py-3">
                    <textarea
                      rows={1}
                      className="w-full text-sm text-zinc-900 outline-none resize-none placeholder:text-zinc-300"
                      placeholder="Lilasons Industries, Site Survey-Crompton & Phase 3 MAH"
                      value={form.purpose}
                      onChange={(e) => set("purpose", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Expense Summary ── */}
            <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden">
              <div className="bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-orange-700 border-b border-orange-100">
                Expense Summary
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-center w-20">Days</th>
                    <th className="px-3 py-2 text-center w-28">Expense / Day (₹)</th>
                    <th className="px-3 py-2 text-right w-24">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {/* Accommodation */}
                  <tr>
                    <td className="px-3 py-3 text-zinc-700">Accommodation</td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" placeholder="0"
                        className="w-full text-center text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.accommodation_days}
                        onChange={(e) => set("accommodation_days", e.target.value)} />
                    </td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" placeholder="0"
                        className="w-full text-center text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.accommodation_rate}
                        onChange={(e) => set("accommodation_rate", e.target.value)} />
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-zinc-800">{fmt(accTotal)}</td>
                  </tr>
                  {/* Food */}
                  <tr>
                    <td className="px-3 py-3 text-zinc-700">Food</td>
                    <td className="px-3 py-3 text-center text-zinc-400 text-xs">—</td>
                    <td className="px-3 py-3 text-center text-zinc-400 text-xs">flat amount</td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" placeholder="0"
                        className="w-full text-right text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.food_amount}
                        onChange={(e) => set("food_amount", e.target.value)} />
                    </td>
                  </tr>
                  {/* Local Conveyance */}
                  <tr>
                    <td className="px-3 py-3 text-zinc-700">Local Conveyance</td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" placeholder="0"
                        className="w-full text-center text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.conveyance_days}
                        onChange={(e) => set("conveyance_days", e.target.value)} />
                    </td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" placeholder="0"
                        className="w-full text-center text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.conveyance_rate}
                        onChange={(e) => set("conveyance_rate", e.target.value)} />
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-zinc-800">{fmt(convTotal)}</td>
                  </tr>
                  {/* Total */}
                  <tr className="bg-orange-50">
                    <td colSpan={3} className="px-3 py-3 font-bold text-zinc-900">Total</td>
                    <td className="px-3 py-3 text-right font-bold text-orange-700 text-base">
                      ₹ {fmt(total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              Cancel
            </button>
            <button type="submit" disabled={create.isPending}
              className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {create.isPending ? "Submitting…" : "Submit for Approval"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Decide Modal (HR) ─────────────────────────────────────────────────────────
function DecideModal({ req, onClose }) {
  const [note, setNote] = useState("");
  const decide = useDecideAdvanceRequest();

  async function handle(action) {
    await decide.mutateAsync({ id: req.id, action, note });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">Review Advance Request</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm space-y-1">
            <p><span className="font-medium text-zinc-500">Employees:</span> {(req.employee_names || []).join(", ")}</p>
            <p><span className="font-medium text-zinc-500">Destination:</span> {req.city}</p>
            <p><span className="font-medium text-zinc-500">Travel:</span> {fmtDate(req.travel_date)} → {fmtDate(req.return_date)} ({req.tour_days} days)</p>
            <p><span className="font-medium text-zinc-500">Purpose:</span> {req.purpose || "—"}</p>
            <p className="text-base font-bold text-orange-700 pt-1">Total: ₹ {fmt(req.total_amount)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Note (optional)</label>
            <textarea rows={2} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
              placeholder="Add a comment…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
            Cancel
          </button>
          <button onClick={() => handle("reject")} disabled={decide.isPending}
            className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">
            Reject
          </button>
          <button onClick={() => handle("approve")} disabled={decide.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Requests Table ────────────────────────────────────────────────────────────
function RequestsTable({ rows, isLoading, isApprover, onDecide, onDelete }) {
  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-100 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
              <th className="px-4 py-3.5 text-left w-10">#</th>
              <th className="px-4 py-3.5 text-left">Employee(s)</th>
              <th className="px-4 py-3.5 text-left">Submitted By</th>
              <th className="px-4 py-3.5 text-left">Destination</th>
              <th className="px-4 py-3.5 text-left">Travel Date</th>
              <th className="px-4 py-3.5 text-left">Return Date</th>
              <th className="px-4 py-3.5 text-center">Days</th>
              <th className="px-4 py-3.5 text-left">Purpose</th>
              <th className="px-4 py-3.5 text-right">Total (₹)</th>
              <th className="px-4 py-3.5 text-center">Status</th>
              <th className="px-4 py-3.5 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading ? (
              <tr>
                <td colSpan={11} className="px-4 py-14 text-center text-sm text-zinc-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-14 text-center text-sm text-zinc-400">
                  No advance requests yet. Click <span className="font-medium text-zinc-600">"Apply Advance"</span> to submit one.
                </td>
              </tr>
            ) : null}
            {rows.map((req, i) => {
              const sm = STATUS_META[req.status] || STATUS_META.pending;
              return (
                <tr key={req.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 text-zinc-400 text-xs font-medium">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900 max-w-[160px] truncate" title={(req.employee_names || []).join(", ")}>
                    {(req.employee_names || []).join(", ")}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{req.created_by_name}</td>
                  <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">{req.city || "—"}</td>
                  <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmtDate(req.travel_date)}</td>
                  <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmtDate(req.return_date)}</td>
                  <td className="px-4 py-3 text-center text-zinc-700 font-medium">{req.tour_days}</td>
                  <td className="px-4 py-3 text-zinc-600 max-w-[180px] truncate" title={req.purpose || ""}>{req.purpose || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-orange-700 whitespace-nowrap">₹ {fmt(req.total_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sm.cls}`}>
                      {sm.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {isApprover && req.status === "pending" && (
                        <button onClick={() => onDecide(req)}
                          className="rounded bg-orange-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-orange-700">
                          Review
                        </button>
                      )}
                      {req.status === "pending" && (
                        <button onClick={() => onDelete(req.id)}
                          className="rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
                          Withdraw
                        </button>
                      )}
                      {req.status !== "pending" && (
                        <span className="text-xs text-zinc-400 italic">
                          {req.decided_by_name ? `by ${req.decided_by_name}` : "—"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdvanceApprovalPage() {
  const { data: me } = useMe();
  const { data: requests = [], isLoading } = useAdvanceRequests();
  const deleteReq = useDeleteAdvanceRequest();

  const [applyOpen, setApplyOpen] = useState(false);
  const [decideReq, setDecideReq] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const isApprover = (() => {
    if (!me) return false;
    if (me.role === "hr") return true;
    const local = (me.email || "").toLowerCase().split("@")[0];
    return ["tarini", "smita"].some(
      (p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "_")
    );
  })();

  const monthOptions = useMemo(() => {
    const seen = new Set();
    const now = new Date();
    seen.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    for (const r of requests) {
      if (r.travel_date && r.travel_date.length >= 7) seen.add(r.travel_date.slice(0, 7));
      if (r.created_at && r.created_at.length >= 7) seen.add(r.created_at.slice(0, 7));
    }
    return Array.from(seen).sort().reverse().map((ym) => {
      const [y, m] = ym.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
      return { value: ym, label };
    });
  }, [requests]);

  const counts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests]);

  const visible = requests
    .filter((r) => monthFilter === "all" || (r.travel_date && r.travel_date.startsWith(monthFilter)))
    .filter((r) => filter === "all" || r.status === filter)
    .filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (r.employee_names || []).join(" ").toLowerCase().includes(q) ||
        (r.city || "").toLowerCase().includes(q) ||
        (r.purpose || "").toLowerCase().includes(q) ||
        (r.created_by_name || "").toLowerCase().includes(q)
      );
    });

  async function handleDelete(id) {
    if (!confirm("Withdraw this advance request?")) return;
    await deleteReq.mutateAsync(id);
  }

  const totalAmount = useMemo(() => requests.reduce((s, r) => s + (Number(r.total_amount) || 0), 0), [requests]);

  return (
    <div className="space-y-4">
      {/* Header — matches expense page gradient style */}
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5">
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">Advance Approval</h1>
            <p className="text-[11px] text-zinc-600">
              {isApprover ? "Review and decide travel advance requests." : "Apply for travel advance — sent to HR for approval."}
            </p>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Total Requested</div>
            <div className="text-sm font-bold text-orange-700">₹{totalAmount.toLocaleString("en-IN")}</div>
          </div>
        </div>
      </header>

      {/* Toolbar — search + filter + clear + Apply Advance button */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
            <SearchIcon className="h-3.5 w-3.5" />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee, city, purpose…"
            className="w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none"
        >
          <option value="all">All months</option>
          {monthOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        {(search || filter !== "all" || monthFilter !== "all") && (
          <button
            type="button"
            onClick={() => { setSearch(""); setFilter("all"); setMonthFilter("all"); }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Clear
          </button>
        )}
        <button
          onClick={() => setApplyOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-orange-700"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Apply Advance
        </button>
      </div>

      {/* Table — always rendered; loading/empty handled inside */}
      <RequestsTable
        rows={visible}
        isLoading={isLoading}
        isApprover={isApprover}
        onDecide={setDecideReq}
        onDelete={handleDelete}
      />

      {applyOpen && <ApplyModal onClose={() => setApplyOpen(false)} />}
      {decideReq && <DecideModal req={decideReq} onClose={() => setDecideReq(null)} />}
    </div>
  );
}

/* ── Icons ── */
function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
function PlusIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function CloseIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function WalletIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M21 10h-4a2 2 0 0 0 0 4h4" />
    </svg>
  );
}
