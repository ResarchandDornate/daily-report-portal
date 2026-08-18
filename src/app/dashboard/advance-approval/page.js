"use client";

import React, { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  useMe,
  useAdvanceRequests,
  useCreateAdvanceRequest,
  useUpdateAdvanceRequest,
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
  sent_by_manager: "",
  // Flat totals per category — the modal no longer asks for days × rate;
  // the employee just types the amount for each bucket.  Behind the
  // scenes we still POST accommodation_days=1 + accommodation_rate=amount
  // (and same for conveyance) so the backend model doesn't need a
  // migration and old rows keep round-tripping.
  accommodation_amount: "",
  food_amount: "",
  conveyance_amount: "",
};

function calcTourDays(from, to) {
  if (!from || !to) return 0;
  const d = (new Date(to) - new Date(from)) / 86400000;
  return Math.max(0, Math.round(d) + 1);
}

// Read a legacy `_days × _rate` cell as a single flat amount.  Handles
// rows submitted BEFORE the form was flattened — e.g. Biswanath entered
// days=0 + rate=7000 which multiplies to ₹0 but the intent was ₹7,000.
// Priority: honour the product when both sides are non-zero; else fall
// back to whichever side has a value; else 0.
function legacyFlatAmount(days, rate) {
  const d = Number(days) || 0;
  const r = Number(rate) || 0;
  if (d > 0 && r > 0) return d * r;
  if (r > 0) return r;
  if (d > 0) return d;
  return 0;
}

function calcTotal(form) {
  const acc = Number(form.accommodation_amount) || 0;
  const food = Number(form.food_amount) || 0;
  const conv = Number(form.conveyance_amount) || 0;
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

// ── Apply / Edit Modal ────────────────────────────────────────────────────────
// When `editing` is provided (an existing request row), the modal switches to
// edit mode: fields pre-fill from the row, and Save issues PATCH instead of
// POST.  Same form UI either way to avoid duplication.
function ApplyModal({ onClose, editing }) {
  const [form, setForm] = useState(() => {
    if (!editing) return EMPTY_FORM;
    // Prefill from legacy `_days × _rate` if the row was created before
    // the form was flattened.  `legacyFlatAmount` picks the sensible
    // number when only one side was filled (e.g. Biswanath's row).
    return {
      employee_names_raw: (editing.employee_names || []).join(", "),
      city: editing.city || "",
      travel_date: editing.travel_date || "",
      return_date: editing.return_date || "",
      mode_going: editing.mode_going || "",
      mode_return: editing.mode_return || "",
      purpose: editing.purpose || "",
      sent_by_manager: editing.sent_by_manager || "",
      accommodation_amount: legacyFlatAmount(editing.accommodation_days, editing.accommodation_rate) || "",
      food_amount: editing.food_amount ?? "",
      conveyance_amount: legacyFlatAmount(editing.conveyance_days, editing.conveyance_rate) || "",
    };
  });
  const create = useCreateAdvanceRequest();
  const update = useUpdateAdvanceRequest();
  const busy = editing ? update.isPending : create.isPending;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const tourDays = calcTourDays(form.travel_date, form.return_date);
  const accTotal = Number(form.accommodation_amount) || 0;
  const foodTotal = Number(form.food_amount) || 0;
  const convTotal = Number(form.conveyance_amount) || 0;
  const total = accTotal + foodTotal + convTotal;

  async function handleSubmit(e) {
    e.preventDefault();
    const names = form.employee_names_raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) { toast.error("Add at least one employee name"); return; }
    if (!form.travel_date || !form.return_date) { toast.error("Enter travel and return dates"); return; }
    if (!form.mode_going || !form.mode_return) { toast.error("Select mode of travel"); return; }
    // Guard against zero-total submissions.  Before this check, an employee
    // could fill the trip details and skip the Expense Summary entirely,
    // producing a ₹0 request that HR then had to reject.  Force at least
    // one expense category to be non-zero so the total reflects a real ask.
    if (total <= 0) {
      toast.error("Fill in at least one expense category — total can't be ₹0.");
      return;
    }
    const payload = {
      employee_names: names,
      city: form.city,
      travel_date: form.travel_date,
      return_date: form.return_date,
      tour_days: tourDays,
      mode_going: form.mode_going,
      mode_return: form.mode_return,
      purpose: form.purpose,
      sent_by_manager: form.sent_by_manager,
      // Store flat amounts inside the existing `_days` × `_rate` columns
      // (days=1, rate=amount) so days×rate=amount and no backend migration
      // is needed.  When the row is edited later, `legacyFlatAmount()`
      // reads it back cleanly.
      accommodation_days: accTotal > 0 ? 1 : 0,
      accommodation_rate: accTotal,
      food_amount: foodTotal,
      conveyance_days: convTotal > 0 ? 1 : 0,
      conveyance_rate: convTotal,
      total_amount: total,
    };
    if (editing) {
      await update.mutateAsync({ id: editing.id, ...payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-5xl bg-white shadow-2xl rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3">
          <h2 className="text-base font-semibold text-zinc-900">
            {editing ? "Edit Travel Advance Request" : "Apply for Travel Advance"}
          </h2>
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

                {/* Sent by Manager — free-text name of the manager who
                    authorised the trip.  Helps HR trace the approval
                    chain before releasing the advance. */}
                <div className="grid grid-cols-2 divide-x divide-zinc-100 border-t border-zinc-100">
                  <div className="px-3 py-3 bg-zinc-50 flex items-center">
                    <p className="text-xs font-semibold text-zinc-600">Sent by Manager</p>
                  </div>
                  <div className="px-3 py-3">
                    <input
                      type="text"
                      maxLength={255}
                      className="w-full text-sm text-zinc-900 outline-none placeholder:text-zinc-300"
                      placeholder="e.g. Vikash Kumar"
                      value={form.sent_by_manager}
                      onChange={(e) => set("sent_by_manager", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Expense Summary ──
                Simplified to a single amount per category — no more
                days × rate.  Employee just types the total they want
                for each bucket. */}
            <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden">
              <div className="bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-orange-700 border-b border-orange-100">
                Expense Summary
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right w-36">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {/* Accommodation */}
                  <tr>
                    <td className="px-3 py-3 text-zinc-700">Accommodation</td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" placeholder="0"
                        className="w-full text-right text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.accommodation_amount}
                        onChange={(e) => set("accommodation_amount", e.target.value)} />
                    </td>
                  </tr>
                  {/* Food */}
                  <tr>
                    <td className="px-3 py-3 text-zinc-700">Food</td>
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
                        className="w-full text-right text-zinc-900 outline-none bg-zinc-50 rounded px-2 py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={form.conveyance_amount}
                        onChange={(e) => set("conveyance_amount", e.target.value)} />
                    </td>
                  </tr>
                  {/* Total */}
                  <tr className="bg-orange-50">
                    <td className="px-3 py-3 font-bold text-zinc-900">Total</td>
                    <td className="px-3 py-3 text-right font-bold text-orange-700 text-base">
                      ₹ {fmt(total)}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {busy
                ? (editing ? "Saving…" : "Submitting…")
                : (editing ? "Save Changes" : "Submit for Approval")}
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

// ── Breakdown row ─────────────────────────────────────────────────────────────
// One line in the Expense Breakdown card — a flat amount per category.
// `legacyFlatAmount` collapses old "days × rate" storage into a single
// number for display, so pre-flattening rows still render correctly.
function BreakdownRow({ label, amount }) {
  const a = Number(amount) || 0;
  return (
    <div className="flex justify-between">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-800 tabular-nums">
        {a > 0
          ? <span className="font-semibold">₹{fmt(a)}</span>
          : <span className="text-zinc-400 italic font-normal">Not entered</span>}
      </dd>
    </div>
  );
}


// ── Requests Table ────────────────────────────────────────────────────────────
// Interactive summary of every advance request.  Row click toggles a
// details panel below the row (only one row expanded at a time).
// Sent by Manager sits between Submitted By and Destination.
function RequestsTable({ rows, isLoading, isApprover, meId, onApprove, onReject, onEdit, onDelete, decidePending }) {
  const [expandedId, setExpandedId] = useState(null);
  const toggleExpanded = (id) => setExpandedId((cur) => (cur === id ? null : id));

  const COL_COUNT = 11;

  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-100 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
              <th className="px-4 py-3.5 text-left w-10">#</th>
              <th className="px-4 py-3.5 text-left">Employee(s)</th>
              <th className="px-4 py-3.5 text-left">Submitted By</th>
              <th className="px-4 py-3.5 text-left">Sent by Manager</th>
              <th className="px-4 py-3.5 text-left">Destination</th>
              <th className="px-4 py-3.5 text-left">Travel Date</th>
              <th className="px-4 py-3.5 text-left">Return Date</th>
              <th className="px-4 py-3.5 text-center">Days</th>
              <th className="px-4 py-3.5 text-right">Total (₹)</th>
              <th className="px-4 py-3.5 text-center">Status</th>
              <th className="px-4 py-3.5 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-14 text-center text-sm text-zinc-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-14 text-center text-sm text-zinc-400">
                  No advance requests match the current filters. Click{" "}
                  <span className="font-medium text-zinc-600">"Apply Advance"</span>{" "}
                  to submit one, or clear the filters to see everything.
                </td>
              </tr>
            ) : null}
            {rows.map((req, i) => {
              const sm = STATUS_META[req.status] || STATUS_META.pending;
              const isOpen = expandedId === req.id;
              // Use legacyFlatAmount so rows submitted before the form
              // was flattened (Biswanath-style: days=0 + rate=7000) still
              // display their intended amount.
              const accTotal = legacyFlatAmount(req.accommodation_days, req.accommodation_rate);
              const foodTotal = Number(req.food_amount) || 0;
              const convTotal = legacyFlatAmount(req.conveyance_days, req.conveyance_rate);
              // Prefer the computed sum of the parts so legacy rows —
              // where total_amount was stored as ₹0 because days=0 —
              // still show the right figure.  Fall back to the stored
              // value if the parts are all zero (defends against a real
              // legitimately-zero row, which the submission guard now
              // prevents anyway).
              const partsTotal = accTotal + foodTotal + convTotal;
              const displayTotal = partsTotal > 0 ? partsTotal : (Number(req.total_amount) || 0);
              const breakdown = `Accommodation ₹${fmt(accTotal)}  ·  Food ₹${fmt(foodTotal)}  ·  Local ₹${fmt(convTotal)}`;
              return (
                <React.Fragment key={req.id}>
                  <tr
                    className="hover:bg-zinc-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpanded(req.id)}
                  >
                    <td className="px-4 py-3 text-zinc-400 text-xs font-medium">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900 max-w-[160px] truncate" title={(req.employee_names || []).join(", ")}>
                      {(req.employee_names || []).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{req.created_by_name}</td>
                    <td className="px-4 py-3 text-zinc-700 whitespace-nowrap max-w-[160px] truncate" title={req.sent_by_manager || ""}>
                      {req.sent_by_manager || <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">{req.city || "—"}</td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmtDate(req.travel_date)}</td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmtDate(req.return_date)}</td>
                    <td className="px-4 py-3 text-center text-zinc-700 font-medium" title={`${fmtDate(req.travel_date)} → ${fmtDate(req.return_date)}`}>
                      {req.tour_days}
                    </td>
                    <td
                      className="px-4 py-3 text-right font-semibold whitespace-nowrap"
                      title={breakdown}
                    >
                      {displayTotal === 0 ? (
                        <span className="inline-flex items-center gap-1 text-rose-600" title="No expense breakdown filled — employee must edit before HR can approve.">
                          ⚠︎ ₹ 0
                        </span>
                      ) : (
                        <span className="text-orange-700">₹ {fmt(displayTotal)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sm.cls}`}>
                        {sm.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        {isApprover && req.status === "pending" && (
                          <>
                            <button onClick={() => onApprove(req)}
                              disabled={decidePending}
                              className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                              Approve
                            </button>
                            <button onClick={() => onReject(req)}
                              disabled={decidePending}
                              className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">
                              Reject
                            </button>
                          </>
                        )}
                        {!isApprover && req.status === "pending" && req.created_by_id === meId && (
                          <>
                            <button onClick={() => onEdit(req)}
                              className="rounded border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100">
                              Edit
                            </button>
                            <button onClick={() => onDelete(req.id)}
                              className="rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
                              Withdraw
                            </button>
                          </>
                        )}
                        {req.status !== "pending" && (
                          <span className="text-xs text-zinc-400 italic">
                            {req.decided_by_name ? `by ${req.decided_by_name}` : "—"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-zinc-50/70">
                      <td colSpan={COL_COUNT} className="px-4 py-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                          {/* Trip block */}
                          <div className="rounded-md border border-zinc-200 bg-white p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Trip</p>
                            <dl className="mt-1.5 space-y-1 text-[12px]">
                              <div className="flex gap-2"><dt className="w-24 text-zinc-500">Mode Going</dt><dd className="text-zinc-800">{req.mode_going || "—"}</dd></div>
                              <div className="flex gap-2"><dt className="w-24 text-zinc-500">Mode Return</dt><dd className="text-zinc-800">{req.mode_return || "—"}</dd></div>
                              <div className="flex gap-2"><dt className="w-24 text-zinc-500">Days</dt><dd className="text-zinc-800">{req.tour_days} ({fmtDate(req.travel_date)} → {fmtDate(req.return_date)})</dd></div>
                              <div className="flex gap-2"><dt className="w-24 text-zinc-500">Purpose</dt><dd className="text-zinc-800 whitespace-pre-wrap">{req.purpose || "—"}</dd></div>
                            </dl>
                          </div>
                          {/* Expense breakdown — shows a clean summary
                              per category.  Only draws "days × rate = total"
                              when BOTH days and rate are non-zero; if the
                              employee entered a rate but skipped days (or
                              vice-versa), we flag it as "Not entered" so
                              HR can spot the incomplete row instead of
                              reading a confusing "0 × ₹7,000 = ₹0". */}
                          <div className="rounded-md border border-zinc-200 bg-white p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Expense Breakdown</p>
                            <dl className="mt-1.5 space-y-1 text-[12px]">
                              <BreakdownRow label="Accommodation" amount={accTotal} />
                              <BreakdownRow label="Food" amount={foodTotal} />
                              <BreakdownRow label="Local Conveyance" amount={convTotal} />
                              <div className="mt-2 border-t border-zinc-100 pt-1.5 flex justify-between">
                                <dt className="text-zinc-700 font-semibold">Total</dt>
                                <dd className={`tabular-nums font-bold ${displayTotal === 0 ? "text-rose-600" : "text-orange-700"}`}>
                                  ₹{fmt(displayTotal)}
                                </dd>
                              </div>
                            </dl>
                          </div>
                          {/* Approval / audit */}
                          <div className="rounded-md border border-zinc-200 bg-white p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Audit</p>
                            <dl className="mt-1.5 space-y-1 text-[12px]">
                              <div className="flex gap-2"><dt className="w-24 text-zinc-500">Submitted</dt><dd className="text-zinc-800">{req.created_at ? fmtDate((req.created_at || "").slice(0, 10)) : "—"}</dd></div>
                              <div className="flex gap-2"><dt className="w-24 text-zinc-500">Manager</dt><dd className="text-zinc-800">{req.sent_by_manager || "—"}</dd></div>
                              {req.decision_note && (
                                <div className="flex gap-2"><dt className="w-24 text-zinc-500">Note</dt><dd className="text-zinc-800 whitespace-pre-wrap">{req.decision_note}</dd></div>
                              )}
                            </dl>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
  const decide = useDecideAdvanceRequest();

  const [applyOpen, setApplyOpen] = useState(false);
  // Non-null when the owner clicks Edit — same modal, edit mode.
  const [editingReq, setEditingReq] = useState(null);
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

  // Finance (Shivangi, Saif) see every request read-only — they disburse the
  // money but don't decide.  The server applies the same rule to the list.
  const isFinanceViewer = (() => {
    if (!me) return false;
    const local = (me.email || "").toLowerCase().split("@")[0];
    return ["shivangi", "saif"].some(
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

  async function handleApprove(req) {
    // Sum the parts for the confirmation prompt too — legacy rows have
    // total_amount = 0 in the DB but their parts still reflect intent.
    const parts = legacyFlatAmount(req.accommodation_days, req.accommodation_rate)
      + (Number(req.food_amount) || 0)
      + legacyFlatAmount(req.conveyance_days, req.conveyance_rate);
    const displayTotal = parts > 0 ? parts : (Number(req.total_amount) || 0);
    if (!confirm(`Approve the travel advance of ₹${displayTotal.toLocaleString("en-IN")} for ${(req.employee_names || []).join(", ") || "—"}?`)) return;
    try {
      await decide.mutateAsync({ id: req.id, action: "approve", note: "" });
    } catch {}
  }

  async function handleReject(req) {
    const note = prompt("Reason for rejection (optional):", "") ?? null;
    if (note === null) return;  // user cancelled the prompt
    try {
      await decide.mutateAsync({ id: req.id, action: "reject", note });
    } catch {}
  }

  // Sum each row's effective total (parts if the stored total_amount is
  // ₹0 — covers legacy rows submitted before the form was flattened).
  const totalAmount = useMemo(
    () => requests.reduce((s, r) => {
      const parts = legacyFlatAmount(r.accommodation_days, r.accommodation_rate)
        + (Number(r.food_amount) || 0)
        + legacyFlatAmount(r.conveyance_days, r.conveyance_rate);
      const stored = Number(r.total_amount) || 0;
      return s + (parts > 0 ? parts : stored);
    }, 0),
    [requests],
  );

  return (
    <div className="space-y-4">
      {/* Header — matches expense page gradient style */}
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5">
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">Advance Approval</h1>
            <p className="text-[11px] text-zinc-600">
              {isApprover
                ? "Review and decide travel advance requests."
                : isFinanceViewer
                  ? "All travel advance requests across the company."
                  : "Apply for travel advance — sent to HR for approval."}
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
        meId={me?.id}
        onApprove={handleApprove}
        onReject={handleReject}
        onEdit={setEditingReq}
        onDelete={handleDelete}
        decidePending={decide.isPending}
      />

      {applyOpen && <ApplyModal onClose={() => setApplyOpen(false)} />}
      {editingReq && (
        <ApplyModal
          editing={editingReq}
          onClose={() => setEditingReq(null)}
        />
      )}
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
