"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPretty, todayISO } from "@/lib/data";
import {
  useCreateExpense,
  useDecideExpense,
  useDeleteExpense,
  useAddExpenseBills,
  useDeleteExpenseBill,
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
  const addBills = useAddExpenseBills();
  const deleteBill = useDeleteExpenseBill();

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
  // Default to "all months" so the admin sees every employee's complete total
  // on first open.  They can narrow by month using the dropdown.
  const [monthFilter, setMonthFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");   // "pending" | "approved" | "rejected" | "onhold" | "all"
  // Admin view-toggle.  HR / Smita can both file their own expenses AND
  // approve others', so they need a way to swap between:
  //   "all"  — the admin grouped table across the company
  //   "mine" — the flat per-row table of just their own submissions
  // Tarini (review-only) sticks to "all" by default but can also flip.
  const [viewMode, setViewMode] = useState("all");           // "all" | "mine"

  // Advance summary derived from the raw expense list — no separate API call.
  // Pass 1: accumulate ALL expenses per user (amount + latest date).
  // Pass 2: accumulate only the advance fields.
  // This ensures totalAmount = the employee's full expense total, and
  // net = totalAmount - totalAdvance matches what the modal shows.
  const advanceSummary = useMemo(() => {
    if (!isAdmin) return [];
    const byUser = new Map();
    for (const e of rawExpenses) {
      if (!byUser.has(e.user_id)) {
        byUser.set(e.user_id, {
          userId: e.user_id,
          userName: e.user_name || "—",
          department: e.user_department || "",
          totalAdvance: 0,
          totalAmount: 0,
          pendingAdv: 0,
          approvedAdv: 0,
          advExpCount: 0,
          latestDate: e.date || "",
        });
      }
      const g = byUser.get(e.user_id);
      // Always sum full expense amount and track latest date.
      g.totalAmount += (e.amount || 0);
      if ((e.date || "") > g.latestDate) g.latestDate = e.date;
      // Only count advance where it's actually set.
      const adv = e.advance || 0;
      if (adv > 0) {
        g.totalAdvance += adv;
        g.advExpCount  += 1;
        if (e.status === "pending" || e.status === "onhold") g.pendingAdv  += adv;
        else if (e.status === "approved")                    g.approvedAdv += adv;
      }
    }
    // Only show employees who actually have an advance on at least one expense.
    return Array.from(byUser.values())
      .filter((g) => g.totalAdvance > 0)
      .sort((a, b) => b.totalAdvance - a.totalAdvance);
  }, [rawExpenses, isAdmin]);

  // Current month's HR remark for the LOGGED-IN user — shown as a banner
  // on the employee's My Expenses view so they know if payment is on hold
  // and why.  Works for HR/Smita/Tarini in "mine" mode too.
  const [myMonthRemark, setMyMonthRemark] = useState("");
  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    (async () => {
      try {
        const { api } = await import("@/lib/api");
        const resp = await api.get("/api/expenses/monthly-notes", {
          params: { year: y, month: m },
        });
        if (cancelled) return;
        const own = (resp.data?.items || []).find((n) => n.user_id === me.id);
        setMyMonthRemark(own?.remark || "");
      } catch {
        if (!cancelled) setMyMonthRemark("");
      }
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

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
  // (newest first).  Always includes the CURRENT month even if it has no
  // expenses yet — so the default month filter is selectable.
  const monthOptions = useMemo(() => {
    if (!isAdmin) return [];
    const seen = new Set();
    const now = new Date();
    seen.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
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
        <ExpenseForm
          onSubmit={(payload) => createExpense.mutateAsync(payload)}
          submitting={createExpense.isPending}
        />
      )}

      {/* Admin view-toggle — HR / Smita can flip between their own
          expense list (employee-style flat table) and the company-wide
          grouped table.  Tarini is review-only (she doesn't file her own
          expenses), so the "My Expenses" tab is hidden for her — she
          stays in the company-wide view permanently.  Regular employees
          never see this toggle either. */}
      {isAdmin && !isTariniReviewer && (
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

      {/* HR remark banner — shown on the employee's own view (or admin's
          "My Expenses" mode).  HR fills the remark in the Monthly Summary
          modal; the employee sees it here so they know why their payment
          for the current month is on hold. */}
      {(!isAdmin || viewMode === "mine") && myMonthRemark && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
          <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden>
            <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm-.75 4a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0V6zM10 13.5a.9.9 0 100 1.8.9.9 0 000-1.8z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="font-semibold">Note from HR for this month:</p>
            <p className="whitespace-pre-wrap">{myMonthRemark}</p>
          </div>
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
          hideOnHold={isTariniReviewer}
          monthFilter={monthFilter}
          onOpenEmployee={(group) => {
            // Rebuild the group from ALL raw (unfiltered) expenses for this
            // user so the modal always shows the employee's complete history,
            // regardless of what month filter is active in the admin table.
            const all = rawExpenses.filter((e) => e.user_id === group.userId);
            setEmpModal({
              ...group,
              expenses: all.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
              total: all.reduce((s, e) => s + (e.amount || 0), 0),
              advance: all.reduce((s, e) => s + (e.advance || 0), 0),
              pendingCount: all.filter((e) => e.status === "pending").length,
              approvedCount: all.filter((e) => e.status === "approved").length,
              rejectedCount: all.filter((e) => e.status === "rejected").length,
              onHoldCount: all.filter((e) => e.status === "onhold").length,
              withBillsCount: all.filter((e) => (e.bills || []).length > 0).length,
            });
          }}
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
          onDelete={async (row) => {
            const label = `${row.expense_type || "expense"} on ${row.date}${row.amount ? ` (₹${row.amount})` : ""}`;
            if (!window.confirm(`Delete this ${label}?\n\nThis can't be undone.`)) return;
            try {
              await deleteExpense.mutateAsync(row.id);
            } catch {
              /* toast already fired in the mutation's onError */
            }
          }}
        />
      )}

      {/* Advances panel — per-employee advance totals derived from expense rows. */}
      {isAdmin && viewMode === "all" && (
        <AdvancesTable items={advanceSummary} />
      )}

      {/* Admin: per-employee modal listing every expense inline (with
          clickable bill thumbnails and per-row approve/reject). */}
      {empModal && (
        <EmployeeExpensesModal
          group={empModal}
          onClose={() => setEmpModal(null)}
          onDecide={async (id, decision) => {
            try {
              await decideExpense.mutateAsync({ id, decision, note: "" });
            } catch {}
          }}
          decidePending={decideExpense.isPending}
          hideOnHold={isTariniReviewer}
        />
      )}

      {/* Employee's edit modal — only mounted for their own pending/onhold rows. */}
      {editingRow && (
        <EditExpenseModal
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSave={async (patch, newBills) => {
            try {
              await updateExpense.mutateAsync({ id: editingRow.id, ...patch });
              // Upload any newly-picked bill files AFTER the field patch
              // lands.  If the upload fails, the field changes still stuck
              // and the user sees a toast.
              if (newBills && newBills.length) {
                await addBills.mutateAsync({ id: editingRow.id, files: newBills });
              }
              setEditingRow(null);
            } catch {}
          }}
          onDeleteBill={async (index) => {
            await deleteBill.mutateAsync({ id: editingRow.id, index });
          }}
          saving={updateExpense.isPending || addBills.isPending}
        />
      )}

      {/* Per-expense detail modal — used by both flows. */}
      {openModal && (
        <ExpenseModal
          row={openModal}
          isAdmin={isAdmin}
          hideOnHold={isTariniReviewer}
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
  const [siteName, setSiteName] = useState("");
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

  // Batch state — users fill the form, click "+ Add" to push the entry
  // into `drafts`, then click "Submit (N)" once to send all of them.
  const [drafts, setDrafts] = useState([]);
  const [submittingAll, setSubmittingAll] = useState(false);

  // Validate the current form values and assemble a payload object.
  // Returns null and fires a toast when something fails validation.
  function buildPayload() {
    const amt = parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Amount must be a non-negative number.");
      return null;
    }
    const adv = parseInt(advance, 10) || 0;
    if (adv < 0) {
      toast.error("Advance must be a non-negative number.");
      return null;
    }
    if (adv > amt) {
      toast.error("Advance can't be larger than the expense amount.");
      return null;
    }
    let finalTravelType = "";
    if (expenseType === "travel") {
      if (!travelType) {
        toast.error("Pick a travel type (car, bike, cab, rapido, or others).");
        return null;
      }
      if (travelType === "other") {
        if (!travelSubtype) {
          toast.error("Pick the sub-mode (bus, auto, metro).");
          return null;
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

    return {
      date,
      mode,
      expense_type: expenseType,
      travel_type: finalTravelType,
      amount: amt,
      advance: adv,
      site_name: siteName.trim(),
      remarks: finalRemarks,
      bills,
    };
  }

  // Clear the entry-form fields (but keep the date so multiple same-day
  // entries are quick to file).
  function resetEntryForm() {
    setAmount("");
    setAdvance("");
    setSiteName("");
    setRemarks("");
    setBills([]);
    setKilometers("");
  }

  function handleAddToBatch(e) {
    e?.preventDefault();
    if (submittingAll) return;
    const payload = buildPayload();
    if (!payload) return;
    setDrafts((prev) => [...prev, payload]);
    resetEntryForm();
    toast.success("Added to batch");
  }

  function removeDraftAt(i) {
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmitAll() {
    if (submittingAll || !drafts.length) return;
    setSubmittingAll(true);
    const remaining = [];
    for (const d of drafts) {
      try {
        await onSubmit(d);
      } catch {
        // Keep the failed draft so the user can fix and retry.  The per-
        // mutation toast (fired by useCreateExpense) already explains why.
        remaining.push(d);
      }
    }
    setDrafts(remaining);
    setSubmittingAll(false);
  }

  return (
    <form
      onSubmit={handleAddToBatch}
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
        <Field label="Site Name (optional)">
          <input
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="e.g. Nhava Sheva WH, Okhla Custom House"
            maxLength={255}
            className={inputClass}
          />
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
      {/* Batched draft list — appears once the first "+ Add" has happened.
          Each row is a queued expense that hasn't been submitted yet; the
          ✕ button drops it from the batch.  Submitting clears the rows
          that succeed and keeps any that failed (with their toast). */}
      {drafts.length > 0 && (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50/60">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-700">
              Batched expenses ({drafts.length})
            </p>
            <p className="text-[10px] text-zinc-500">
              Click <span className="font-semibold">Submit all</span> to file every row.
            </p>
          </div>
          <table className="min-w-full divide-y divide-zinc-100 text-[11px]">
            <thead className="bg-white/60 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-1.5">#</th>
                <th className="px-3 py-1.5">Date</th>
                <th className="px-3 py-1.5">Type</th>
                <th className="px-3 py-1.5">Mode</th>
                <th className="px-3 py-1.5 text-right">Amount</th>
                <th className="px-3 py-1.5 text-right">Advance</th>
                <th className="px-3 py-1.5">Site</th>
                <th className="px-3 py-1.5 text-center">Bills</th>
                <th className="px-3 py-1.5 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {drafts.map((d, i) => (
                <tr key={i} className="bg-white">
                  <td className="px-3 py-1.5 text-zinc-500">{i + 1}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-zinc-700">
                    {d.date}
                  </td>
                  <td className="px-3 py-1.5 capitalize text-zinc-700">
                    {d.expense_type}
                    {d.travel_type ? ` · ${d.travel_type}` : ""}
                  </td>
                  <td className="px-3 py-1.5 capitalize text-zinc-700">
                    {d.mode || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-zinc-900">
                    ₹{(d.amount || 0).toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">
                    {d.advance > 0 ? `₹${d.advance.toLocaleString("en-IN")}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-700">
                    {d.site_name || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-center text-zinc-700">
                    {d.bills?.length || 0}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeDraftAt(i)}
                      disabled={submittingAll}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                      aria-label={`Remove row ${i + 1}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={submitting || submittingAll}
          className="rounded-md border border-orange-600 bg-white px-4 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-60"
          title="Add this entry to the batch — clears the form so you can fill the next one"
        >
          + Add to batch
        </button>
        <button
          type="button"
          onClick={handleSubmitAll}
          disabled={submittingAll || submitting || drafts.length === 0}
          className="rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
        >
          {submittingAll
            ? `Submitting ${drafts.length}…`
            : drafts.length > 0
              ? `Submit all (${drafts.length})`
              : "Submit all"}
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

function AdminEmployeeTable({ expenses, isLoading, decidePending, onOpenEmployee, onBatchDecide, hideOnHold, monthFilter }) {
  const groups = useMemo(() => groupExpensesByUser(expenses), [expenses]);
  // Totals across whatever the parent has already filtered to (usually the
  // current month).  Shown as a footer row so the user can see the visible
  // total without scanning every row.
  const visibleTotals = useMemo(() => {
    let amount = 0;
    let advance = 0;
    for (const g of groups) {
      amount += g.total || 0;
      advance += g.advance || 0;
    }
    return { amount, advance, subtotal: Math.max(0, amount - advance) };
  }, [groups]);
  // Month label for the footer.  "All months" when no specific month is
  // selected; otherwise e.g. "June 2026".
  const monthLabel = useMemo(() => {
    if (!monthFilter || monthFilter === "all") return "all months";
    const [y, m] = monthFilter.split("-");
    if (!y || !m) return "all months";
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, {
      month: "long", year: "numeric",
    });
  }, [monthFilter]);
  // Fixed scroll area — keeps the table at a stable height so the page
  // layout doesn't jump as rows are added.  Scrolls vertically once the
  // body grows past this height.
  return (
    <Table maxHeight={600}>
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
                    {!hideOnHold && (
                      <button
                        type="button"
                        disabled={decidePending}
                        onClick={() => onBatchDecide(g, "onhold")}
                        className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                      >
                        On Hold
                      </button>
                    )}
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
      {!isLoading && groups.length > 0 && (
        <Table.Foot>
          <Table.Row className="font-semibold">
            <Table.Td className="whitespace-nowrap text-zinc-900" colSpan={2}>
              Total for {monthLabel} · {groups.length} employee{groups.length === 1 ? "" : "s"}
            </Table.Td>
            <Table.Td className="tabular-nums text-zinc-900">
              ₹{visibleTotals.amount.toLocaleString("en-IN")}
            </Table.Td>
            <Table.Td className="tabular-nums text-zinc-700">
              {visibleTotals.advance > 0 ? `₹${visibleTotals.advance.toLocaleString("en-IN")}` : "—"}
            </Table.Td>
            <Table.Td className="tabular-nums text-emerald-700">
              ₹{visibleTotals.subtotal.toLocaleString("en-IN")}
            </Table.Td>
            <Table.Td colSpan={4} />
          </Table.Row>
        </Table.Foot>
      )}
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
    { count: pending,  cls: "bg-amber-50 text-amber-800 ring-amber-200",       label: "Pending"  },
    { count: onHold,   cls: "bg-sky-50 text-sky-700 ring-sky-200",             label: "On Hold"  },
    { count: approved, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Approved" },
    { count: rejected, cls: "bg-rose-50 text-rose-700 ring-rose-200",          label: "Rejected" },
  ].filter((i) => i.count > 0);
  if (!items.length) return <span className="text-zinc-400">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((i) => (
        <span
          key={i.label}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${i.cls}`}
          title={`${i.label}: ${i.count}`}
        >
          {i.label}
          <span className="tabular-nums font-semibold">{i.count}</span>
        </span>
      ))}
    </div>
  );
}

function EmployeeExpensesModal({ group, onClose, onDecide, decidePending, hideOnHold }) {
  // Full-screen image preview state — set to { url, filename } when a bill
  // thumbnail is clicked.  Click anywhere outside the image to close.
  const [preview, setPreview] = useState(null);
  // Per-type breakdown (e.g. Material ₹2,500 · Travel ₹1,000 · Others ₹998)
  // shown as chips in the modal header so HR can see at-a-glance where this
  // employee's spend went.
  const typeBreakdown = useMemo(() => {
    if (!group) return [];
    const sums = new Map();
    for (const e of group.expenses || []) {
      const label = e.travel_type
        ? `${e.expense_type || "Travel"} (${e.travel_type})`
        : (e.expense_type || "Other");
      sums.set(label, (sums.get(label) || 0) + (e.amount || 0));
    }
    return Array.from(sums.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [group]);
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
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 bg-orange-50 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-900">
              {group.userName}&apos;s expenses
            </h3>
            <p className="text-xs text-zinc-500">
              {group.expenses.length} expense{group.expenses.length === 1 ? "" : "s"} ·
              {" "}
              total ₹{(group.total || 0).toLocaleString("en-IN")}
              {group.userDepartment && ` · ${group.userDepartment}`}
            </p>
            {typeBreakdown.length > 0 && (
              <p className="mt-1.5 text-[13px] text-zinc-700">
                {typeBreakdown.map((t, i) => (
                  <span key={t.label}>
                    {i > 0 && <span className="mx-1.5 text-zinc-400">·</span>}
                    <span className="capitalize">{t.label}</span>{" "}
                    <span className="tabular-nums">
                      ₹{t.amount.toLocaleString("en-IN")}
                    </span>
                  </span>
                ))}
              </p>
            )}
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
                <Table.Th>Site</Table.Th>
                <Table.Th className="text-right">Amount</Table.Th>
                <Table.Th className="text-right">Advance</Table.Th>
                <Table.Th className="text-right">Subtotal</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Bill</Table.Th>
                <Table.Th>Remarks</Table.Th>
                {onDecide && <Table.Th className="text-right">Action</Table.Th>}
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
                  <Table.Td className="max-w-[180px] truncate text-zinc-700" title={r.site_name}>
                    {r.site_name || "—"}
                  </Table.Td>
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
                  {onDecide && (
                    <Table.Td className="text-right">
                      {r.status === "pending" ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={decidePending}
                            onClick={() => onDecide(r.id, "rejected")}
                            className="rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          >
                            Reject
                          </button>
                          {!hideOnHold && (
                            <button
                              type="button"
                              disabled={decidePending}
                              onClick={() => onDecide(r.id, "onhold")}
                              className="rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                            >
                              Hold
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={decidePending}
                            onClick={() => onDecide(r.id, "approved")}
                            className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            Approve
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-400 capitalize">{r.status}</span>
                      )}
                    </Table.Td>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
            {(() => {
              const totalAmt = group.expenses.reduce((s, r) => s + (r.amount || 0), 0);
              const totalAdv = group.expenses.reduce((s, r) => s + (r.advance || 0), 0);
              const totalNet = Math.max(0, totalAmt - totalAdv);
              return (
                <Table.Foot>
                  <Table.Row className="font-semibold">
                    <Table.Td className="text-zinc-900" colSpan={4}>
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
                    <Table.Td colSpan={onDecide ? 4 : 3} />
                  </Table.Row>
                </Table.Foot>
              );
            })()}
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
  const [url, setUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const bills = expense.bills || [];
  const billCount = bills.length;
  const firstName = bills[0]?.filename || "";
  const isImage = /\.(jpe?g|png|webp|heic)$/i.test(firstName);
  const isPdf = /\.pdf$/i.test(firstName);

  // Fetch blob URL for images AND PDFs so clicking always works.
  useEffect(() => {
    if (!billCount || (!isImage && !isPdf)) return;
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
  }, [expense.id, billCount, isImage, isPdf]);

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
        e.stopPropagation();
        if (url) onOpen(url, firstName);
      }}
      disabled={!url}
      title={`${billCount} bill${billCount === 1 ? "" : "s"} — click to view`}
      className="group relative h-9 w-9 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-default disabled:opacity-60"
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
  // Per-user notes for this month, fetched from the API on mount + month-
  // change.  Shape: { <userId>: { advance: number, remark: string } }.
  // Edits are persisted optimistically (UI updates first) then PUT'd to
  // the backend — so the employee sees the same remark on their own view.
  const [notes, setNotes] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { api } = await import("@/lib/api");
        const resp = await api.get("/api/expenses/monthly-notes", {
          params: { year, month },
        });
        if (cancelled) return;
        const map = {};
        for (const n of (resp.data?.items || [])) {
          map[n.user_id] = { advance: n.advance || 0, remark: n.remark || "" };
        }
        setNotes(map);
      } catch {
        if (!cancelled) setNotes({});
      }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  // Debounced PUT so HR's typing doesn't fire one PUT per keystroke.
  function saveNote(userId, patch) {
    setNotes((prev) => {
      const cur = prev[userId] || { advance: 0, remark: "" };
      const next = { ...cur, ...patch };
      return { ...prev, [userId]: next };
    });
    if (saveNote._timers == null) saveNote._timers = new Map();
    const timers = saveNote._timers;
    const key = `${userId}`;
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(async () => {
        try {
          const { api } = await import("@/lib/api");
          // Read the latest value from state at flush time.
          const latest = (saveNote._latest || {})[userId] || {};
          await api.put("/api/expenses/monthly-notes", {
            user_id: userId,
            year,
            month,
            advance: latest.advance ?? 0,
            remark: latest.remark ?? "",
          });
        } catch {
          /* surfaced by axios interceptor toast */
        }
      }, 600),
    );
  }
  // Mirror the latest notes for the debounced flusher.
  useEffect(() => { saveNote._latest = notes; }, [notes]);

  // Compatibility shims so existing rendering code (which reads `advances`)
  // keeps working — we now expose a derived map from `notes`.
  const advances = useMemo(() => {
    const m = {};
    for (const [uid, n] of Object.entries(notes)) m[uid] = n.advance || 0;
    return m;
  }, [notes]);
  const setAdvances = (updater) => {
    // Legacy signature: callers pass `(prev) => ({...prev, [userId]: value})`
    // or a flat object.  Translate to `saveNote` per-key.
    setNotes((prev) => {
      const prevAdv = {};
      for (const [k, v] of Object.entries(prev)) prevAdv[k] = v.advance || 0;
      const next = typeof updater === "function" ? updater(prevAdv) : updater;
      const merged = { ...prev };
      for (const [uid, val] of Object.entries(next)) {
        merged[uid] = {
          remark: prev[uid]?.remark || "",
          advance: parseInt(val, 10) || 0,
        };
      }
      // Also fire the debounced save for any changed key.
      for (const uid of Object.keys(next)) {
        if ((prev[uid]?.advance || 0) !== (parseInt(next[uid], 10) || 0)) {
          saveNote(parseInt(uid, 10), { advance: parseInt(next[uid], 10) || 0 });
        }
      }
      return merged;
    });
  };

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

  // Multi-sheet workbook: Overview tab (company total + per-dept totals +
  // per-employee summary) plus one tab per department listing every
  // individual expense in that department for the chosen month.
  const [downloading, setDownloading] = useState(false);
  async function downloadExcel() {
    setDownloading(true);
    try {
      const { api } = await import("@/lib/api");
      const resp = await api.post(
        "/api/expenses/department-summary.xlsx",
        { year, month },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expense-summary-${year}-${String(month).padStart(2, "0")}.xlsx`;
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
              title="Workbook with an overview tab plus one tab per department listing every expense"
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
                  <th className="px-3 py-2">Remarks (visible to employee)</th>
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
                      <td className="px-3 py-2 align-top">
                        <textarea
                          value={notes[g.userId]?.remark ?? ""}
                          onChange={(e) => saveNote(g.userId, { remark: e.target.value })}
                          rows={2}
                          placeholder={
                            g.onhold > 0
                              ? "Why is this on hold?  (visible to employee)"
                              : "Optional remark"
                          }
                          className="w-full min-w-[200px] rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                        />
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

// Existing-bill tile shown in the edit modal.  Fetches the bill as a blob
// URL once, renders an image thumbnail (or a PDF tile), and exposes a ✕
// button that calls back to the parent to delete it on the server.
function EditBillThumbnail({ expenseId, index, filename, onRemove }) {
  const [url, setUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const isImage = /\.(jpe?g|png|webp|heic)$/i.test(filename || "");
  const isPdf = /\.pdf$/i.test(filename || "");

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const { api } = await import("@/lib/api");
        const resp = await api.get(`/api/expenses/${expenseId}/bill/${index}`, {
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
  }, [expenseId, index, isImage]);

  return (
    <div
      className="group relative h-16 w-16 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
      title={filename}
    >
      {isImage && url ? (
        <img src={url} alt={filename} className="h-full w-full object-cover" />
      ) : isImage && loadError ? (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-rose-600">
          ⚠︎
        </div>
      ) : isPdf ? (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-zinc-600">
          PDF
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-zinc-500">
          …
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded-full bg-rose-600/90 px-1.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Remove ${filename || "bill"}`}
      >
        ✕
      </button>
    </div>
  );
}

function EditExpenseModal({ row, onClose, onSave, saving, onDeleteBill }) {
  // Pre-fill from the existing expense — every field stays editable so an
  // employee can correct any mistake before approval.  Mirrors the create
  // form: km/rate auto-compute for km-based travel, and a bills section
  // for adding / removing attachments (which hit dedicated endpoints).
  const [date, setDate] = useState(row.date || todayISO());
  const [mode, setMode] = useState((row.mode || "cash").toLowerCase());
  const [expenseType, setExpenseType] = useState(row.expense_type || "food");
  // travelType in the edit form is either one of the new top-level travel
  // values (car/bike/cab/rapido) OR the raw sub-mode (bus/auto/metro).  We
  // store whatever the server has so it round-trips cleanly.
  const [travelType, setTravelType] = useState(row.travel_type || "");
  // Distance + rate auto-compute amount for km-based travel — same logic
  // as the create form.  Left empty when the saved travel type isn't
  // km-based; user can still hand-edit the amount.
  const [kilometers, setKilometers] = useState("");
  const [ratePerKm, setRatePerKm] = useState("");
  const [amount, setAmount] = useState(String(row.amount ?? 0));
  const [advance, setAdvance] = useState(String(row.advance ?? 0));
  const [siteName, setSiteName] = useState(row.site_name || "");
  const [remarks, setRemarks] = useState(row.remarks || "");
  // Bills — split into "existing" (already uploaded, indexed) and
  // "pendingAdds" (newly picked files that upload on save).  Deletes are
  // immediate (with a confirm), driven by the parent via onDeleteBill.
  const [existingBills, setExistingBills] = useState(row.bills || []);
  const [pendingAdds, setPendingAdds] = useState([]);   // File[]
  const [pendingPreviews, setPendingPreviews] = useState([]);  // { name, url|null }[]
  useEffect(() => { setExistingBills(row.bills || []); }, [row.bills]);

  useEffect(() => {
    if (expenseType !== "travel") {
      if (travelType) setTravelType("");
      if (kilometers) setKilometers("");
      if (ratePerKm) setRatePerKm("");
    }
  }, [expenseType]); // eslint-disable-line react-hooks/exhaustive-deps

  // When travel type changes to a km-based one, pre-fill the rate from the
  // standard PER_KM_RATES table and clear the km input so the user has to
  // enter the new distance.  Non-km types clear both.
  useEffect(() => {
    if (KM_BASED_TYPES.has(travelType)) {
      setRatePerKm(String(PER_KM_RATES[travelType] ?? 0));
      setKilometers("");
    } else {
      setRatePerKm("");
      setKilometers("");
    }
  }, [travelType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compute amount = km × rate whenever either changes — user can
  // still override the amount manually afterwards (next km/rate change
  // re-overwrites it, same trade-off as the create form).
  useEffect(() => {
    if (!KM_BASED_TYPES.has(travelType)) return;
    const km = parseFloat(kilometers);
    const rate = parseFloat(ratePerKm);
    if (Number.isFinite(km) && Number.isFinite(rate) && km >= 0 && rate >= 0) {
      setAmount(String(Math.round(km * rate)));
    }
  }, [kilometers, ratePerKm, travelType]);

  // Build object-URL previews for newly-picked files (same as create form).
  useEffect(() => {
    if (!pendingAdds.length) { setPendingPreviews([]); return; }
    const next = pendingAdds.map((f) => ({
      name: f.name,
      url: f.type?.startsWith("image/") ? URL.createObjectURL(f) : null,
    }));
    setPendingPreviews(next);
    return () => {
      for (const p of next) {
        if (p.url) URL.revokeObjectURL(p.url);
      }
    };
  }, [pendingAdds]);

  function addPendingFiles(fileList) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    setPendingAdds((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      // Server cap: existing + pending must stay ≤ 10.
      const cap = 10 - existingBills.length;
      if (merged.length > cap) {
        toast.error(`Max 10 bills per expense — only ${Math.max(0, cap)} more can be added.`);
        return merged.slice(0, Math.max(0, cap));
      }
      return merged;
    });
  }
  function removePendingAt(idx) {
    setPendingAdds((prev) => prev.filter((_, i) => i !== idx));
  }

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
    // Audit prefix on km-based travel — gives the approver a clear breakdown
    // of how the amount was derived (km × rate), matching the create form.
    let finalRemarks = remarks.trim();
    if (KM_BASED_TYPES.has(travelType) && kilometers && ratePerKm) {
      const audit = `${kilometers} km × ₹${ratePerKm}/km = ₹${amt}`;
      // Only prepend if the existing remark doesn't already start with an
      // audit line (avoids stacking on repeated edits).
      if (!/^\d+(\.\d+)?\s*km\s*×/.test(finalRemarks)) {
        finalRemarks = finalRemarks ? `${audit} — ${finalRemarks}` : audit;
      }
    }
    onSave(
      {
        date,
        mode,
        expense_type: expenseType,
        travel_type: expenseType === "travel" ? travelType : "",
        amount: amt,
        advance: adv,
        site_name: siteName.trim(),
        remarks: finalRemarks,
      },
      pendingAdds,
    );
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
            <Field label="Site Name (optional)">
              <input
                type="text"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="e.g. Nhava Sheva WH, Okhla Custom House"
                maxLength={255}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Bills / Receipts (up to 10 total)">
              {/* Existing bills — fetched as blob URLs by EditBillThumbnail.
                  ✕ deletes the bill on the server immediately (with a
                  confirm). */}
              {existingBills.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {existingBills.map((b, idx) => (
                    <EditBillThumbnail
                      key={`${b.filename}-${idx}`}
                      expenseId={row.id}
                      index={idx}
                      filename={b.filename}
                      onRemove={async () => {
                        if (!onDeleteBill) return;
                        if (!confirm(`Remove ${b.filename || "this bill"}?`)) return;
                        try {
                          await onDeleteBill(idx);
                          // Optimistically drop it locally; the parent will
                          // refresh once the mutation invalidates.
                          setExistingBills((prev) => prev.filter((_, i) => i !== idx));
                        } catch {}
                      }}
                    />
                  ))}
                </div>
              )}
              {/* Add-more picker — queued and uploaded on Save. */}
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) => {
                  addPendingFiles(e.target.files);
                  e.target.value = "";
                }}
                className={`${inputClass} cursor-pointer file:mr-2 file:rounded-sm file:border-0 file:bg-orange-100 file:px-2 file:py-0.5 file:text-[11px] file:font-medium file:text-orange-800 hover:file:bg-orange-200`}
              />
              {pendingPreviews.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingPreviews.map((p, idx) => (
                    <div
                      key={`${p.name}-${idx}`}
                      className="group relative h-16 w-16 overflow-hidden rounded-md border border-emerald-300 bg-emerald-50"
                      title={`${p.name} (will upload on save)`}
                    >
                      {p.url ? (
                        <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-emerald-700">
                          PDF
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePendingAt(idx)}
                        className="absolute right-0.5 top-0.5 rounded-full bg-zinc-900/70 px-1.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Remove ${p.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {pendingAdds.length > 0 && (
                <p className="mt-1 text-[10px] text-emerald-700">
                  {pendingAdds.length} new file{pendingAdds.length === 1 ? "" : "s"} will upload on save.
                </p>
              )}
              {existingBills.length + pendingAdds.length >= 10 && (
                <p className="mt-1 text-[10px] text-rose-600">
                  Max 10 bills reached — remove one before adding more.
                </p>
              )}
            </Field>
          </div>
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

// Per-employee advance summary — derived from expense rows (not MonthlyExpenseNote).
// Shows every employee who has a non-zero advance on at least one expense, with
// a breakdown of how much is pending vs approved.
function AdvancesTable({ items }) {
  const totalAdvance = (items || []).reduce((s, g) => s + (g.totalAdvance || 0), 0);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Advances</h3>
          <p className="text-[11px] text-zinc-500">
            Per-employee advance totals from all expense records.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Total advance</p>
          <p className="text-sm font-semibold text-zinc-900 tabular-nums">
            ₹{totalAdvance.toLocaleString("en-IN")}
          </p>
        </div>
      </div>
      <table className="min-w-full divide-y divide-zinc-100 text-xs">
        <thead className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          <tr>
            <th className="px-4 py-2">Employee</th>
            <th className="px-4 py-2 text-right">Total Expense</th>
            <th className="px-4 py-2 text-right">Total Advance</th>
            <th className="px-4 py-2 text-right">Net Payable</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Latest Expense</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {(items || []).length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                No advances recorded on any expense yet.
              </td>
            </tr>
          ) : (
            items.map((g) => {
              const net = Math.max(0, g.totalAmount - g.totalAdvance);
              return (
                <tr key={g.userId} className="hover:bg-zinc-50/60">
                  <td className="px-4 py-2">
                    <div className="font-medium text-zinc-900">{g.userName}</div>
                    {g.department && (
                      <div className="text-[10px] text-zinc-500">
                        {g.department} · {g.advExpCount} expense{g.advExpCount === 1 ? "" : "s"} with advance
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-700">
                    ₹{g.totalAmount.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-zinc-900">
                    ₹{g.totalAdvance.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                    ₹{net.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {g.pendingAdv > 0 && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-amber-200 text-amber-800">
                          Pending ₹{g.pendingAdv.toLocaleString("en-IN")}
                        </span>
                      )}
                      {g.approvedAdv > 0 && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-emerald-200 text-emerald-700">
                          Approved ₹{g.approvedAdv.toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-zinc-700">
                    {g.latestDate ? formatPretty(g.latestDate) : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseTable({ rows, isLoading, isAdmin, onOpen, onEdit, onDelete }) {
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
                  // Edit + Delete only while the expense is still in
                  // pending / on-hold state.  After approval/rejection the
                  // row is locked — show a muted "Locked" label instead.
                  (r.status === "pending" || r.status === "onhold") ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(r); }}
                        className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100"
                      >
                        Edit
                      </button>
                      {onDelete && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onDelete(r); }}
                          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                          title="Delete this expense — only allowed while it's still pending or on hold"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500"
                      title="Approved / rejected expenses can't be edited or deleted"
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

function ExpenseModal({ row, isAdmin, onClose, onDecide, onDelete, decidePending, deletePending, hideOnHold }) {
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
              {!hideOnHold && (
                <button
                  type="button"
                  onClick={() => onDecide("onhold", "")}
                  disabled={decidePending}
                  className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                >
                  {decidePending ? "…" : "On Hold"}
                </button>
              )}
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
