"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPretty, todayISO } from "@/lib/data";
import {
  useCreateExpense,
  useDecideExpense,
  useDeleteExpense,
  useDepartments,
  useExpenses,
  useMe,
  useUpdateExpense,
} from "@/lib/queries";
import { Table } from "@/components/Table";

// Hardcoded server-side: TARINI + SMITA + any HR can approve.  Mirrored here
// for the helper-text banner only — the API still gates the decision call.
const APPROVER_LABEL = "Tarini & Smita";

// Order is intentional — matches HR's preferred sequence on the form, NOT
// alphabetical.  Reorder here whenever the business wants it changed.
const EXPENSE_TYPES = [
  { value: "travel",           label: "Travel" },
  { value: "food",             label: "Food" },
  { value: "sitematerial",     label: "Site Material" },
  { value: "officematerial",   label: "Office Material" },
  { value: "hotel",            label: "Hotel" },
  { value: "officereimburse",  label: "Office Reimburse" },
  { value: "others",           label: "Others" },
];

// Top-level travel choices.  "other" opens a second sub-dropdown for the
// less-common modes (bus / auto / metro).
const TRAVEL_TYPES = [
  { value: "car",    label: "Car" },
  { value: "bike",   label: "Bike" },
  { value: "cab",    label: "Cab" },
  { value: "rapido", label: "Rapido" },
  { value: "other",  label: "Others" },
];

const TRAVEL_SUBTYPES = [
  { value: "bus",   label: "Bus" },
  { value: "auto",  label: "Auto" },
  { value: "metro", label: "Metro" },
];

// Per-km reimbursement rate (₹) for vehicles where the company pays by
// distance.  0 = no preset, employee fills in.
const PER_KM_RATES = {
  car:    10,
  bike:   5,
  cab:    0,
  rapido: 0,
};

const KM_BASED_TYPES = new Set(["car", "bike", "cab", "rapido"]);

const MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi",  label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "other", label: "Other" },
];

// Approver detection — match by the LOCAL PART of the email (before "@"),
// so variants like `tarini.aggrawal@ornatesolar.com` and `smita.s@…` still
// resolve to the right approver.  The local part is checked against a
// prefix list, so `tarini`, `tarini.aggrawal`, `tarini_a`, etc. all match.
const APPROVER_LOCAL_PREFIXES = ["tarini", "smita"];

function _isApproverEmail(email) {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  return APPROVER_LOCAL_PREFIXES.some(
    (p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "_"),
  );
}

function _isTariniEmail(email) {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  return local === "tarini" || local.startsWith("tarini.") || local.startsWith("tarini_");
}

export default function ExpensePage() {
  const { data: me } = useMe();
  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me.role === "hr") return true;
    return _isApproverEmail(me.email);
  }, [me]);
  // Tarini's account is review-only — she doesn't file her own expenses
  // through this form.  Smita + HR still get the form because they can.
  const isTariniReviewer = useMemo(() => {
    if (!me) return false;
    return _isTariniEmail(me.email);
  }, [me]);

  const { data: rawExpenses = [], isLoading } = useExpenses();
  const { data: departments = [] } = useDepartments();
  const createExpense = useCreateExpense();
  const decideExpense = useDecideExpense();
  const deleteExpense = useDeleteExpense();
  const updateExpense = useUpdateExpense();

  // Two-tier modal state for the admin view: first a list of all expenses
  // for one employee, then a per-expense detail modal opened from that list.
  // Employee view skips the employee modal and goes straight to detail.
  const [empModal, setEmpModal] = useState(null);   // { userId, userName, expenses[] } | null
  const [openModal, setOpenModal] = useState(null); // single expense row | null
  // Edit modal — only used by employees on their own pending/onhold rows.
  const [editingRow, setEditingRow] = useState(null);
  // Admin-only: monthly summary modal.
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  // Admin-only filter bar state.  All four start as "no filter".
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");     // "YYYY-MM" or "all"
  const [statusFilter, setStatusFilter] = useState("all");   // "pending" | "approved" | "rejected" | "onhold" | "all"
  // Admin view-toggle.  HR / Smita can both file their own expenses AND
  // approve others', so they need a way to swap between:
  //   "all"  — the admin grouped table across the company
  //   "mine" — the flat per-row table of just their own submissions
  // Tarini (review-only) sticks to "all" by default but can also flip.
  const [viewMode, setViewMode] = useState("all");           // "all" | "mine"

  // Apply admin filters BEFORE anything else (totals, grouping, etc).
  // Employee view ignores these filters since they can't see them.
  // Admin in "mine" mode narrows to just the admin's own user_id and skips
  // the org-wide filter bar entirely.
  const expenses = useMemo(() => {
    if (!isAdmin) return rawExpenses;
    if (viewMode === "mine") {
      return rawExpenses.filter((e) => me && e.user_id === me.id);
    }
    const q = (search || "").trim().toLowerCase();
    return rawExpenses.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (deptFilter !== "all") {
        // Match against the dept name (we don't get the slug in the expense
        // payload, so name match is the cleanest).
        const dn = (e.user_department || "").trim();
        const wanted = departments.find((d) => d.slug === deptFilter)?.name || "";
        if (dn !== wanted) return false;
      }
      if (monthFilter !== "all") {
        // monthFilter is "YYYY-MM"; expense.date is "YYYY-MM-DD".
        if (!e.date || !e.date.startsWith(monthFilter)) return false;
      }
      if (q) {
        const hay = (e.user_name || "") + " " + (e.user_department || "") + " " + (e.remarks || "");
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rawExpenses, isAdmin, viewMode, me, search, deptFilter, monthFilter, statusFilter, departments]);

  // Build a month dropdown from the months that actually have expenses
  // (newest first).  Saves admins from picking a month with no data.
  const monthOptions = useMemo(() => {
    if (!isAdmin) return [];
    const seen = new Set();
    for (const e of rawExpenses) {
      if (e.date && e.date.length >= 7) seen.add(e.date.slice(0, 7));
    }
    return Array.from(seen).sort().reverse().map((ym) => {
      const [y, m] = ym.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1)
        .toLocaleString(undefined, { month: "long", year: "numeric" });
      return { value: ym, label };
    });
  }, [rawExpenses, isAdmin]);

  // Total amount across all currently-visible expenses (admin sees company-
  // wide total; employees see their own grand total).  Formatted in Indian
  // notation — ₹1,23,456 — via toLocaleString('en-IN').
  const totalAmount = useMemo(
    () => expenses.reduce((sum, e) => sum + (e.amount || 0), 0),
    [expenses],
  );
  const totalAmountText = useMemo(
    () => `₹${totalAmount.toLocaleString("en-IN")}`,
    [totalAmount],
  );

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-linear-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-2.5 shadow-soft">
        <div aria-hidden className="absolute inset-0 bg-dot-pattern opacity-40" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">
              {isAdmin ? "Expense approvals" : "My Expenses"}
            </h1>
            <p className="text-[11px] text-zinc-600">
              {isAdmin
                ? `Review and decide expense claims submitted across the company.`
                : `Submit an expense — it goes to ${APPROVER_LABEL} for approval.`}
            </p>
          </div>
          {/* Total expense — plain inline text, Indian numbering.  The
              Monthly Summary trigger has moved down into the filter bar so
              the header stays clean. */}
          <p className="text-sm font-semibold tabular-nums text-zinc-900">
            Total Expense = <span className="text-orange-700">{totalAmountText}</span>
          </p>
        </div>
      </header>

      {/* Submission form is hidden ONLY for Tarini (review-only account).
          Smita, HR, and all other employees still see the full form. */}
      {!isTariniReviewer && (
        <ExpenseForm onSubmit={async (payload) => {
          try {
            await createExpense.mutateAsync(payload);
          } catch {
            /* toast fired by hook */
          }
        }} submitting={createExpense.isPending} />
      )}

      {/* Admin view-toggle — HR / Smita / Tarini can flip between their
          own expense list (employee-style flat table) and the company-wide
          grouped table.  Regular employees never see this toggle. */}
      {isAdmin && (
        <div className="flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-1 w-fit">
          <button
            type="button"
            onClick={() => setViewMode("mine")}
            className={
              "rounded px-3 py-1 text-xs font-medium transition " +
              (viewMode === "mine"
                ? "bg-orange-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-100")
            }
          >
            My Expenses
          </button>
          <button
            type="button"
            onClick={() => setViewMode("all")}
            className={
              "rounded px-3 py-1 text-xs font-medium transition " +
              (viewMode === "all"
                ? "bg-orange-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-100")
            }
          >
            All Employees
          </button>
        </div>
      )}

      {/* Admin-only filter bar — search by name / remarks, narrow by
          department, month, or current status.  Hidden when admin is
          viewing only their OWN expenses (their list is small enough
          without filters). */}
      {isAdmin && viewMode === "all" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee, department, remarks…"
              className="w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d.slug} value={d.slug}>{d.name}</option>
            ))}
          </select>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900"
          >
            <option value="all">All months</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="onhold">On Hold</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {(search || deptFilter !== "all" || monthFilter !== "all" || statusFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setDeptFilter("all");
                  setMonthFilter("all");
                  setStatusFilter("all");
                }}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Clear
              </button>
            )}
          </div>
          {/* Monthly Summary trigger lives alongside the filters so all the
              admin tools sit in one row. */}
          <button
            type="button"
            onClick={() => setMonthlyOpen(true)}
            className="ml-auto rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-orange-700"
          >
            Monthly Summary
          </button>
        </div>
      )}

      {/* Admin in "all" mode → grouped table (one row per employee).
          Admin in "mine" mode → flat employee-style table for their own
          submissions.  Regular employees → always the flat table. */}
      {isAdmin && viewMode === "all" ? (
        <AdminEmployeeTable
          expenses={expenses}
          isLoading={isLoading}
          decidePending={decideExpense.isPending}
          onOpenEmployee={(group) => setEmpModal(group)}
          onBatchDecide={async (group, decision) => {
            const pending = group.expenses.filter((e) => e.status === "pending");
            if (!pending.length) return;
            const verb = decision === "approved" ? "approve" : "reject";
            if (!confirm(
              `${verb[0].toUpperCase() + verb.slice(1)} all ${pending.length} pending expense(s) `
              + `for ${group.userName}? This sends ${verb} on each one.`,
            )) return;
            for (const e of pending) {
              try {
                // Sequentially — keeps DB pressure low and lets toasts settle.
                await decideExpense.mutateAsync({ id: e.id, decision, note: "" });
              } catch {
                /* per-row toast already fired */
              }
            }
          }}
        />
      ) : (
        <ExpenseTable
          rows={expenses}
          isLoading={isLoading}
          // When the admin is viewing their OWN expenses, render the table
          // in employee mode (Edit buttons, no per-row click-to-open) — they
          // act as the owner of those rows.
          isAdmin={false}
          onOpen={(row) => setOpenModal(row)}
          onEdit={(row) => setEditingRow(row)}
        />
      )}

      {/* Admin: per-employee modal listing every expense inline (with
          clickable bill thumbnails — no separate "Open" detail step). */}
      {empModal && (
        <EmployeeExpensesModal
          group={empModal}
          onClose={() => setEmpModal(null)}
        />
      )}

      {/* Employee's edit modal — only mounted for their own pending/onhold rows. */}
      {editingRow && (
        <EditExpenseModal
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSave={async (patch) => {
            try {
              await updateExpense.mutateAsync({ id: editingRow.id, ...patch });
              setEditingRow(null);
            } catch {}
          }}
          saving={updateExpense.isPending}
        />
      )}

      {/* Per-expense detail modal — used by both flows. */}
      {openModal && (
        <ExpenseModal
          row={openModal}
          isAdmin={isAdmin}
          onClose={() => setOpenModal(null)}
          onDecide={async (decision, note) => {
            try {
              await decideExpense.mutateAsync({ id: openModal.id, decision, note });
              setOpenModal(null);
            } catch {}
          }}
          onDelete={async () => {
            if (!confirm(`Delete this expense? This cannot be undone.`)) return;
            try {
              await deleteExpense.mutateAsync(openModal.id);
              setOpenModal(null);
            } catch {}
          }}
          decidePending={decideExpense.isPending}
          deletePending={deleteExpense.isPending}
        />
      )}

      {/* Admin-only: monthly expense summary across the whole company. */}
      {monthlyOpen && isAdmin && (
        <MonthlySummaryModal
          allExpenses={expenses}
          onClose={() => setMonthlyOpen(false)}
        />
      )}
    </div>
  );
}

function ExpenseForm({ onSubmit, submitting }) {
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState("cash");
  const [expenseType, setExpenseType] = useState("food");
  // Two-level travel selection.  travelType holds the top-level pick
  // (car / bike / cab / rapido / other).  travelSubtype is only used
  // when travelType === "other"; its value (bus / auto / metro) is what
  // actually gets sent to the API as the final travel_type.
  const [travelType, setTravelType] = useState("");
  const [travelSubtype, setTravelSubtype] = useState("");
  // Distance + rate inputs, only relevant for car / bike / cab / rapido.
  // Defaults fill in from PER_KM_RATES when travelType changes.
  const [kilometers, setKilometers] = useState("");
  const [ratePerKm, setRatePerKm] = useState("");
  const [amount, setAmount] = useState("");
  // Advance — money HR already gave the employee before incurring this
  // expense.  Subtotal owed = amount - advance.  Defaults to 0.
  const [advance, setAdvance] = useState("");
  const [remarks, setRemarks] = useState("");
  const [bills, setBills] = useState([]);        // File[]
  const [previews, setPreviews] = useState([]);  // { name, url|null }[]

  // Reset every travel-only field when switching away from travel.
  useEffect(() => {
    if (expenseType !== "travel") {
      if (travelType) setTravelType("");
      if (travelSubtype) setTravelSubtype("");
      if (kilometers) setKilometers("");
      if (ratePerKm) setRatePerKm("");
    }
  }, [expenseType]); // eslint-disable-line react-hooks/exhaustive-deps

  // When travel type changes, pre-fill rate (Bike ₹5, Car ₹10; Cab/Rapido
  // stay editable from 0), clear the distance, and reset the sub-type if
  // we've moved away from "Others".
  useEffect(() => {
    if (KM_BASED_TYPES.has(travelType)) {
      setRatePerKm(String(PER_KM_RATES[travelType] ?? 0));
      setKilometers("");
    } else {
      setRatePerKm("");
      setKilometers("");
    }
    if (travelType !== "other" && travelSubtype) {
      setTravelSubtype("");
    }
  }, [travelType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compute amount = km × rate whenever either changes.  Users can
  // still type a custom amount afterwards; the next km/rate change will
  // re-overwrite it (that's the trade-off for keeping the auto-fill simple).
  useEffect(() => {
    if (!KM_BASED_TYPES.has(travelType)) return;
    const km = parseFloat(kilometers);
    const rate = parseFloat(ratePerKm);
    if (Number.isFinite(km) && Number.isFinite(rate) && km >= 0 && rate >= 0) {
      const computed = Math.round(km * rate);
      setAmount(String(computed));
    }
  }, [kilometers, ratePerKm, travelType]);

  // Build object-URL previews for any image bills.  PDFs / other files
  // render as a name-only card with no `url`.  Cleaned up on unmount or
  // whenever the selection changes.
  useEffect(() => {
    if (!bills.length) { setPreviews([]); return; }
    const next = bills.map((f) => ({
      name: f.name,
      url: f.type?.startsWith("image/") ? URL.createObjectURL(f) : null,
    }));
    setPreviews(next);
    return () => {
      for (const p of next) {
        if (p.url) URL.revokeObjectURL(p.url);
      }
    };
  }, [bills]);

  function addFiles(fileList) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    // De-dup by (name, size) so picking the same file twice doesn't
    // attach it twice.
    setBills((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      // Cap at 10 to match the server limit; warn if dropped.
      if (merged.length > 10) {
        toast.error("Max 10 bills per expense — extras were dropped.");
        return merged.slice(0, 10);
      }
      return merged;
    });
  }

  function removeBillAt(idx) {
    setBills((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Amount must be a non-negative number.");
      return;
    }
    const adv = parseInt(advance, 10) || 0;
    if (adv < 0) {
      toast.error("Advance must be a non-negative number.");
      return;
    }
    if (adv > amt) {
      toast.error("Advance can't be larger than the expense amount.");
      return;
    }
    let finalTravelType = "";
    if (expenseType === "travel") {
      if (!travelType) {
        toast.error("Pick a travel type (car, bike, cab, rapido, or others).");
        return;
      }
      if (travelType === "other") {
        if (!travelSubtype) {
          toast.error("Pick the sub-mode (bus, auto, metro).");
          return;
        }
        finalTravelType = travelSubtype;
      } else {
        finalTravelType = travelType;
      }
    }

    // Audit prefix on km-based travel — gives the approver a clear breakdown
    // of how the amount was derived (km × rate).
    let finalRemarks = remarks.trim();
    if (KM_BASED_TYPES.has(travelType) && kilometers && ratePerKm) {
      const audit = `${kilometers} km × ₹${ratePerKm}/km = ₹${amt}`;
      finalRemarks = finalRemarks ? `${audit} — ${finalRemarks}` : audit;
    }

    onSubmit({
      date,
      mode,
      expense_type: expenseType,
      travel_type: finalTravelType,
      amount: amt,
      advance: adv,
      remarks: finalRemarks,
      bills,
    }).then(() => {
      // Reset form on success — keep date so multiple same-day submissions
      // are fast.
      setAmount("");
      setAdvance("");
      setRemarks("");
      setBills([]);
      setKilometers("");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">New expense</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Date">
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Payment Mode">
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Expense Type">
          <select
            value={expenseType}
            onChange={(e) => setExpenseType(e.target.value)}
            className={inputClass}
            required
          >
            {EXPENSE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        {expenseType === "travel" && (
          <Field label="Travel Type">
            <select
              value={travelType}
              onChange={(e) => setTravelType(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select…</option>
              {TRAVEL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
        )}
        {expenseType === "travel" && travelType === "other" && (
          <Field label="Sub-mode">
            <select
              value={travelSubtype}
              onChange={(e) => setTravelSubtype(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select…</option>
              {TRAVEL_SUBTYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
        )}
        {expenseType === "travel" && KM_BASED_TYPES.has(travelType) && (
          <>
            <Field label="Distance (km)">
              <input
                type="number"
                min={0}
                step="0.1"
                value={kilometers}
                onChange={(e) => setKilometers(e.target.value)}
                placeholder="0"
                className={inputClass}
                required
              />
            </Field>
            <Field label="Rate (₹ / km)">
              <input
                type="number"
                min={0}
                step="0.5"
                value={ratePerKm}
                onChange={(e) => setRatePerKm(e.target.value)}
                placeholder="0"
                className={inputClass}
                required
              />
            </Field>
          </>
        )}
        <Field label="Amount (₹)">
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Advance received (₹, optional)">
          <input
            type="number"
            min={0}
            value={advance}
            onChange={(e) => setAdvance(e.target.value)}
            placeholder="0"
            className={inputClass}
          />
          {amount && advance && parseInt(advance, 10) > 0 && (
            <p className="mt-1 text-[10px] text-emerald-700">
              Subtotal owed: ₹
              {Math.max(
                0,
                (parseInt(amount, 10) || 0) - (parseInt(advance, 10) || 0),
              ).toLocaleString("en-IN")}
            </p>
          )}
        </Field>
        <Field label="Bills / Receipts (up to 10 — image or PDF)">
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              // Reset the input so the same file can be re-picked after
              // being removed.
              e.target.value = "";
            }}
            className={`${inputClass} cursor-pointer file:mr-2 file:rounded-sm file:border-0 file:bg-orange-100 file:px-2 file:py-0.5 file:text-[11px] file:font-medium file:text-orange-800 hover:file:bg-orange-200`}
          />
          {previews.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {previews.map((p, idx) => (
                <div
                  key={`${p.name}-${idx}`}
                  className="group relative h-16 w-16 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                  title={p.name}
                >
                  {p.url ? (
                    <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-zinc-500">
                      PDF
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeBillAt(idx)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-zinc-900/70 px-1.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${p.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {bills.length > 0 && (
            <p className="mt-1 text-[10px] text-zinc-500">
              {bills.length} file{bills.length === 1 ? "" : "s"} selected — click ✕ on a thumbnail to remove.
            </p>
          )}
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Remarks">
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="What was this for?"
              className={`${inputClass} resize-y`}
            />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit expense"}
        </button>
      </div>
    </form>
  );
}

// ---- Admin (Tarini / Smita / HR) — grouped per-employee table ----

function groupExpensesByUser(expenses) {
  const byUser = new Map();
  for (const e of expenses) {
    const key = e.user_id;
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: e.user_id,
        userName: e.user_name || "—",
        userDepartment: e.user_department || "",
        expenses: [],
        total: 0,
        advance: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        onHoldCount: 0,
        withBillsCount: 0,
        latestExpenseDate: e.date,
        latestSubmitAt: e.created_at,
      });
    }
    const g = byUser.get(key);
    g.expenses.push(e);
    g.total += (e.amount || 0);
    g.advance += (e.advance || 0);
    if (e.status === "pending") g.pendingCount += 1;
    else if (e.status === "approved") g.approvedCount += 1;
    else if (e.status === "rejected") g.rejectedCount += 1;
    else if (e.status === "onhold") g.onHoldCount += 1;
    if ((e.bills || []).length > 0) g.withBillsCount += 1;
    if (e.date > g.latestExpenseDate) g.latestExpenseDate = e.date;
    if ((e.created_at || "") > (g.latestSubmitAt || "")) g.latestSubmitAt = e.created_at;
  }
  // Sort: pending count desc (most-urgent first), then by name.
  return Array.from(byUser.values()).sort((a, b) => {
    if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
    return a.userName.localeCompare(b.userName);
  });
}

function AdminEmployeeTable({ expenses, isLoading, decidePending, onOpenEmployee, onBatchDecide }) {
  const groups = useMemo(() => groupExpensesByUser(expenses), [expenses]);
  return (
    <Table maxHeight={520}>
      <Table.Head>
        <Table.Row>
          <Table.Th>Date</Table.Th>
          <Table.Th>Employee</Table.Th>
          <Table.Th>Total Amount</Table.Th>
          <Table.Th>Advance</Table.Th>
          <Table.Th>Subtotal</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Bills</Table.Th>
          <Table.Th>Submit Date</Table.Th>
          <Table.Th className="text-right">Actions</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {isLoading ? (
          <Table.Empty colSpan={9} message="Loading expenses…" />
        ) : groups.length === 0 ? (
          <Table.Empty colSpan={9} message="No expenses to review yet." />
        ) : (
          groups.map((g) => (
            <Table.Row
              key={g.userId}
              onClick={() => onOpenEmployee(g)}
              className="cursor-pointer hover:bg-zinc-50"
            >
              <Table.Td className="whitespace-nowrap">{formatPretty(g.latestExpenseDate)}</Table.Td>
              <Table.Td>
                <div className="font-medium text-zinc-900">{g.userName}</div>
                {g.userDepartment && (
                  <div className="text-[10px] text-zinc-500">{g.userDepartment}</div>
                )}
                <div className="mt-0.5 text-[10px] text-zinc-400">
                  {g.expenses.length} expense{g.expenses.length === 1 ? "" : "s"}
                </div>
              </Table.Td>
              <Table.Td className="tabular-nums font-semibold text-zinc-900">
                ₹{(g.total || 0).toLocaleString("en-IN")}
              </Table.Td>
              <Table.Td className="tabular-nums text-zinc-700">
                {g.advance > 0 ? `₹${g.advance.toLocaleString("en-IN")}` : "—"}
              </Table.Td>
              <Table.Td className="tabular-nums font-semibold text-emerald-700">
                ₹{Math.max(0, (g.total || 0) - (g.advance || 0)).toLocaleString("en-IN")}
              </Table.Td>
              <Table.Td>
                <GroupStatusPill
                  pending={g.pendingCount}
                  onHold={g.onHoldCount}
                  rejected={g.rejectedCount}
                  approved={g.approvedCount}
                />
              </Table.Td>
              <Table.Td>
                <BillCountIndicator withBills={g.withBillsCount} total={g.expenses.length} />
              </Table.Td>
              <Table.Td className="whitespace-nowrap text-zinc-700">
                {g.latestSubmitAt
                  ? formatPretty(String(g.latestSubmitAt).slice(0, 10))
                  : "—"}
              </Table.Td>
              <Table.Td className="text-right">
                {g.pendingCount > 0 ? (
                  <div
                    className="flex items-center justify-end gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={decidePending}
                      onClick={() => onBatchDecide(g, "rejected")}
                      className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={decidePending}
                      onClick={() => onBatchDecide(g, "onhold")}
                      className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                    >
                      On Hold
                    </button>
                    <button
                      type="button"
                      disabled={decidePending}
                      onClick={() => onBatchDecide(g, "approved")}
                      className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Approve
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-zinc-400">No pending</span>
                )}
              </Table.Td>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table>
  );
}

function GroupStatusPill({ pending, onHold, rejected, approved }) {
  // Show a single status label for an employee's expense group, picking
  // the MOST URGENT state across all their expenses.  Priority:
  //   Pending  >  On Hold  >  Rejected  >  Approved
  // (Pending is most urgent because HR has to act on it.)
  let status;
  if (pending > 0)       status = "pending";
  else if (onHold > 0)   status = "onhold";
  else if (rejected > 0) status = "rejected";
  else if (approved > 0) status = "approved";
  else return <span className="text-zinc-400">—</span>;
  return <StatusPill status={status} />;
}

function StatusMix({ pending, approved, rejected, onHold }) {
  const items = [
    { count: pending,  cls: "bg-amber-50 text-amber-800 ring-amber-200",   label: "P",  title: "Pending"  },
    { count: onHold,   cls: "bg-sky-50 text-sky-700 ring-sky-200",         label: "OH", title: "On Hold"  },
    { count: approved, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "A",  title: "Approved" },
    { count: rejected, cls: "bg-rose-50 text-rose-700 ring-rose-200",       label: "R",  title: "Rejected" },
  ].filter((i) => i.count > 0);
  if (!items.length) return <span className="text-zinc-400">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((i) => (
        <span
          key={i.label}
          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${i.cls}`}
          title={i.title}
        >
          {i.label}: {i.count}
        </span>
      ))}
    </div>
  );
}

function EmployeeExpensesModal({ group, onClose }) {
  // Full-screen image preview state — set to { url, filename } when a bill
  // thumbnail is clicked.  Click anywhere outside the image to close.
  const [preview, setPreview] = useState(null);
  if (!group) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 bg-orange-50 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">
              {group.userName}&apos;s expenses
            </h3>
            <p className="text-xs text-zinc-500">
              {group.expenses.length} expense{group.expenses.length === 1 ? "" : "s"} ·
              {" "}
              total ₹{(group.total || 0).toLocaleString("en-IN")}
              {group.userDepartment && ` · ${group.userDepartment}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-white hover:text-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[82vh] overflow-y-auto p-5">
          <Table maxHeight={640}>
            <Table.Head>
              <Table.Row>
                <Table.Th>Date</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Mode</Table.Th>
                <Table.Th className="text-right">Amount</Table.Th>
                <Table.Th className="text-right">Advance</Table.Th>
                <Table.Th className="text-right">Subtotal</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Bill</Table.Th>
                <Table.Th>Remarks</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {group.expenses.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Td className="whitespace-nowrap">{formatPretty(r.date)}</Table.Td>
                  <Table.Td>
                    <span className="capitalize">{r.expense_type}</span>
                    {r.travel_type && (
                      <span className="text-[10px] text-zinc-500"> · {r.travel_type}</span>
                    )}
                  </Table.Td>
                  <Table.Td className="capitalize">{r.mode || "—"}</Table.Td>
                  <Table.Td className="text-right tabular-nums font-medium">
                    ₹{(r.amount || 0).toLocaleString("en-IN")}
                  </Table.Td>
                  <Table.Td className="text-right tabular-nums text-zinc-700">
                    {r.advance ? `₹${(r.advance || 0).toLocaleString("en-IN")}` : "—"}
                  </Table.Td>
                  <Table.Td className="text-right tabular-nums font-semibold text-emerald-700">
                    ₹{Math.max(0, (r.amount || 0) - (r.advance || 0)).toLocaleString("en-IN")}
                  </Table.Td>
                  <Table.Td>
                    <StatusPill status={r.status} />
                  </Table.Td>
                  <Table.Td>
                    <BillThumbnail
                      expense={r}
                      onOpen={(url, filename) => setPreview({ url, filename })}
                    />
                  </Table.Td>
                  <Table.Td className="max-w-[320px] whitespace-pre-wrap text-zinc-700" title={r.remarks}>
                    {r.remarks || "—"}
                  </Table.Td>
                </Table.Row>
              ))}
              {/* Subtotal row — sums Amount + Advance, then shows net. */}
              {(() => {
                const totalAmt = group.expenses.reduce((s, r) => s + (r.amount || 0), 0);
                const totalAdv = group.expenses.reduce((s, r) => s + (r.advance || 0), 0);
                const totalNet = Math.max(0, totalAmt - totalAdv);
                return (
                  <Table.Row className="bg-orange-50/60 font-semibold">
                    <Table.Td className="text-zinc-900" colSpan={3}>
                      Subtotal · {group.expenses.length} expense{group.expenses.length === 1 ? "" : "s"}
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums text-zinc-900">
                      ₹{totalAmt.toLocaleString("en-IN")}
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums text-zinc-900">
                      ₹{totalAdv.toLocaleString("en-IN")}
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums text-emerald-700">
                      ₹{totalNet.toLocaleString("en-IN")}
                    </Table.Td>
                    <Table.Td colSpan={3} />
                  </Table.Row>
                );
              })()}
            </Table.Body>
          </Table>
        </div>
      </div>
      {preview && (
        <BillPreviewOverlay
          url={preview.url}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function BillThumbnail({ expense, onOpen }) {
  // Renders a small (32px) image preview of the FIRST attached bill.
  // The bytes are fetched once on mount and cached as a blob URL.  Clicking
  // the thumbnail surfaces the full-screen image to the parent via
  // `onOpen(url, filename)`.  PDFs fall back to a generic 📄 tile.
  const [url, setUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const bills = expense.bills || [];
  const billCount = bills.length;
  const firstName = bills[0]?.filename || "";
  const isImage = /\.(jpe?g|png|webp|heic)$/i.test(firstName);
  const isPdf = /\.pdf$/i.test(firstName);

  useEffect(() => {
    if (!billCount || !isImage) return;
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const { api } = await import("@/lib/api");
        const resp = await api.get(`/api/expenses/${expense.id}/bill/0`, {
          responseType: "blob",
        });
        if (cancelled) return;
        createdUrl = URL.createObjectURL(resp.data);
        setUrl(createdUrl);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [expense.id, billCount, isImage]);

  if (!billCount) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-rose-50 px-1.5 py-0.5 text-rose-600 ring-1 ring-rose-200"
        title="No bill attached"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
          <path d="M4.7 4.7a1 1 0 0 1 1.4 0L10 8.6l3.9-3.9a1 1 0 1 1 1.4 1.4L11.4 10l3.9 3.9a1 1 0 0 1-1.4 1.4L10 11.4l-3.9 3.9a1 1 0 1 1-1.4-1.4L8.6 10 4.7 6.1a1 1 0 0 1 0-1.4Z" />
        </svg>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // Don't bubble up to the parent Table.Row's onClick — for the
        // admin flat-table that would open the per-expense detail modal
        // unintentionally.
        e.stopPropagation();
        if (url) onOpen(url, firstName);
      }}
      disabled={!url}
      title={`${billCount} bill${billCount === 1 ? "" : "s"} — click to enlarge`}
      className="group relative h-9 w-9 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-default"
    >
      {url && isImage ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : isPdf ? (
        <span className="flex h-full w-full items-center justify-center text-base">📄</span>
      ) : loadError ? (
        <span className="flex h-full w-full items-center justify-center text-base">📎</span>
      ) : (
        <span className="block h-full w-full animate-pulse bg-zinc-200" />
      )}
      {billCount > 1 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-orange-600 px-0.5 text-[8px] font-bold text-white">
          {billCount}
        </span>
      )}
    </button>
  );
}

function MonthlySummaryModal({ allExpenses, onClose }) {
  // Month picker — defaults to the current calendar month.
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12
  // Advances are inline-editable.  Stored in component state by user_id;
  // also persisted to localStorage keyed by `<year>-<month>` so a refresh
  // doesn't lose entries until the admin gets a chance to download.
  const storageKey = `expense-advances-${year}-${String(month).padStart(2, "0")}`;
  const [advances, setAdvances] = useState(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  // Re-load advances if the admin changes the month.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      setAdvances(raw ? JSON.parse(raw) : {});
    } catch {
      setAdvances({});
    }
  }, [storageKey]);
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(advances)); } catch {}
  }, [storageKey, advances]);

  // Filter expenses to the selected month.
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const groups = useMemo(() => {
    const byUser = new Map();
    for (const e of allExpenses) {
      if (!e.date || e.date < monthStart || e.date > monthEnd) continue;
      if (!byUser.has(e.user_id)) {
        byUser.set(e.user_id, {
          userId: e.user_id,
          name: e.user_name || "—",
          department: e.user_department || "",
          total: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          onhold: 0,
          latestSubmit: e.created_at || e.date,
        });
      }
      const g = byUser.get(e.user_id);
      g.total += (e.amount || 0);
      if (e.status === "pending")  g.pending  += 1;
      if (e.status === "approved") g.approved += 1;
      if (e.status === "rejected") g.rejected += 1;
      if (e.status === "onhold")   g.onhold   += 1;
      const ts = e.created_at || e.date;
      if (ts > (g.latestSubmit || "")) g.latestSubmit = ts;
    }
    return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allExpenses, monthStart, monthEnd]);

  // Footer totals.
  const totals = useMemo(() => {
    let amount = 0, advance = 0, subtotal = 0;
    for (const g of groups) {
      const a = parseInt(advances[g.userId], 10) || 0;
      amount   += g.total;
      advance  += a;
      subtotal += (g.total - a);
    }
    return { amount, advance, subtotal };
  }, [groups, advances]);

  const monthLabel = new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long", year: "numeric",
  });

  // Build a small year list — last 5 years through next year.
  const years = useMemo(() => {
    const ys = [];
    for (let y = now.getFullYear() - 4; y <= now.getFullYear() + 1; y += 1) ys.push(y);
    return ys;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [downloading, setDownloading] = useState(false);
  async function downloadExcel() {
    setDownloading(true);
    try {
      const { api } = await import("@/lib/api");
      const resp = await api.post(
        "/api/expenses/monthly-summary.xlsx",
        { year, month, advances },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `monthly-expenses-${year}-${String(month).padStart(2, "0")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded");
    } catch (e) {
      toast.error(e?.message || "Failed to download Excel");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-orange-50 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">
                Monthly Expense Summary
              </h3>
              <p className="text-xs text-zinc-500">{monthLabel}</p>
            </div>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs"
            >
              {[
                "January","February","March","April","May","June",
                "July","August","September","October","November","December",
              ].map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadExcel}
              disabled={downloading || groups.length === 0}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
            >
              {downloading ? "Preparing…" : "Download Excel"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-white hover:text-zinc-800"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-5">
          {groups.length === 0 ? (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
              No expenses recorded in {monthLabel}.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-zinc-100 text-xs">
              <thead className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                <tr>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2 text-right">Total Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Advance</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                  <th className="px-3 py-2">Submit Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {groups.map((g) => {
                  const adv = parseInt(advances[g.userId], 10) || 0;
                  const subtotal = g.total - adv;
                  return (
                    <tr key={g.userId}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-900">{g.name}</div>
                        {g.department && (
                          <div className="text-[10px] text-zinc-500">{g.department}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-900">
                        ₹{g.total.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2">
                        <StatusMix
                          pending={g.pending}
                          approved={g.approved}
                          rejected={g.rejected}
                          onHold={g.onhold}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={advances[g.userId] ?? ""}
                          onChange={(e) => setAdvances((prev) => ({
                            ...prev,
                            [g.userId]: e.target.value,
                          }))}
                          placeholder="0"
                          className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-xs tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        ₹{subtotal.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-zinc-700">
                        {g.latestSubmit
                          ? formatPretty(String(g.latestSubmit).slice(0, 10))
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-orange-50/60 font-semibold">
                  <td className="px-3 py-2">Total · {groups.length} employees</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-900">
                    ₹{totals.amount.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-900">
                    ₹{totals.advance.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    ₹{totals.subtotal.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function BillPreviewOverlay({ url, filename, onClose }) {
  const isPdf = /\.pdf$/i.test(filename || "");
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-lg bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded-md bg-zinc-900/60 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-900/80"
        >
          Close
        </button>
        {isPdf ? (
          <iframe src={url} className="h-[80vh] w-[80vw]" title="Bill" />
        ) : (
          <img src={url} alt={filename || "Bill"} className="max-h-[85vh] max-w-[90vw] object-contain" />
        )}
      </div>
    </div>
  );
}

function BillCountIndicator({ withBills, total }) {
  // Compact "✓ 3/6" / "✓ 6/6" / "✗ 0/6" used in the admin grouped table.
  if (total === 0) return <span className="text-zinc-400">—</span>;
  if (withBills === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200"
        title={`No bills attached on any of ${total} expense(s)`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
          <path d="M4.7 4.7a1 1 0 0 1 1.4 0L10 8.6l3.9-3.9a1 1 0 1 1 1.4 1.4L11.4 10l3.9 3.9a1 1 0 0 1-1.4 1.4L10 11.4l-3.9 3.9a1 1 0 1 1-1.4-1.4L8.6 10 4.7 6.1a1 1 0 0 1 0-1.4Z" />
        </svg>
        0 / {total}
      </span>
    );
  }
  const allHave = withBills === total;
  const cls = allHave
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}
      title={`${withBills} of ${total} expense(s) have a bill attached`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z" />
      </svg>
      {withBills} / {total}
    </span>
  );
}

function EditExpenseModal({ row, onClose, onSave, saving }) {
  // Pre-fill from the existing expense — every field stays editable so an
  // employee can correct any mistake before approval.  Bills are NOT shown
  // here (they're managed through the new-expense submit + the per-expense
  // detail view).  Travel km/rate auto-calc is intentionally omitted on edit
  // — the employee can just type the new amount.
  const [date, setDate] = useState(row.date || todayISO());
  const [mode, setMode] = useState((row.mode || "cash").toLowerCase());
  const [expenseType, setExpenseType] = useState(row.expense_type || "food");
  // travelType in the edit form is either one of the new top-level travel
  // values (car/bike/cab/rapido) OR the raw sub-mode (bus/auto/metro).  We
  // store whatever the server has so it round-trips cleanly.
  const [travelType, setTravelType] = useState(row.travel_type || "");
  const [amount, setAmount] = useState(String(row.amount ?? 0));
  const [advance, setAdvance] = useState(String(row.advance ?? 0));
  const [remarks, setRemarks] = useState(row.remarks || "");

  useEffect(() => {
    if (expenseType !== "travel" && travelType) setTravelType("");
  }, [expenseType]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave(e) {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Amount must be a non-negative number.");
      return;
    }
    const adv = parseInt(advance, 10) || 0;
    if (adv < 0) {
      toast.error("Advance must be a non-negative number.");
      return;
    }
    if (adv > amt) {
      toast.error("Advance can't be larger than the expense amount.");
      return;
    }
    if (expenseType === "travel" && !travelType) {
      toast.error("Pick a travel type before saving.");
      return;
    }
    onSave({
      date,
      mode,
      expense_type: expenseType,
      travel_type: expenseType === "travel" ? travelType : "",
      amount: amt,
      advance: adv,
      remarks: remarks.trim(),
    });
  }

  // Show every travel type we accept (including the bus/auto/metro sub-modes
  // that previously sat under "Others") so the existing value can round-trip.
  const ALL_TRAVEL_OPTIONS = [
    ...TRAVEL_TYPES.filter((t) => t.value !== "other"),
    ...TRAVEL_SUBTYPES,
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 bg-orange-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Edit expense</h3>
            <p className="text-[11px] text-zinc-500">
              Submitted on {formatPretty(row.date)} · ₹{(row.amount || 0).toLocaleString("en-IN")}
              {row.status === "onhold" && (
                <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                  On Hold — saving will resubmit for approval
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <Field label="Date">
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Payment Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Expense Type">
            <select
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value)}
              className={inputClass}
              required
            >
              {EXPENSE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          {expenseType === "travel" && (
            <Field label="Travel Type">
              <select
                value={travelType}
                onChange={(e) => setTravelType(e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select…</option>
                {ALL_TRAVEL_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Amount (₹)">
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Advance received (₹)">
            <input
              type="number"
              min={0}
              value={advance}
              onChange={(e) => setAdvance(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Remarks">
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                className={`${inputClass} resize-y`}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-stone-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ExpenseTable({ rows, isLoading, isAdmin, onOpen, onEdit }) {
  // Full-screen image preview state for the inline bill thumbnails.
  const [preview, setPreview] = useState(null);
  return (
    <>
    <Table maxHeight={520}>
      <Table.Head>
        <Table.Row>
          <Table.Th>Date</Table.Th>
          {isAdmin && <Table.Th>Employee</Table.Th>}
          <Table.Th>Type</Table.Th>
          <Table.Th>Mode</Table.Th>
          <Table.Th className="text-right">Amount</Table.Th>
          <Table.Th className="text-right">Advance</Table.Th>
          <Table.Th className="text-right">Subtotal</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Bill</Table.Th>
          <Table.Th>Remarks</Table.Th>
          <Table.Th className="text-right">{isAdmin ? "" : "Action"}</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {isLoading ? (
          <Table.Empty colSpan={isAdmin ? 11 : 10} message="Loading expenses…" />
        ) : rows.length === 0 ? (
          <Table.Empty
            colSpan={isAdmin ? 11 : 10}
            message={isAdmin ? "No expenses to review yet." : "You haven't submitted any expenses yet."}
          />
        ) : (
          rows.map((r) => (
            <Table.Row
              key={r.id}
              // Employee: row click does nothing (no "Open" detail flow);
              // they must use the Edit button.  Admin: row click still opens
              // the per-expense detail modal.
              onClick={isAdmin ? () => onOpen(r) : undefined}
              className={isAdmin ? "cursor-pointer hover:bg-zinc-50" : "hover:bg-zinc-50/50"}
            >
              <Table.Td className="whitespace-nowrap">{formatPretty(r.date)}</Table.Td>
              {isAdmin && (
                <Table.Td>
                  <div className="font-medium text-zinc-900">{r.user_name || "—"}</div>
                  {r.user_department && (
                    <div className="text-[10px] text-zinc-500">{r.user_department}</div>
                  )}
                </Table.Td>
              )}
              <Table.Td>
                <span className="capitalize">{r.expense_type}</span>
                {r.travel_type && (
                  <span className="text-[10px] text-zinc-500"> · {r.travel_type}</span>
                )}
              </Table.Td>
              <Table.Td className="capitalize">{r.mode || "—"}</Table.Td>
              <Table.Td className="text-right tabular-nums font-medium">
                ₹{(r.amount || 0).toLocaleString("en-IN")}
              </Table.Td>
              <Table.Td className="text-right tabular-nums text-zinc-700">
                {r.advance ? `₹${(r.advance || 0).toLocaleString("en-IN")}` : "—"}
              </Table.Td>
              <Table.Td className="text-right tabular-nums font-semibold text-emerald-700">
                ₹{Math.max(0, (r.amount || 0) - (r.advance || 0)).toLocaleString("en-IN")}
              </Table.Td>
              <Table.Td>
                <StatusPill status={r.status} />
              </Table.Td>
              <Table.Td>
                <BillThumbnail
                  expense={r}
                  onOpen={(url, filename) => setPreview({ url, filename })}
                />
              </Table.Td>
              <Table.Td className="max-w-[260px] truncate text-zinc-600" title={r.remarks}>
                {r.remarks || "—"}
              </Table.Td>
              <Table.Td className="text-right">
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600">
                    Open →
                  </span>
                ) : (
                  // Edit is only enabled while the expense is still in
                  // pending / on-hold state.  After approval/rejection the
                  // row is locked — show a muted "Locked" label instead.
                  (r.status === "pending" || r.status === "onhold") ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEdit(r); }}
                      className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100"
                    >
                      Edit
                    </button>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500"
                      title="Approved / rejected expenses can't be edited"
                    >
                      Locked
                    </span>
                  )
                )}
              </Table.Td>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table>
    {preview && (
      <BillPreviewOverlay
        url={preview.url}
        filename={preview.filename}
        onClose={() => setPreview(null)}
      />
    )}
    </>
  );
}

function StatusPill({ status }) {
  const cls =
    status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "rejected" ? "bg-rose-50 text-rose-700 ring-rose-200"
    : status === "onhold"   ? "bg-sky-50 text-sky-700 ring-sky-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
  const label = status === "approved" ? "Approved"
    : status === "rejected" ? "Rejected"
    : status === "onhold"   ? "On Hold"
    : "Pending";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function ExpenseModal({ row, isAdmin, onClose, onDecide, onDelete, decidePending, deletePending }) {
  // billUrls[i] = blob URL for row.bills[i] once fetched, or null while loading.
  const [billUrls, setBillUrls] = useState([]);
  const [openBillIndex, setOpenBillIndex] = useState(-1);  // -1 = closed

  // Fetch each attached bill in parallel as Blob URLs so previews + the
  // full-screen viewer load without exposing the storage backend.  All URLs
  // are revoked on unmount / when the expense changes.
  useEffect(() => {
    const bills = row?.bills || [];
    if (!bills.length) { setBillUrls([]); return; }
    let cancelled = false;
    const created = new Array(bills.length).fill(null);
    setBillUrls(new Array(bills.length).fill(null));
    (async () => {
      const { api } = await import("@/lib/api");
      await Promise.all(bills.map(async (b, idx) => {
        try {
          const resp = await api.get(`/api/expenses/${row.id}/bill/${idx}`, {
            responseType: "blob",
          });
          if (cancelled) return;
          created[idx] = URL.createObjectURL(resp.data);
        } catch {
          /* leave null — card still renders by filename */
        }
      }));
      if (!cancelled) setBillUrls([...created]);
    })();
    return () => {
      cancelled = true;
      for (const u of created) {
        if (u) URL.revokeObjectURL(u);
      }
    };
  }, [row]);

  if (!row) return null;
  const bills = row.bills || [];
  function billKind(filename) {
    const isImage = /\.(jpg|jpeg|png|webp|heic)$/i.test(filename || "");
    const isPdf   = /\.pdf$/i.test(filename || "");
    return { isImage, isPdf };
  }
  const openBill = openBillIndex >= 0 ? bills[openBillIndex] : null;
  const openBillUrl = openBillIndex >= 0 ? billUrls[openBillIndex] : null;
  const openBillKind = openBill ? billKind(openBill.filename) : { isImage: false, isPdf: false };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 bg-orange-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Expense details</h3>
            <p className="text-[11px] text-zinc-500">
              {row.user_name} · {formatPretty(row.date)} · ₹{(row.amount || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-white hover:text-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4 text-[12px] sm:grid-cols-3">
            <KV k="Status"><StatusPill status={row.status} /></KV>
            <KV k="Type">
              <span className="capitalize">{row.expense_type}</span>
              {row.travel_type && (
                <span className="ml-1 text-zinc-500">({row.travel_type})</span>
              )}
            </KV>
            <KV k="Mode" className="capitalize">{row.mode || "—"}</KV>
            <KV k="Department">{row.user_department || "—"}</KV>
            <KV k="Submitted">{formatPretty(row.created_at?.slice?.(0, 10) || row.date)}</KV>
            {row.decided_at && (
              <KV k="Decided by">{row.decided_by_name || "—"}</KV>
            )}
          </div>

          <KV k="Remarks" full className="mt-3">
            {row.remarks || <span className="text-zinc-400">—</span>}
          </KV>

          {row.decision_note && (
            <KV k={`${row.status === "approved" ? "Approver" : "Reviewer"} note`} full className="mt-2">
              {row.decision_note}
            </KV>
          )}

          {/* Bills section — one card per attached file; click any to open. */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Attached bills {bills.length > 0 && (
                <span className="text-zinc-400">({bills.length})</span>
              )}
            </div>
            {bills.length > 0 ? (
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {bills.map((b, idx) => {
                  const { isImage, isPdf } = billKind(b.filename);
                  const url = billUrls[idx];
                  return (
                    <button
                      type="button"
                      key={`${b.filename}-${idx}`}
                      onClick={() => setOpenBillIndex(idx)}
                      className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-left hover:border-orange-300 hover:bg-orange-50"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-zinc-200">
                        {isImage && url ? (
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xl">{isPdf ? "📄" : "📎"}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-900">
                          {b.filename || `Bill ${idx + 1}`}
                        </div>
                        <div className="text-[11px] text-orange-700">Click to preview</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-zinc-500">No bills attached.</p>
            )}
          </div>

        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-stone-50 px-4 py-3">
          <button
            type="button"
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            {deletePending ? "Deleting…" : "Delete"}
          </button>
          {isAdmin && row.status === "pending" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDecide("rejected", "")}
                disabled={decidePending}
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {decidePending ? "…" : "Reject"}
              </button>
              <button
                type="button"
                onClick={() => onDecide("onhold", "")}
                disabled={decidePending}
                className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
              >
                {decidePending ? "…" : "On Hold"}
              </button>
              <button
                type="button"
                onClick={() => onDecide("approved", "")}
                disabled={decidePending}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {decidePending ? "…" : "Approve"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bill preview sub-modal — opens for whichever bill card was clicked.
          Supports prev/next navigation when an expense has multiple bills. */}
      {openBillIndex >= 0 && openBill && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/70 p-4"
          onClick={() => setOpenBillIndex(-1)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-lg bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute left-2 top-2 z-10 max-w-[60%] truncate rounded-md bg-zinc-900/60 px-2 py-1 text-xs font-medium text-white">
              {openBill.filename || `Bill ${openBillIndex + 1}`}
              {bills.length > 1 && (
                <span className="ml-1.5 opacity-80">
                  ({openBillIndex + 1} of {bills.length})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpenBillIndex(-1)}
              className="absolute right-2 top-2 z-10 rounded-md bg-zinc-900/60 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-900/80"
            >
              Close
            </button>
            {bills.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setOpenBillIndex((i) => (i - 1 + bills.length) % bills.length)}
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-zinc-900/60 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-900/80"
                  aria-label="Previous bill"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setOpenBillIndex((i) => (i + 1) % bills.length)}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-zinc-900/60 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-900/80"
                  aria-label="Next bill"
                >
                  ›
                </button>
              </>
            )}
            {openBillUrl ? (
              openBillKind.isPdf ? (
                <iframe src={openBillUrl} className="h-[80vh] w-[80vw]" title="Bill" />
              ) : (
                <img src={openBillUrl} alt="Bill" className="max-h-[85vh] max-w-[90vw] object-contain" />
              )
            ) : (
              <div className="p-6 text-sm text-zinc-600">Loading…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function KV({ k, children, full = false, className = "" }) {
  return (
    <div className={`${full ? "col-span-full" : ""} ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {k}
      </div>
      <div className="mt-0.5 text-xs text-zinc-900">{children}</div>
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";
