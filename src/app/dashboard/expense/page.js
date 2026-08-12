"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { formatPretty, todayISO } from "@/lib/data";
import {
  useCreateExpense,
  useDecideExpense,
  useDeleteExpense,
  useAddExpenseBills,
  useDeleteExpenseBill,
  useMarkPaidExpense,
  useDepartments,
  useExpenses,
  useMe,
  useUpdateExpense,
  useIssueAdvance,
  useRecordAdvance,
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
  { value: "ola",    label: "Ola Cab" },
  { value: "uber",   label: "Uber" },
  { value: "rapido", label: "Rapido" },
  { value: "other",  label: "Others" },
];

const TRAVEL_SUBTYPES = [
  { value: "bus",      label: "Bus" },
  { value: "auto",     label: "Auto" },
  { value: "metro",    label: "Metro" },
  { value: "rickshaw", label: "Rickshaw" },
];

// Per-km reimbursement rate (₹) for vehicles where the company pays by
// distance.  0 = no preset, employee fills in.
const PER_KM_RATES = {
  car:    10,
  bike:   5,
  cab:    0,
  rapido: 0,
  ola:    0,
  uber:   0,
};

const KM_BASED_TYPES = new Set(["car", "bike", "cab", "rapido", "ola", "uber"]);

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

// Finance approvers (Shivangi, Saif) — the accounts that can mark an
// approved expense as paid.  Same prefix-match style as the others so
// `shivangi.singh@…` etc. still resolve.
const FINANCE_APPROVER_LOCALS = ["shivangi", "saif"];
function _isFinanceApproverEmail(email) {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  return FINANCE_APPROVER_LOCALS.some(
    (p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "_"),
  );
}

// Project coordinators — read-only cross-employee view, scoped by the server
// to just their team.  They can VIEW their team's expenses/advances but have
// no approve / reject / hold / mark-paid actions.  Mirror of the backend's
// PROJECT_COORDINATORS map (keys only — the server enforces the team list).
const COORDINATOR_LOCALS = ["arman"];
function _isCoordinatorEmail(email) {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  return COORDINATOR_LOCALS.some(
    (p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "_"),
  );
}

export default function ExpensePage() {
  const { data: me } = useMe();
  // Finance approvers get the admin (cross-employee) view too — they need to
  // see every approved expense to mark each one paid.
  const isFinanceApprover = useMemo(() => {
    if (!me) return false;
    return _isFinanceApproverEmail(me.email);
  }, [me]);
  // Project coordinator (Arman) — read-only view of their team; the server
  // returns only the team's rows, so the admin table is naturally scoped.
  const isCoordinator = useMemo(() => {
    if (!me) return false;
    return _isCoordinatorEmail(me.email);
  }, [me]);
  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me.role === "hr") return true;
    if (_isApproverEmail(me.email)) return true;
    if (_isFinanceApproverEmail(me.email)) return true;
    return _isCoordinatorEmail(me.email);
  }, [me]);
  // Tarini's account is review-only — she doesn't file her own expenses
  // through this form.  Smita + HR still get the form because they can.
  const isTariniReviewer = useMemo(() => {
    if (!me) return false;
    return _isTariniEmail(me.email);
  }, [me]);

  const { data: rawExpenses = [], isLoading } = useExpenses();
  const { data: departments = [] } = useDepartments();
  // Distinct past site names filed by the CURRENT user — sorted by most
  // recently used first.  Fed into <datalist> so the New/Edit expense
  // form autocompletes as the employee types.  Cross-employee names are
  // deliberately excluded so a Logistics driver's WH names don't leak
  // into a Sales rep's suggestions.
  const pastSiteNames = useMemo(() => {
    if (!me) return [];
    const seen = new Map();  // lowercase → first-seen original casing
    for (const e of rawExpenses) {
      if (e.user_id !== me.id) continue;
      const s = (e.site_name || "").trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) seen.set(key, s);
    }
    return Array.from(seen.values());
  }, [rawExpenses, me]);
  const createExpense = useCreateExpense();
  const decideExpense = useDecideExpense();
  const deleteExpense = useDeleteExpense();
  const updateExpense = useUpdateExpense();
  const addBills = useAddExpenseBills();
  const deleteBill = useDeleteExpenseBill();
  const markPaid = useMarkPaidExpense();
  const issueAdvance = useIssueAdvance();
  const recordAdvance = useRecordAdvance();
  const [addAdvanceOpen, setAddAdvanceOpen] = useState(false);
  const [empAdvanceOpen, setEmpAdvanceOpen] = useState(false);
  // { expenseIds: number[], userName?: string } — open Mark Paid modal for these IDs
  const [markPaidModal, setMarkPaidModal] = useState(null);

  // Employee list for the Add Advance modal — derived from rawExpenses so no extra API call.
  const employeeList = useMemo(() => {
    const seen = new Map();
    for (const e of rawExpenses) {
      if (!seen.has(e.user_id)) {
        seen.set(e.user_id, {
          id: e.user_id,
          first_name: (e.user_name || "").split(" ")[0] || "",
          last_name: (e.user_name || "").split(" ").slice(1).join(" ") || "",
          department_name: e.user_department || "",
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      (a.first_name + a.last_name).localeCompare(b.first_name + b.last_name)
    );
  }, [rawExpenses]);

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
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  // Shivangi opens the page focused on the disbursal queue, so default
  // her status filter to "approved" (her Paid button targets approved
  // rows).  Everyone else starts on "all".
  const [statusFilter, setStatusFilter] = useState(() => {
    if (typeof window === "undefined") return "all";
    return "all";
  });
  // Employee-view-specific filters (month + status).  Also used when an
  // admin is viewing their OWN expenses ("mine" mode).
  const [empMonthFilter, setEmpMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [empStatusFilter, setEmpStatusFilter] = useState("all");
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  // One-shot effect: when `me` first arrives and the caller is the
  // finance approver, switch the filter to "approved".  Keeps the
  // initial render deterministic (SSR-safe) and avoids re-overriding
  // whatever the user picks afterwards.
  const financeFilterSetRef = useState({ set: false })[0];
  useEffect(() => {
    if (!me) return;
    if (financeFilterSetRef.set) return;
    if (_isFinanceApproverEmail(me.email)) {
      setStatusFilter("approved_paid"); // shows approved + paid rows; pending/rejected stay hidden
      setMonthFilter("all"); // Shivangi sees all months by default
      financeFilterSetRef.set = true;
    } else if (_isCoordinatorEmail(me.email)) {
      setMonthFilter("all"); // coordinator sees their whole team across all months
      financeFilterSetRef.set = true;
    } else {
      financeFilterSetRef.set = true;
    }
  }, [me, financeFilterSetRef]);
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
  // net = Total − Rejected − Paid − Advance matches the modal's "Payable
  // breakdown" card (same formula, kept in sync everywhere).
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
          rejectedAmt: 0,
          paidAmt: 0,
          pendingAdv: 0,
          approvedAdv: 0,
          advExpCount: 0,
          latestDate: e.date || "",
        });
      }
      const g = byUser.get(e.user_id);
      // Always sum full expense amount and track latest date.
      g.totalAmount += (e.amount || 0);
      if (e.status === "rejected") g.rejectedAmt += (e.amount || 0);
      // Net each paid row against its OWN advance (if any) before adding to
      // paidAmt. Some employees record advance directly on the same row as
      // the real expense claim (not a separate zero-amount placeholder) —
      // for those, the full `amount` was never new cash disbursed once
      // that row is paid, only amount-advance was. Without this netting,
      // that advance gets subtracted a second time by the global "Advance"
      // deduction below, producing a wrong (often deeply negative) net.
      else if (e.status === "paid") g.paidAmt += Math.max(0, (e.amount || 0) - (e.advance || 0));
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

  // Per-employee "Paid this month" / "Remaining this month" — payment runs
  // happen twice a month (roughly two ~15-day batches), so a single "Total
  // Amount" column doesn't show how much of THIS month has actually been
  // disbursed vs is still outstanding. Scoped to `monthFilter` only (not
  // the admin table's status/search/dept filters) so every row for the same
  // employee shows the same whole-month figures regardless of which status
  // is currently being viewed. Reuses the exact Paid/Net-Payable formulas
  // already established for the per-employee modal, so these columns always
  // agree with what that modal shows.
  const employeeMonthlySummary = useMemo(() => {
    if (!isAdmin) return new Map();
    const inMonth = (e) =>
      !monthFilter || monthFilter === "all" || (e.date && e.date.startsWith(monthFilter));
    const byUser = new Map();
    for (const e of rawExpenses) {
      if (!inMonth(e)) continue;
      if (!byUser.has(e.user_id)) {
        byUser.set(e.user_id, { total: 0, rejectedAmt: 0, paidAmt: 0, advance: 0 });
      }
      const g = byUser.get(e.user_id);
      g.total += (e.amount || 0);
      g.advance += (e.advance || 0);
      if (e.status === "rejected") g.rejectedAmt += (e.amount || 0);
      else if (e.status === "paid") g.paidAmt += Math.max(0, (e.amount || 0) - (e.advance || 0));
    }
    const out = new Map();
    for (const [userId, g] of byUser) {
      const remaining = g.total - g.rejectedAmt - g.paidAmt - g.advance;
      out.set(userId, { paidAmt: g.paidAmt, remainingAmt: remaining });
    }
    return out;
  }, [rawExpenses, isAdmin, monthFilter]);

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
    if (!isAdmin) {
      return rawExpenses.filter((e) => {
        if (empStatusFilter !== "all" && e.status !== empStatusFilter) return false;
        if (empMonthFilter !== "all" && (!e.date || !e.date.startsWith(empMonthFilter))) return false;
        return true;
      });
    }
    if (viewMode === "mine") {
      return rawExpenses.filter((e) => {
        if (!me || e.user_id !== me.id) return false;
        if (empStatusFilter !== "all" && e.status !== empStatusFilter) return false;
        if (empMonthFilter !== "all" && (!e.date || !e.date.startsWith(empMonthFilter))) return false;
        return true;
      });
    }
    const q = (search || "").trim().toLowerCase();
    return rawExpenses.filter((e) => {
      if (statusFilter === "approved_paid") {
        if (e.status !== "approved" && e.status !== "paid") return false;
      } else if (statusFilter !== "all" && e.status !== statusFilter) return false;
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
  }, [rawExpenses, isAdmin, viewMode, me, search, deptFilter, monthFilter, statusFilter, departments, empMonthFilter, empStatusFilter]);

  // Build a month dropdown from the months that actually have expenses
  // (newest first).  Always includes the CURRENT month even if it has no
  // expenses yet — so the default month filter is selectable.
  // Month options for the employee / "mine" filter bar — built from the
  // employee's own expense dates (all months that have at least one expense,
  // plus the current month so the default is always selectable).
  const empMonthOptions = useMemo(() => {
    const seen = new Set();
    const now = new Date();
    seen.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    const source = isAdmin
      ? rawExpenses.filter((e) => me && e.user_id === me.id)
      : rawExpenses;
    for (const e of source) {
      if (e.date && e.date.length >= 7) seen.add(e.date.slice(0, 7));
    }
    return Array.from(seen).sort().reverse().map((ym) => {
      const [y, m] = ym.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1)
        .toLocaleString(undefined, { month: "long", year: "numeric" });
      return { value: ym, label };
    });
  }, [rawExpenses, isAdmin, me]);

  // Total expense amount for the employee's selected month (ignores status
  // filter so the employee always sees their full monthly spend).
  const empMonthTotal = useMemo(() => {
    const source = isAdmin
      ? rawExpenses.filter((e) => me && e.user_id === me.id)
      : rawExpenses;
    return source
      .filter((e) => empMonthFilter === "all" || (e.date && e.date.startsWith(empMonthFilter)))
      .reduce((s, e) => s + (e.amount || 0), 0);
  }, [rawExpenses, isAdmin, me, empMonthFilter]);

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
  const totalAmount = useMemo(() => {
    // Header total is always unfiltered — shows grand total for the employee
    // (or company-wide total for admin) regardless of month/status filters.
    const source = !isAdmin
      ? rawExpenses
      : viewMode === "mine"
        ? rawExpenses.filter((e) => me && e.user_id === me.id)
        : expenses; // admin "all" view — filtered total makes sense there
    return source.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [rawExpenses, isAdmin, viewMode, me, expenses]);
  const totalAmountText = useMemo(
    () => `₹${totalAmount.toLocaleString("en-IN")}`,
    [totalAmount],
  );

  // Total advance and net payable for admin header
  const totalAdvance = useMemo(() => {
    const source = !isAdmin
      ? rawExpenses
      : viewMode === "mine"
        ? rawExpenses.filter((e) => me && e.user_id === me.id)
        : expenses;
    return source.reduce((sum, e) => sum + (e.advance || 0), 0);
  }, [rawExpenses, isAdmin, viewMode, me, expenses]);
  // Rejected + already-paid amounts, same `source` logic as totalAmount/
  // totalAdvance above — needed so the header's "Net Payable" uses the same
  // Total − Rejected − Paid − Advance formula as the per-employee modal,
  // instead of the old Total − Advance shortcut that overstated what's
  // still owed once anything was rejected or already disbursed.
  const totalRejected = useMemo(() => {
    const source = !isAdmin
      ? rawExpenses
      : viewMode === "mine"
        ? rawExpenses.filter((e) => me && e.user_id === me.id)
        : expenses;
    return source.filter((e) => e.status === "rejected").reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [rawExpenses, isAdmin, viewMode, me, expenses]);
  const totalPaid = useMemo(() => {
    const source = !isAdmin
      ? rawExpenses
      : viewMode === "mine"
        ? rawExpenses.filter((e) => me && e.user_id === me.id)
        : expenses;
    // Net each paid row against its own advance — see the matching comment
    // in advanceSummary above for why (a paid row that itself carries an
    // advance would otherwise get that advance subtracted twice).
    return source.filter((e) => e.status === "paid").reduce((sum, e) => sum + Math.max(0, (e.amount || 0) - (e.advance || 0)), 0);
  }, [rawExpenses, isAdmin, viewMode, me, expenses]);
  const netPayableHeader = totalAmount - totalRejected - totalPaid - totalAdvance;

  function downloadMonthlyExcel() {
    const header = ["Date", "Expense Type", "Travel Type", "Mode", "Site Name", "Amount (₹)", "Advance (₹)", "Net (₹)", "Remarks"];
    const dataRows = expenses.map((e) => {
      const expLabel = EXPENSE_TYPES.find((t) => t.value === e.expense_type)?.label || e.expense_type || "";
      const allTravel = [...TRAVEL_TYPES.filter((t) => t.value !== "other"), ...TRAVEL_SUBTYPES];
      const travelLabel = allTravel.find((t) => t.value === e.travel_type)?.label || e.travel_type || "";
      const modeLabel = MODES.find((m) => m.value === e.mode)?.label || e.mode || "";
      const amt = e.amount || 0;
      const adv = e.advance || 0;
      return [e.date || "", expLabel, travelLabel, modeLabel, e.site_name || "", amt, adv, amt - adv, e.remarks || ""];
    });
    const totalAmt = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalAdv = expenses.reduce((s, e) => s + (e.advance || 0), 0);
    dataRows.push(["TOTAL", "", "", "", "", totalAmt, totalAdv, totalAmt - totalAdv, ""]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
    ws["!cols"] = [12, 16, 14, 14, 20, 12, 12, 12, 30].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expense Summary");
    XLSX.writeFile(wb, `expense-summary-${empMonthFilter}.xlsx`);
  }

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
          {/* Header totals — expense, advance, net payable */}
          <div className="flex items-center gap-4 tabular-nums">
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Total Expense</div>
              <div className="text-sm font-bold text-orange-700">
                ₹{totalAmount.toLocaleString("en-IN")}
              </div>
            </div>
            {totalAdvance > 0 && (
              <>
                <div className="h-8 w-px bg-orange-200" />
                <div className="text-right">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Total Advance</div>
                  <div className="text-sm font-bold text-emerald-700">
                    ₹{totalAdvance.toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="h-8 w-px bg-orange-200" />
                <div className="text-right">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Net Payable</div>
                  <div className={`text-sm font-bold ${netPayableHeader < 0 ? "text-rose-600" : "text-zinc-900"}`}>
                    {netPayableHeader < 0 ? "-" : ""}₹{Math.abs(netPayableHeader).toLocaleString("en-IN")}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>


      {/* Add Expense modal */}
      {addExpenseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-900/60 p-6">
          <div className="relative w-full max-w-6xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
              <h2 className="text-base font-semibold text-zinc-900">New Expense</h2>
              <button
                type="button"
                onClick={() => setAddExpenseOpen(false)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path d="M2 2l12 12M14 2L2 14" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="min-h-[60vh] p-6">
              <ExpenseForm
                onSubmit={async (payload) => {
                  await createExpense.mutateAsync(payload);
                  setAddExpenseOpen(false);
                }}
                submitting={createExpense.isPending}
                pastSiteNames={pastSiteNames}
              />
            </div>
          </div>
        </div>
      )}

      {empAdvanceOpen && (
        <EmployeeAdvanceModal
          onClose={() => setEmpAdvanceOpen(false)}
          onSave={async ({ amount, date, note }) => {
            await recordAdvance.mutateAsync({ amount, date, note });
            setEmpAdvanceOpen(false);
          }}
          saving={recordAdvance.isPending}
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
          <div className="relative flex-1 min-w-50">
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
              <option value="approved_paid">Approved &amp; Paid</option>
              <option value="pending">Pending</option>
              <option value="onhold">On Hold</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
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
          {/* Monthly Summary trigger — yearly view has moved to its own
              sub-page under Expense › Summary Expense. */}
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
          employeeMonthlySummary={employeeMonthlySummary}
          isFinanceApprover={isFinanceApprover}
          isCoordinator={isCoordinator}
          markPaidPending={markPaid.isPending}
          onBatchMarkPaid={(group) => {
            const approvedRows = group.expenses.filter((e) => e.status === "approved");
            if (!approvedRows.length) return;
            setMarkPaidModal({ expenseIds: approvedRows.map((e) => e.id), userName: group.userName });
          }}
          onOpenEmployee={(group) => {
            const all = rawExpenses
              .filter((e) => e.user_id === group.userId)
              .filter((e) => !monthFilter || monthFilter === "all" || (e.date && e.date.startsWith(monthFilter)));
            setEmpModal({
              ...group,
              expenses: all.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
              total: all.reduce((s, e) => s + (e.amount || 0), 0),
              advance: all.reduce((s, e) => s + (e.advance || 0), 0),
              pendingCount: all.filter((e) => e.status === "pending").length,
              approvedCount: all.filter((e) => e.status === "approved").length,
              rejectedCount: all.filter((e) => e.status === "rejected").length,
              onHoldCount: all.filter((e) => e.status === "onhold").length,
              paidCount: all.filter((e) => e.status === "paid").length,
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
        <>
          {/* Filter bar + action buttons row */}
          <div className="flex items-center gap-2">
            {/* Filter bar */}
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
              <select
                value={empMonthFilter}
                onChange={(e) => setEmpMonthFilter(e.target.value)}
                className="h-7 w-36 rounded-md border border-zinc-300 bg-zinc-50 px-2 text-xs text-zinc-800 focus:border-orange-400 focus:outline-none"
              >
                <option value="all">All months</option>
                {empMonthOptions.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select
                value={empStatusFilter}
                onChange={(e) => setEmpStatusFilter(e.target.value)}
                className="h-7 w-32 rounded-md border border-zinc-300 bg-zinc-50 px-2 text-xs text-zinc-800 focus:border-orange-400 focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="onhold">On Hold</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="rejected">Rejected</option>
              </select>
              {(empMonthFilter !== "all" || empStatusFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setEmpMonthFilter(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
                    setEmpStatusFilter("all");
                  }}
                  className="flex h-7 items-center gap-1 rounded-md border border-zinc-300 bg-zinc-50 px-2 text-[11px] text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-2.5 w-2.5">
                    <path d="M1 1l8 8M9 1L1 9"/>
                  </svg>
                  Clear
                </button>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-400">
                  {empMonthFilter === "all" ? "All-time" : (() => {
                    const [y, m] = empMonthFilter.split("-");
                    return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
                  })()}
                </span>
                <span className="text-sm font-bold tabular-nums text-orange-700">
                  ₹{empMonthTotal.toLocaleString("en-IN")}
                </span>
              </div>
            </div>
            {/* Action buttons — outside the bar, right side.
                Finance (Shivangi, Saif) file their own expenses like anyone
                else; Tarini (reviewer) and coordinators (read-only) don't. */}
            {!isTariniReviewer && (
              <>
                <button
                  type="button"
                  onClick={() => setAddExpenseOpen(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition-colors whitespace-nowrap"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 shrink-0">
                    <path d="M6 1v10M1 6h10" strokeLinecap="round"/>
                  </svg>
                  Add Expense
                </button>
                {(!isAdmin || viewMode === "mine") && (
                  <button
                    type="button"
                    onClick={() => setEmpAdvanceOpen(true)}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap"
                  >
                    ₹ Advance
                  </button>
                )}
              </>
            )}
            {empMonthFilter !== "all" && expenses.length > 0 && (
              <button
                type="button"
                onClick={downloadMonthlyExcel}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors whitespace-nowrap"
                title="Download monthly expense summary as Excel"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3 shrink-0">
                  <path d="M6 1v7M3 6l3 3 3-3M1 10h10" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Excel
              </button>
            )}
          </div>
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
        </>
      )}

      {/* Advances panel — per-employee advance totals derived from expense rows.
          Company-wide data, so it belongs to the All Employees view only. */}
      {isAdmin && viewMode === "all" && (
        <AdvancesTable
          items={advanceSummary}
          onAddAdvance={isCoordinator ? undefined : () => setAddAdvanceOpen(true)}
        />
      )}

      {addAdvanceOpen && (
        <AddAdvanceModal
          employees={employeeList}
          saving={issueAdvance.isPending}
          onClose={() => setAddAdvanceOpen(false)}
          onSave={async (data) => {
            try {
              await issueAdvance.mutateAsync(data);
              setAddAdvanceOpen(false);
            } catch {}
          }}
        />
      )}

      {/* Admin: per-employee modal listing every expense inline (with
          clickable bill thumbnails and per-row approve/reject). */}
      {empModal && (
        <EmployeeExpensesModal
          group={empModal}
          monthFilter={monthFilter}
          onClose={() => setEmpModal(null)}
          // Excel export is offered only to project coordinators (Arman).
          onDownloadExcel={isCoordinator ? (g) => downloadEmployeeExcel(g, monthFilter) : undefined}
          // Finance approvers disburse but never decide, and coordinators are
          // fully read-only — withholding onDecide strips the approve / reject /
          // hold controls from the modal.
          onDecide={(isFinanceApprover || isCoordinator) ? undefined : async (id, decision, note = "") => {
            try {
              await decideExpense.mutateAsync({ id, decision, note });
            } catch {}
          }}
          onMarkPaid={isFinanceApprover ? (expenseIds) => {
            setMarkPaidModal({ expenseIds });
          } : undefined}
          markPaidPending={markPaid.isPending}
          onUpdateType={isCoordinator ? undefined : async (id, expense_type) => {
            try {
              await updateExpense.mutateAsync({ id, expense_type });
            } catch {}
          }}
          onUpdateRemarks={isCoordinator ? undefined : async (id, remarks) => {
            try {
              await updateExpense.mutateAsync({ id, remarks });
            } catch {}
          }}
          onUpdateSite={isCoordinator ? undefined : async (id, site_name) => {
            try {
              await updateExpense.mutateAsync({ id, site_name });
            } catch {}
          }}
          onAddBills={isCoordinator ? undefined : async (id, files) => {
            try {
              await addBills.mutateAsync({ id, files });
            } catch {}
          }}
          decidePending={decideExpense.isPending}
          updatingType={updateExpense.isPending}
          hideOnHold={isTariniReviewer}
        />
      )}

      {/* Employee's edit modal — only mounted for their own pending/onhold rows. */}
      {editingRow && (
        <EditExpenseModal
          row={editingRow}
          pastSiteNames={pastSiteNames}
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
          // Mark-paid is wired only when the caller is the finance approver
          // — Shivangi clicking through to a single approved row needs the
          // same Paid action as the batch one on the grouped table.
          onMarkPaid={isFinanceApprover ? () => {
            setMarkPaidModal({ expenseIds: [openModal.id], onDone: () => setOpenModal(null) });
          } : undefined}
          markPaidPending={markPaid.isPending}
        />
      )}

      {/* Admin-only: monthly expense summary across the whole company. */}
      {monthlyOpen && isAdmin && (
        <MonthlySummaryModal
          allExpenses={expenses}
          monthFilter={monthFilter}
          onClose={() => setMonthlyOpen(false)}
        />
      )}

      {markPaidModal && (
        <MarkPaidModal
          expenseCount={markPaidModal.expenseIds.length}
          userName={markPaidModal.userName}
          saving={markPaid.isPending}
          onClose={() => setMarkPaidModal(null)}
          onSave={async ({ paid_date, payment_ref }) => {
            for (const id of markPaidModal.expenseIds) {
              try {
                await markPaid.mutateAsync({ id, paid_date, payment_ref });
              } catch { /* per-row toast fired by hook */ }
            }
            markPaidModal.onDone?.();
            setMarkPaidModal(null);
          }}
        />
      )}
    </div>
  );
}

function ExpenseForm({ onSubmit, submitting, pastSiteNames = [] }) {
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
    let finalTravelType = "";
    if (expenseType === "travel") {
      if (!travelType) {
        toast.error("Pick a travel type (car, bike, cab, Ola, Uber, rapido, or others).");
        return null;
      }
      if (travelType === "other") {
        if (!travelSubtype) {
          toast.error("Pick the sub-mode (bus, auto, metro, rickshaw).");
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
      advance: 0,
      site_name: siteName.trim(),
      remarks: finalRemarks,
      bills,
    };
  }

  // Clear the entry-form fields (but keep the date so multiple same-day
  // entries are quick to file).
  function resetEntryForm() {
    setAmount("");
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
      className="space-y-4"
    >
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
            <Field label="Distance (km) — optional">
              <input
                type="number"
                min={0}
                step="0.1"
                value={kilometers}
                onChange={(e) => setKilometers(e.target.value)}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
            <Field label="Rate (₹ / km) — optional">
              <input
                type="number"
                min={0}
                step="0.5"
                value={ratePerKm}
                onChange={(e) => setRatePerKm(e.target.value)}
                placeholder="Optional"
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
            placeholder="0"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Site Name (optional)">
          <input
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="e.g. Nhava Sheva WH, Okhla Custom House"
            maxLength={255}
            list="expense-past-sites"
            autoComplete="off"
            className={inputClass}
          />
          {/* Browser-native autocomplete from the employee's own past
              site names.  Dropdown filters as they type; blank input
              shows the full list.  Cross-employee names are excluded. */}
          {pastSiteNames.length > 0 && (
            <datalist id="expense-past-sites">
              {pastSiteNames.map((s) => <option key={s} value={s} />)}
            </datalist>
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

// One row per employee, combining every status — the multi-status pill
// (StatusMix) and the dedicated Paid (Month) / Remaining (Month) columns
// already show the paid-vs-owed breakdown, so splitting into separate rows
// per status was more confusing than helpful; reverted per explicit request.
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
        paidCount: 0,
        withBillsCount: 0,
        latestExpenseDate: e.date,
        latestSubmitAt: e.created_at,
        latestPaidAt: null,
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
    else if (e.status === "paid") g.paidCount += 1;
    if ((e.bills || []).length > 0) g.withBillsCount += 1;
    if (e.date > g.latestExpenseDate) g.latestExpenseDate = e.date;
    if ((e.created_at || "") > (g.latestSubmitAt || "")) g.latestSubmitAt = e.created_at;
    if (e.paid_at && (!g.latestPaidAt || e.paid_at > g.latestPaidAt)) g.latestPaidAt = e.paid_at;
  }
  // Sort: pending count desc (most-urgent first), then by name.
  return Array.from(byUser.values()).sort((a, b) => {
    if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
    return a.userName.localeCompare(b.userName);
  });
}

// One employee's expenses -> an .xlsx file, filtered to the same month the
// modal is showing.  Used by the coordinator's per-employee "Download Excel".
function downloadEmployeeExcel(group, monthFilter) {
  const rows = (group.expenses || [])
    .filter((e) => !monthFilter || monthFilter === "all" || (e.date && e.date.startsWith(monthFilter)))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const allTravel = [...TRAVEL_TYPES.filter((t) => t.value !== "other"), ...TRAVEL_SUBTYPES];
  const typeLabel = (e) => EXPENSE_TYPES.find((t) => t.value === e.expense_type)?.label || e.expense_type || "";
  const travelLabel = (e) => allTravel.find((t) => t.value === e.travel_type)?.label || e.travel_type || "";
  const modeLabel = (e) => MODES.find((m) => m.value === e.mode)?.label || e.mode || "";
  const STATUS = { pending: "Pending", approved: "Approved", rejected: "Rejected", onhold: "On Hold", paid: "Paid" };

  const header = ["Date", "Type", "Travel", "Mode", "Site", "Amount (₹)", "Advance (₹)", "Subtotal (₹)", "Status", "Remarks"];
  const dataRows = rows.map((e) => {
    const amt = e.amount || 0, adv = e.advance || 0;
    return [e.date || "", typeLabel(e), travelLabel(e), modeLabel(e), e.site_name || "",
      amt, adv, amt - adv, STATUS[e.status] || e.status || "", e.remarks || ""];
  });
  const totalAmt = rows.reduce((s, e) => s + (e.amount || 0), 0);
  const totalAdv = rows.reduce((s, e) => s + (e.advance || 0), 0);
  dataRows.push(["TOTAL", "", "", "", "", totalAmt, totalAdv, totalAmt - totalAdv, "", ""]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  ws["!cols"] = [12, 14, 12, 10, 20, 12, 12, 12, 10, 30].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Expenses");
  const safe = (group.userName || "employee").replace(/[^a-z0-9]/gi, "_");
  const period = !monthFilter || monthFilter === "all" ? "all" : monthFilter;
  XLSX.writeFile(wb, `Expenses_${safe}_${period}.xlsx`);
}

// Render the employee's expenses to an offscreen iframe, snapshot it with
// html2canvas and slice the bitmap across A4 pages.  Going through the
// browser's own renderer is what keeps the rupee sign intact — jsPDF's core
// fonts are Latin-1 and turn ₹ into garbage.  Imports are dynamic so these
// two heavy libs stay out of the initial bundle and off the server render.
async function downloadEmployeePDF(group, monthFilter) {
  const { default: jsPDF } = await import("jspdf");
  const { default: html2canvas } = await import("html2canvas");

  const expRows = group.expenses.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const allTravel = [...TRAVEL_TYPES.filter((t) => t.value !== "other"), ...TRAVEL_SUBTYPES];
  const typeLabel = (e) => {
    const t = EXPENSE_TYPES.find((x) => x.value === e.expense_type)?.label || e.expense_type || "—";
    if (e.expense_type === "travel" && e.travel_type) {
      const tl = allTravel.find((x) => x.value === e.travel_type)?.label || e.travel_type;
      return `${t} · ${tl}`;
    }
    return t;
  };
  const modeLabel = (e) => MODES.find((x) => x.value === e.mode)?.label || e.mode || "—";
  const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected", onhold: "On Hold", paid: "Paid" };
  const fmtINR = (n) => `₹${(n || 0).toLocaleString("en-IN")}`;
  const periodLabel = (() => {
    if (!monthFilter || monthFilter === "all") return "All months";
    const [y, m] = monthFilter.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
  })();
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  // Same Total − Rejected − Paid − Advance formula as the modal's "Payable
  // breakdown" card, so the downloaded PDF's Net Payable always matches
  // what's shown on screen for the same employee.
  const rejectedAmt = group.expenses.filter((e) => e.status === "rejected").reduce((s, e) => s + (e.amount || 0), 0);
  // Net each paid row against its own advance — a paid row that itself
  // carries an advance would otherwise have that advance subtracted twice
  // (once here, once via group.advance below).
  const paidAmt = group.expenses.filter((e) => e.status === "paid").reduce((s, e) => s + Math.max(0, (e.amount || 0) - (e.advance || 0)), 0);
  const netPayable = group.total - rejectedAmt - paidAmt - group.advance;

  const rowsHtml = expRows.map((e, i) => {
    const sub = (e.amount || 0) - (e.advance || 0);
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${e.date || "—"}</td>
      <td>${typeLabel(e)}</td>
      <td>${modeLabel(e)}</td>
      <td style="text-align:right">${fmtINR(e.amount)}</td>
      <td style="text-align:right">${(e.advance || 0) > 0 ? fmtINR(e.advance) : "—"}</td>
      <td style="text-align:right;${sub < 0 ? "color:#dc2626;font-weight:600" : "color:#059669;font-weight:600"}">${sub < 0 ? "-₹" + Math.abs(sub).toLocaleString("en-IN") : fmtINR(sub)}</td>
      <td>${STATUS_LABEL[e.status] || e.status || "—"}</td>
      <td>${e.site_name || "—"}</td>
      <td>${e.remarks || "—"}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:28px 32px;width:1400px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:2.5px solid #ea580c;margin-bottom:16px}
.co{font-size:20px;font-weight:700;color:#ea580c;line-height:1.1}
.doc{font-size:13px;font-weight:600;margin-top:3px}
.gen{font-size:10px;color:#999;margin-top:2px}
.emp{text-align:right}
.emp-name{font-size:14px;font-weight:700}
.emp-dept{font-size:10px;color:#666;margin-top:1px}
.emp-period{font-size:10px;color:#555;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:10.5px}
th{background:#ea580c;color:#fff;padding:7px 8px;text-align:left;font-weight:600;font-size:10.5px;white-space:nowrap}
th.r{text-align:right}
td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;word-break:break-word}
tr:nth-child(even) td{background:#fafafa}
tfoot td{font-weight:700;background:#fff7ed;border-top:2px solid #ea580c;padding:7px 8px;font-size:11px}
.summary{display:flex;justify-content:flex-end;margin-top:18px}
.sbox{border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;min-width:220px}
.sr{display:flex;justify-content:space-between;gap:32px;padding:3px 0;font-size:11px;color:#555}
.sr span:last-child{font-weight:600;color:#111}
.divider{border-top:1px solid #e5e7eb;margin:6px 0}
.net{display:flex;justify-content:space-between;gap:32px;font-size:12px;font-weight:700}
.net span:last-child{color:${netPayable < 0 ? "#dc2626" : "#059669"}}
.footer{margin-top:20px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:9px;color:#bbb;text-align:center}
/* column widths */
col.c0{width:36px} col.c1{width:90px} col.c2{width:110px} col.c3{width:80px}
col.c4{width:80px} col.c5{width:80px} col.c6{width:85px} col.c7{width:80px}
col.c8{width:120px} col.c9{width:auto}
</style></head><body>
<div class="hdr">
  <div>
    <div class="co">Ornate Solar</div>
    <div class="doc">Expense Report</div>
    <div class="gen">Generated: ${today}</div>
  </div>
  <div class="emp">
    <div class="emp-name">${group.userName}</div>
    ${group.userDepartment ? `<div class="emp-dept">${group.userDepartment}</div>` : ""}
    <div class="emp-period">Period: ${periodLabel}</div>
    <div class="emp-period">${expRows.length} expense${expRows.length !== 1 ? "s" : ""}</div>
  </div>
</div>
<table>
  <colgroup>
    <col class="c0"><col class="c1"><col class="c2"><col class="c3">
    <col class="c4"><col class="c5"><col class="c6"><col class="c7">
    <col class="c8"><col class="c9">
  </colgroup>
  <thead><tr>
    <th>#</th><th>Date</th><th>Type</th><th>Mode</th>
    <th class="r">Amount</th><th class="r">Advance</th><th class="r">Subtotal</th>
    <th>Status</th><th>Site</th><th>Remarks</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr>
    <td colspan="4" style="text-align:right">Total</td>
    <td style="text-align:right">${fmtINR(group.total)}</td>
    <td style="text-align:right">${group.advance > 0 ? fmtINR(group.advance) : "—"}</td>
    <td style="text-align:right;color:${netPayable < 0 ? "#dc2626" : "#059669"}">${netPayable < 0 ? "-₹" + Math.abs(netPayable).toLocaleString("en-IN") : fmtINR(netPayable)}</td>
    <td colspan="3"></td>
  </tr></tfoot>
</table>
<div class="summary">
  <div class="sbox">
    <div class="sr"><span>Total Expenses</span><span>${fmtINR(group.total)}</span></div>
    <div class="sr"><span>Advance Taken</span><span>${group.advance > 0 ? fmtINR(group.advance) : "—"}</span></div>
    <div class="divider"></div>
    <div class="net"><span>Net Payable</span><span>${netPayable < 0 ? "-₹" + Math.abs(netPayable).toLocaleString("en-IN") : fmtINR(netPayable)}</span></div>
  </div>
</div>
<div class="footer">Ornate Solar &nbsp;·&nbsp; Daily Report Portal &nbsp;·&nbsp; System-generated document</div>
</body></html>`;

  // Render HTML offscreen, capture with html2canvas, embed in jsPDF
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;z-index:-1;";
  container.innerHTML = html;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:1400px;height:10px;border:none;";
  container.appendChild(iframe);
  document.body.appendChild(container);

  await new Promise((resolve) => {
    iframe.onload = resolve;
    iframe.srcdoc = html;
  });

  // Let the iframe fully paint
  await new Promise((r) => setTimeout(r, 300));

  const iframeDoc = iframe.contentDocument;
  const iframeBody = iframeDoc.body;
  const fullH = iframeBody.scrollHeight;
  iframe.style.height = fullH + "px";

  await new Promise((r) => setTimeout(r, 100));

  const canvas = await html2canvas(iframeBody, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    width: 1400,
    height: fullH,
    windowWidth: 1400,
    windowHeight: fullH,
  });

  document.body.removeChild(container);

  // A4 landscape: 297 × 210 mm  →  at 96dpi: 1122 × 794px
  // canvas is 2800px wide (1400 × scale:2); map to 297mm width
  const PDF_W = 297;
  const PDF_H = 210;
  const pxPerMm = canvas.width / PDF_W;           // how many canvas px per mm
  const pageHeightPx = PDF_H * pxPerMm;           // canvas px that fit on one A4 page

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let srcY = 0;
  let pageNum = 0;
  while (srcY < canvas.height) {
    if (pageNum > 0) doc.addPage();
    const sliceH = Math.min(pageHeightPx, canvas.height - srcY);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceH;
    sliceCanvas.getContext("2d").drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    const imgData = sliceCanvas.toDataURL("image/jpeg", 0.95);
    const sliceMmH = sliceH / pxPerMm;
    doc.addImage(imgData, "JPEG", 0, 0, PDF_W, sliceMmH);
    srcY += sliceH;
    pageNum++;
  }

  const safeName = group.userName.replace(/[^a-z0-9]/gi, "_");
  doc.save(`Expense_${safeName}_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}

function AdminEmployeeTable({ expenses, isLoading, decidePending, onOpenEmployee, onBatchDecide, hideOnHold, monthFilter, isFinanceApprover, isCoordinator, onBatchMarkPaid, markPaidPending, employeeMonthlySummary }) {
  const baseGroups = useMemo(() => groupExpensesByUser(expenses), [expenses]);
  // 3-click sort cycle: unclicked → asc → desc → null (reset).  When
  // sortKey is null we fall back to the default order returned by
  // groupExpensesByUser (pending count desc, then name).
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(null);
  function toggleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc")  { setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortKey(null); setSortDir(null); return; }
    setSortDir("asc");
  }
  const groups = useMemo(() => {
    if (!sortKey || !sortDir) return baseGroups;
    const keyed = baseGroups.map((g) => {
      const subtotal = (g.total || 0) - (g.advance || 0);
      const values = {
        date:    g.latestExpenseDate || "",
        name:    (g.userName || "").toLowerCase(),
        total:   g.total || 0,
        advance: g.advance || 0,
        subtotal,
        bills:   g.withBillsCount || 0,
        submit:  g.latestSubmitAt || "",
      };
      return { g, v: values[sortKey] };
    });
    keyed.sort((a, b) => {
      if (a.v === b.v) return 0;
      const cmp = a.v > b.v ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return keyed.map((k) => k.g);
  }, [baseGroups, sortKey, sortDir]);

  // Totals across whatever the parent has already filtered to (usually the
  // current month).  Shown as a footer row so the user can see the visible
  // total without scanning every row.  Since a row is now (employee, status)
  // rather than just employee, "employee count" needs its own distinct set —
  // groups.length would double-count anyone spanning multiple statuses.
  const visibleTotals = useMemo(() => {
    let amount = 0;
    let advance = 0;
    let paidMonth = 0;
    let remainingMonth = 0;
    const employeeIds = new Set();
    for (const g of groups) {
      amount += g.total || 0;
      advance += g.advance || 0;
      // employeeMonthlySummary is keyed by userId (already deduped), so only
      // add each employee's month totals once even though a row-per-status
      // design can list the same employee across several rows.
      if (!employeeIds.has(g.userId)) {
        const monthly = employeeMonthlySummary?.get(g.userId);
        paidMonth += monthly?.paidAmt || 0;
        remainingMonth += monthly?.remainingAmt || 0;
      }
      employeeIds.add(g.userId);
    }
    return { amount, advance, subtotal: amount - advance, employeeCount: employeeIds.size, paidMonth, remainingMonth };
  }, [groups, employeeMonthlySummary]);

  // Sortable header cell — shows a small ↑/↓ indicator on the active
  // column and dims non-active columns' arrows to hint they're clickable.
  const SortTh = ({ col, children, align = "left" }) => {
    const active = sortKey === col;
    const arrow = !active ? "↕" : (sortDir === "asc" ? "↑" : "↓");
    return (
      <Table.Th className={align === "right" ? "text-right" : undefined}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleSort(col); }}
          className={`inline-flex items-center gap-1 select-none ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-orange-700" : "text-inherit"} hover:text-orange-700`}
          title="Click to sort — 3rd click resets"
        >
          {children}
          <span className={`text-[10px] ${active ? "opacity-100" : "opacity-40"}`}>{arrow}</span>
        </button>
      </Table.Th>
    );
  };
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
          <SortTh col="date">Date of Expense</SortTh>
          <SortTh col="name">Employee</SortTh>
          <SortTh col="total">Total Amount</SortTh>
          <SortTh col="advance">Advance</SortTh>
          <SortTh col="subtotal">Subtotal</SortTh>
          <Table.Th className="text-right" title="Paid so far this month — payment runs happen ~twice a month">Paid (Month)</Table.Th>
          <Table.Th className="text-right" title="Still owed this month, net of advance and what's already paid">Remaining (Month)</Table.Th>
          <Table.Th>Status</Table.Th>
          <SortTh col="bills">Bills</SortTh>
          <SortTh col="submit">Submit Date</SortTh>
          {isFinanceApprover && <Table.Th>Paid Date</Table.Th>}
          <Table.Th className="text-right">Actions</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {isLoading ? (
          <Table.Empty colSpan={isFinanceApprover ? 12 : 11} message="Loading expenses…" />
        ) : groups.length === 0 ? (
          <Table.Empty colSpan={isFinanceApprover ? 12 : 11} message="No expenses to review yet." />
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
              <Table.Td className={`tabular-nums font-semibold ${(g.total || 0) - (g.advance || 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                {(() => { const n = (g.total || 0) - (g.advance || 0); return (n < 0 ? "-₹" : "₹") + Math.abs(n).toLocaleString("en-IN"); })()}
              </Table.Td>
              {(() => {
                const monthly = employeeMonthlySummary?.get(g.userId);
                const paidAmt = monthly?.paidAmt || 0;
                const remainingAmt = monthly?.remainingAmt ?? 0;
                return (
                  <>
                    <Table.Td className="text-right tabular-nums font-medium text-sky-700">
                      {paidAmt > 0 ? `₹${paidAmt.toLocaleString("en-IN")}` : "—"}
                    </Table.Td>
                    <Table.Td className={`text-right tabular-nums font-medium ${remainingAmt < 0 ? "text-rose-600" : "text-amber-700"}`}>
                      {remainingAmt < 0 ? "−" : ""}{remainingAmt !== 0 ? `₹${Math.abs(remainingAmt).toLocaleString("en-IN")}` : "—"}
                    </Table.Td>
                  </>
                );
              })()}
              <Table.Td>
                <StatusMix
                  pending={g.pendingCount}
                  onHold={g.onHoldCount}
                  rejected={g.rejectedCount}
                  approved={g.approvedCount}
                  paid={g.paidCount}
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
              {isFinanceApprover && (
                <Table.Td className="whitespace-nowrap text-zinc-700">
                  {g.latestPaidAt
                    ? formatPretty(String(g.latestPaidAt).slice(0, 10))
                    : "—"}
                </Table.Td>
              )}
              <Table.Td className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                {/* Always available, whichever action branch renders below.
                    Stops propagation so it doesn't also open the row modal. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); downloadEmployeePDF(g, monthFilter); }}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
                  title="Download expense report as PDF"
                >
                  ⬇ PDF
                </button>
                {/* Coordinators are read-only: PDF + Open only, no decisions. */}
                {isCoordinator ? null : isFinanceApprover ? (
                  // Finance approver (Shivangi / Saif) sees a single batch Paid
                  // action that fires for every approved expense in this
                  // employee's group.  No approve / reject controls.
                  g.approvedCount > 0 ? (
                    <div
                      className="flex items-center justify-end gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={markPaidPending}
                        onClick={() => onBatchMarkPaid(g)}
                        className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                        title={`Mark ${g.approvedCount} approved expense(s) as paid`}
                      >
                        Paid ({g.approvedCount})
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-zinc-400">
                      {g.expenses.some((e) => e.status === "paid") ? "All paid" : "Nothing approved"}
                    </span>
                  )
                ) : g.pendingCount > 0 ? (
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
                </div>
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
            <Table.Td className={`tabular-nums font-semibold ${visibleTotals.subtotal < 0 ? "text-rose-600" : "text-emerald-700"}`}>
              {(visibleTotals.subtotal < 0 ? "-₹" : "₹") + Math.abs(visibleTotals.subtotal).toLocaleString("en-IN")}
            </Table.Td>
            <Table.Td className="text-right tabular-nums text-sky-700">
              {visibleTotals.paidMonth > 0 ? `₹${visibleTotals.paidMonth.toLocaleString("en-IN")}` : "—"}
            </Table.Td>
            <Table.Td className={`text-right tabular-nums ${visibleTotals.remainingMonth < 0 ? "text-rose-600" : "text-amber-700"}`}>
              {visibleTotals.remainingMonth < 0 ? "−" : ""}{visibleTotals.remainingMonth !== 0 ? `₹${Math.abs(visibleTotals.remainingMonth).toLocaleString("en-IN")}` : "—"}
            </Table.Td>
            <Table.Td colSpan={4} />
          </Table.Row>
        </Table.Foot>
      )}
    </Table>
  );
}

function StatusMix({ pending, approved, rejected, onHold, paid }) {
  const items = [
    { count: pending,  cls: "bg-amber-50 text-amber-800 ring-amber-200",       label: "Pending"  },
    { count: onHold,   cls: "bg-sky-50 text-sky-700 ring-sky-200",             label: "On Hold"  },
    { count: approved, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Approved" },
    { count: paid,     cls: "bg-violet-50 text-violet-700 ring-violet-200",    label: "Paid"     },
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

// Click-to-edit remarks — mirrors the expense-type <select> right next to
// it: only available while HR/Tarini can still edit the row at all (pending,
// same gate `onUpdateType` already uses), saves on blur/Enter, Escape reverts.
function RemarksCell({ row, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.remarks || "");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setValue(row.remarks || ""); setEditing(true); }}
        className="block max-w-[320px] truncate whitespace-pre-wrap rounded px-1 py-0.5 text-left text-zinc-700 hover:bg-orange-50 hover:text-orange-700"
        title={row.remarks ? `${row.remarks} (click to edit)` : "Click to add a remark"}
      >
        {row.remarks || <span className="text-zinc-300">—</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        setEditing(false);
        const trimmed = value.trim();
        if (trimmed !== (row.remarks || "")) onSave(row.id, trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setValue(row.remarks || ""); setEditing(false); }
      }}
      className="w-full max-w-[320px] rounded border border-orange-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-800 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/20"
    />
  );
}

// Same idea as RemarksCell but for the site name — HR clicks the cell to
// edit in place, saves on blur/Enter, Escape reverts.  Shown untruncated so
// the full site text is always readable.
function SiteCell({ row, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.site_name || "");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setValue(row.site_name || ""); setEditing(true); }}
        className="block max-w-[240px] whitespace-pre-wrap rounded px-1 py-0.5 text-left text-zinc-700 hover:bg-orange-50 hover:text-orange-700"
        title={row.site_name ? `${row.site_name} (click to edit)` : "Click to add a site"}
      >
        {row.site_name || <span className="text-zinc-300">—</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        setEditing(false);
        const trimmed = value.trim();
        if (trimmed !== (row.site_name || "")) onSave(row.id, trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setValue(row.site_name || ""); setEditing(false); }
      }}
      className="w-full max-w-[240px] rounded border border-orange-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-800 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/20"
    />
  );
}

// HR-side "+ Bill" uploader — lets HR attach bill files to an employee's
// pending expense straight from the admin modal.  The backend already
// permits HR on any expense (same gate as PATCH), so this is pure UI.
function AddBillButton({ row, onAdd, disabled }) {
  return (
    <label
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:border-orange-400 hover:text-orange-600 ${disabled ? "pointer-events-none opacity-50" : ""}`}
      title="Upload bill(s) for this expense"
      onClick={(e) => e.stopPropagation()}
    >
      + Bill
      <input
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = ""; // allow re-picking the same file next time
          if (files.length) onAdd(row.id, files);
        }}
      />
    </label>
  );
}

// `onDecide` omitted => the approve / reject / hold controls (and the row
// checkboxes that drive them) disappear entirely.  Finance gets `onMarkPaid`
// instead: they disburse, they don't decide.
function EmployeeExpensesModal({ group, monthFilter, onClose, onDecide, onUpdateType, onUpdateRemarks, onUpdateSite, onAddBills, decidePending, updatingType, hideOnHold, onMarkPaid, markPaidPending, onDownloadExcel }) {
  // Full-screen image preview state — set to { url, filename } when a bill
  // thumbnail is clicked.  Click anywhere outside the image to close.
  const [preview, setPreview] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // Inline decision-note state.  HR can start typing the moment she
  // checks any row; the note gets attached to whichever action (Reject
  // / Hold / Approve) fires next.  Cleared after the mutation runs.
  const [decisionNote, setDecisionNote] = useState("");

  function toggleId(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleDay(ids) {
    const allOn = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allOn) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }
  function handleDecide(ids, decision, note = "") {
    ids.forEach(id => onDecide(id, decision, note));
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    // Clear the inline note after firing so the next decision starts clean.
    setDecisionNote("");
  }

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
        className="w-full max-w-[92vw] 2xl:max-w-7xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lift"
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
              {monthFilter && monthFilter !== "all" && (() => {
                const [y, m] = monthFilter.split("-");
                return ` · ${new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" })}`;
              })()}
            </p>
            {typeBreakdown.length > 0 && (
              <p className="mt-1.5 text-[13px] text-zinc-700">
                {typeBreakdown.map((t, i) => (
                  <span key={t.label}>
                    {i > 0 && <span className="mx-1.5 text-zinc-400">·</span>}
                    <span className="font-semibold capitalize text-zinc-900">{t.label}</span>{" "}
                    <span className="tabular-nums">
                      ₹{t.amount.toLocaleString("en-IN")}
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Coordinator-only: export this employee's expenses to Excel. */}
            {onDownloadExcel && (
              <button
                type="button"
                onClick={() => onDownloadExcel(group)}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                title="Download this employee's expenses as an Excel file"
              >
                ⬇ Excel
              </button>
            )}
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

        <div className="max-h-[82vh] overflow-y-auto p-5">
          {/* Payable breakdown — makes it unambiguous once some rows are
              rejected or already paid: Total − Rejected − Paid − Advance =
              Net Payable. Also splits out Approved vs Pending amounts so
              it's clear at a glance how much of the remaining total is
              actually decided vs still awaiting a decision. Placed above
              the table, top-right, so it's visible without scrolling down
              past a long expense list. This is the canonical "still owed"
              formula — every other Net Payable figure in this file (page
              header, PDF export, table footer below, Monthly Summary modal,
              Advances panel) mirrors it so they never disagree. */}
          {(() => {
            const totalAmt = group.expenses.reduce((s, r) => s + (r.amount || 0), 0);
            const totalAdv = group.expenses.reduce((s, r) => s + (r.advance || 0), 0);
            const amtByStatus = (statuses) => group.expenses
              .filter((r) => statuses.includes(r.status))
              .reduce((s, r) => s + (r.amount || 0), 0);
            const rejectedAmt = amtByStatus(["rejected"]);
            // Net each paid row against its OWN advance (if any) — some
            // employees record advance directly on the same row as the real
            // claim rather than a separate zero-amount placeholder. Without
            // this, that advance gets subtracted twice: once implicitly (the
            // full raw amount counted as "already paid") and again via the
            // "Advance paid" line below, which can drive Net Payable deeply
            // and wrongly negative for those employees.
            const paidAmt = group.expenses
              .filter((r) => r.status === "paid")
              .reduce((s, r) => s + Math.max(0, (r.amount || 0) - (r.advance || 0)), 0);
            // Still owed = non-rejected total minus what's already paid out and
            // minus advances given. Updates live as rows are paid / approved.
            const netPayable = totalAmt - rejectedAmt - paidAmt - totalAdv;
            const inr = (n) => `₹${Math.abs(n).toLocaleString("en-IN")}`;
            return (
              <div className="mb-4 flex justify-end">
                <div className="sticky top-0 z-10 w-full max-w-xs rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm shadow-sm">
                  <div className="flex justify-between py-0.5 text-zinc-600">
                    <span>Total expense</span>
                    <span className="tabular-nums font-medium text-zinc-900">{inr(totalAmt)}</span>
                  </div>
                  {paidAmt > 0 && (
                    <div className="flex justify-between py-0.5 text-zinc-600">
                      <span>Paid</span>
                      <span className="tabular-nums font-medium text-sky-700">−{inr(paidAmt)}</span>
                    </div>
                  )}
                  {rejectedAmt > 0 && (
                    <div className="flex justify-between py-0.5 text-zinc-600">
                      <span>Rejected</span>
                      <span className="tabular-nums font-medium text-rose-600">−{inr(rejectedAmt)}</span>
                    </div>
                  )}
                  {totalAdv > 0 && (
                    <div className="flex justify-between py-0.5 text-zinc-600">
                      <span>Advance paid</span>
                      <span className="tabular-nums font-medium text-zinc-900">−{inr(totalAdv)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between border-t border-zinc-200 pt-1.5 font-semibold">
                    <span>Net payable (still to pay)</span>
                    <span className={`tabular-nums ${netPayable < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {netPayable < 0 ? "−" : ""}{inr(netPayable)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
          <Table maxHeight={640}>
            <Table.Head>
              <Table.Row>
                <Table.Th>Date</Table.Th>
                {onDecide && <Table.Th className="w-8" />}
                <Table.Th>Type</Table.Th>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Site</Table.Th>
                <Table.Th className="text-right">Amount</Table.Th>
                <Table.Th className="text-right">Advance</Table.Th>
                <Table.Th className="text-right">Subtotal</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Bill</Table.Th>
                <Table.Th>Remarks</Table.Th>
                <Table.Th>Decision Note</Table.Th>
                {onDecide && <Table.Th className="text-right">Action</Table.Th>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {(() => {
                // Group expenses by date, sorted descending
                const dateMap = new Map();
                for (const r of group.expenses) {
                  if (!dateMap.has(r.date)) dateMap.set(r.date, []);
                  dateMap.get(r.date).push(r);
                }
                const dateGroups = Array.from(dateMap.entries()).sort(([a], [b]) => b.localeCompare(a));
                // Column count for the day-header colspan.  Base columns:
                // Date · Type · Mode · Site · Amount · Advance · Subtotal ·
                // Status · Bill · Remarks · Decision Note = 11.  With
                // action mode ON we add the per-row checkbox cell + the
                // trailing action cell = 13.
                const colCount = onDecide ? 13 : 11;

                return dateGroups.flatMap(([date, rows]) => {
                  const realRows  = rows.filter(r => !(r.amount === 0 && (r.advance || 0) > 0));
                  const advRows   = rows.filter(r =>  r.amount === 0 && (r.advance || 0) > 0);
                  const dayTotal  = realRows.reduce((s, r) => s + (r.amount  || 0), 0);
                  const dayAdv    = rows.reduce((s, r) => s + (r.advance || 0), 0);
                  const dayNet    = dayTotal - dayAdv;
                  const pending   = realRows.filter(r => r.status === "pending").length;

                  const pendingExpenses = realRows.filter(r => r.status === "pending");
                  // Finance's disbursal queue for this day — approved but not paid.
                  const approvedExpenses = realRows.filter(r => r.status === "approved");

                  return [
                    // ── Date group header row — one set of action buttons per day ──
                    <Table.Row key={`hdr-${date}`} className="bg-orange-50/60 border-t-2 border-orange-100">
                      <Table.Td colSpan={colCount} className="px-4 py-1.5">
                        <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-[13px] text-zinc-800">
                            {formatPretty(date)}
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            {realRows.length} expense{realRows.length !== 1 ? "s" : ""}
                            {advRows.length > 0 && ` · ${advRows.length} advance`}
                          </span>
                          <div className="ml-auto flex items-center gap-2.5">
                            <span className="text-[13px] font-bold tabular-nums text-zinc-900">
                              ₹{dayTotal.toLocaleString("en-IN")}
                            </span>
                            {dayAdv > 0 && (
                              <span className="text-[11px] tabular-nums text-zinc-500">
                                adv ₹{dayAdv.toLocaleString("en-IN")}
                              </span>
                            )}
                            {dayNet < 0 && (
                              <span className="text-[11px] tabular-nums font-semibold text-rose-600">
                                net -₹{Math.abs(dayNet).toLocaleString("en-IN")}
                              </span>
                            )}
                            {onDecide && pendingExpenses.length > 0 && (() => {
                              const daySelected = pendingExpenses.filter(r => selectedIds.has(r.id));
                              const actOn = daySelected.length > 0 ? daySelected : pendingExpenses;
                              const suffix = daySelected.length > 0 ? ` (${daySelected.length})` : " All";
                              const allChecked = pendingExpenses.every(r => selectedIds.has(r.id));
                              const someChecked = !allChecked && pendingExpenses.some(r => selectedIds.has(r.id));
                              return (
                                <div className="flex items-center gap-1 border-l border-orange-200 pl-2.5">
                                  <label className="flex cursor-pointer items-center gap-1 pr-1" title="Select all for this day">
                                    <input
                                      type="checkbox"
                                      checked={allChecked}
                                      ref={el => { if (el) el.indeterminate = someChecked; }}
                                      onChange={() => toggleDay(pendingExpenses.map(r => r.id))}
                                      className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 accent-orange-600"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    disabled={decidePending}
                                    onClick={() => handleDecide(actOn.map(r => r.id), "rejected", decisionNote.trim())}
                                    className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                  >
                                    Reject{suffix}
                                  </button>
                                  {!hideOnHold && (
                                    <button
                                      type="button"
                                      disabled={decidePending}
                                      onClick={() => handleDecide(actOn.map(r => r.id), "onhold", decisionNote.trim())}
                                      className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-60"
                                    >
                                      Hold{suffix}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={decidePending}
                                    onClick={() => handleDecide(actOn.map(r => r.id), "approved", decisionNote.trim())}
                                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                  >
                                    Approve{suffix}
                                  </button>
                                </div>
                              );
                            })()}
                            {/* Finance's only action — no approve / reject / hold. */}
                            {onMarkPaid && approvedExpenses.length > 0 && (
                              <div className="flex items-center gap-1 border-l border-orange-200 pl-2.5">
                                <button
                                  type="button"
                                  disabled={markPaidPending}
                                  onClick={() => onMarkPaid(approvedExpenses.map(r => r.id))}
                                  className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                  title={`Mark ${approvedExpenses.length} approved expense(s) from this day as paid`}
                                >
                                  Paid ({approvedExpenses.length})
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Inline remarks — appears as soon as HR checks
                            a row.  Whatever's typed is attached as
                            decision_note to the next Reject / Hold /
                            Approve fired for this day. */}
                        {onDecide && pendingExpenses.length > 0 && pendingExpenses.some(r => selectedIds.has(r.id)) && (
                          <div className="flex items-center gap-2 pl-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Remarks</span>
                            <input
                              type="text"
                              value={decisionNote}
                              onChange={(e) => setDecisionNote(e.target.value)}
                              maxLength={500}
                              placeholder="Reason / note for this action (visible to the employee)"
                              className="flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] text-zinc-900 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
                            />
                          </div>
                        )}
                        </div>
                      </Table.Td>
                    </Table.Row>,
                    // ── Individual expense sub-rows (no action buttons) ────
                    ...rows.map((r) => {
                      const isAdvanceRow = r.amount === 0 && (r.advance || 0) > 0;
                      return (
                        <Table.Row key={r.id} className="bg-white">
                          <Table.Td className="w-px select-none pl-4 text-[11px] text-zinc-300">└</Table.Td>
                          {onDecide && (
                            <Table.Td className="w-8 pl-2">
                              {!isAdvanceRow && r.status === "pending" && (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(r.id)}
                                  onChange={() => toggleId(r.id)}
                                  className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 accent-orange-600"
                                />
                              )}
                            </Table.Td>
                          )}
                          <Table.Td>
                            {onUpdateType && !isAdvanceRow && r.status === "pending" ? (
                              // HR / Tarini can re-classify a pending row in
                              // this modal only.  Fires the PATCH mutation
                              // immediately on change.
                              <select
                                value={r.expense_type || "others"}
                                disabled={updatingType}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  if (next && next !== r.expense_type) {
                                    onUpdateType(r.id, next);
                                  }
                                }}
                                className="w-full rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] capitalize text-zinc-800 hover:border-orange-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 disabled:opacity-60"
                                title="Change expense type"
                              >
                                {EXPENSE_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            ) : (
                              <>
                                <span className="capitalize">{r.expense_type}</span>
                                {r.travel_type && (
                                  <span className="text-[10px] text-zinc-500"> · {r.travel_type}</span>
                                )}
                              </>
                            )}
                          </Table.Td>
                          <Table.Td className="capitalize">{r.mode || "—"}</Table.Td>
                          <Table.Td className="max-w-[240px] text-zinc-700">
                            {onUpdateSite && !isAdvanceRow && r.status === "pending" ? (
                              // HR can fix the site text in place — same
                              // gate as the Type / Remarks editors.
                              <SiteCell row={r} onSave={onUpdateSite} disabled={updatingType} />
                            ) : (
                              <span className="whitespace-pre-wrap" title={r.site_name}>{r.site_name || "—"}</span>
                            )}
                          </Table.Td>
                          <Table.Td className="text-right tabular-nums font-medium">
                            {isAdvanceRow ? "—" : `₹${(r.amount || 0).toLocaleString("en-IN")}`}
                          </Table.Td>
                          <Table.Td className="text-right tabular-nums text-zinc-700">
                            {r.advance ? `₹${(r.advance || 0).toLocaleString("en-IN")}` : "—"}
                          </Table.Td>
                          <Table.Td className="text-right tabular-nums font-semibold text-emerald-700">
                            {isAdvanceRow ? "—" : `₹${Math.max(0, (r.amount || 0) - (r.advance || 0)).toLocaleString("en-IN")}`}
                          </Table.Td>
                          <Table.Td>
                            {isAdvanceRow ? <span className="text-zinc-400">—</span> : <StatusPill status={r.status} />}
                          </Table.Td>
                          <Table.Td>
                            {isAdvanceRow ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <BillThumbnail
                                  expense={r}
                                  onOpen={(expense) => setPreview(expense)}
                                />
                                {onAddBills && r.status === "pending" && (
                                  <AddBillButton row={r} onAdd={onAddBills} disabled={updatingType} />
                                )}
                              </div>
                            )}
                          </Table.Td>
                          <Table.Td className="max-w-[320px] text-zinc-700">
                            {onUpdateRemarks && !isAdvanceRow && r.status === "pending" ? (
                              <RemarksCell row={r} onSave={onUpdateRemarks} disabled={updatingType} />
                            ) : (
                              <span className="whitespace-pre-wrap" title={r.remarks}>{r.remarks || "—"}</span>
                            )}
                          </Table.Td>
                          {/* Decision Note — the note HR / Tarini attached
                              when they approved, held, or rejected the row.
                              Colour tint matches the decision so it reads
                              at a glance. */}
                          <Table.Td className="max-w-[240px] whitespace-pre-wrap" title={r.decision_note}>
                            {r.decision_note ? (
                              <span className={
                                r.status === "rejected"
                                  ? "text-rose-700"
                                  : r.status === "onhold"
                                    ? "text-sky-700"
                                    : "text-emerald-700"
                              }>
                                {r.decision_note}
                              </span>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </Table.Td>
                          {onDecide && <Table.Td />}
                        </Table.Row>
                      );
                    }),
                  ];
                });
              })()}
            </Table.Body>
            {(() => {
              const totalAmt = group.expenses.reduce((s, r) => s + (r.amount || 0), 0);
              const totalAdv = group.expenses.reduce((s, r) => s + (r.advance || 0), 0);
              // Rejected expenses are NOT reimbursed, and already-paid amounts
              // are no longer owed — both must come out of the payable. Same
              // formula as the "Payable breakdown" card above (Total − Rejected
              // − Paid − Advance) — kept in sync so this footer and that card
              // never show two different "what's still owed" numbers for the
              // same employee.
              const rejectedAmt = group.expenses
                .filter((r) => r.status === "rejected")
                .reduce((s, r) => s + (r.amount || 0), 0);
              // Net each paid row against its own advance — see the same note
              // on the breakdown card above.
              const paidAmt = group.expenses
                .filter((r) => r.status === "paid")
                .reduce((s, r) => s + Math.max(0, (r.amount || 0) - (r.advance || 0)), 0);
              const totalNet = totalAmt - rejectedAmt - paidAmt - totalAdv;
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
                    <Table.Td className={`text-right tabular-nums ${totalNet < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {(totalNet < 0 ? "-₹" : "₹") + Math.abs(totalNet).toLocaleString("en-IN")}
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
          expense={preview}
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
        if (url) onOpen(expense);
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

function MonthlySummaryModal({ allExpenses, monthFilter, onClose }) {
  // Derive year/month from the admin filter bar selection (no in-modal picker).
  const now = new Date();
  const [year, month] = useMemo(() => {
    if (monthFilter && monthFilter !== "all") {
      const [y, m] = monthFilter.split("-");
      return [Number(y), Number(m)];
    }
    return [now.getFullYear(), now.getMonth() + 1];
  }, [monthFilter]); // eslint-disable-line react-hooks/exhaustive-deps
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
          advance: 0,
          rejectedAmt: 0,
          paidAmt: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          onhold: 0,
          paid: 0,
          latestSubmit: e.created_at || e.date,
        });
      }
      const g = byUser.get(e.user_id);
      g.total += (e.amount || 0);
      g.advance += (e.advance || 0);
      if (e.status === "pending")  g.pending  += 1;
      if (e.status === "approved") g.approved += 1;
      if (e.status === "rejected") { g.rejected += 1; g.rejectedAmt += (e.amount || 0); }
      if (e.status === "onhold")   g.onhold   += 1;
      // Net each paid row against its own advance — see the matching note
      // in the per-employee modal's breakdown card.
      if (e.status === "paid")     { g.paid    += 1; g.paidAmt += Math.max(0, (e.amount || 0) - (e.advance || 0)); }
      const ts = e.created_at || e.date;
      if (ts > (g.latestSubmit || "")) g.latestSubmit = ts;
    }
    return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allExpenses, monthStart, monthEnd]);

  // Footer totals.  Same Total − Rejected − Paid − Advance "still owed"
  // formula used everywhere else this session (the per-employee modal's
  // breakdown card, its table footer, the PDF export, and the page header) —
  // kept in sync so no two views of the same numbers ever disagree.
  const totals = useMemo(() => {
    let amount = 0, advance = 0, subtotal = 0;
    for (const g of groups) {
      amount   += g.total;
      advance  += g.advance;
      subtotal += Math.max(0, g.total - g.rejectedAmt - g.paidAmt - g.advance);
    }
    return { amount, advance, subtotal };
  }, [groups]);

  const monthLabel = new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long", year: "numeric",
  });

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
          <div>
            <h3 className="text-base font-semibold text-zinc-900">
              Monthly Expense Summary
            </h3>
            <p className="text-xs text-zinc-500">{monthLabel}</p>
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
                  <th className="px-3 py-2 text-right">Net Payable</th>
                  <th className="px-3 py-2">Submit Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {groups.map((g) => {
                  const subtotal = Math.max(0, g.total - g.rejectedAmt - g.paidAmt - g.advance);
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
                          paid={g.paid}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                        {g.advance > 0 ? `₹${g.advance.toLocaleString("en-IN")}` : "—"}
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
                    {totals.advance > 0 ? `₹${totals.advance.toLocaleString("en-IN")}` : "—"}
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

function BillPreviewOverlay({ expense, onClose }) {
  const bills = expense?.bills || [];
  const billCount = bills.length;
  const [index, setIndex] = useState(0);
  const [urls, setUrls] = useState({});

  useEffect(() => {
    if (!billCount) return;
    const created = [];
    let cancelled = false;
    (async () => {
      const { api } = await import("@/lib/api");
      for (let i = 0; i < billCount; i++) {
        try {
          const resp = await api.get(`/api/expenses/${expense.id}/bill/${i}`, { responseType: "blob" });
          if (cancelled) return;
          const u = URL.createObjectURL(resp.data);
          created.push(u);
          setUrls((prev) => ({ ...prev, [i]: u }));
        } catch {
          if (!cancelled) setUrls((prev) => ({ ...prev, [i]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [expense?.id, billCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, billCount - 1));
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   setIndex((i) => Math.max(i - 1, 0));
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [billCount, onClose]);

  const currentFilename = bills[index]?.filename || "";
  const isPdf = /\.pdf$/i.test(currentFilename);
  const currentUrl = urls[index];

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-zinc-900/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Counter + download + close.  Download re-uses the already-
            loaded blob URL for the visible bill, so it's instant and
            doesn't hit the server a second time.  When the bill is still
            loading (or failed), the button disables itself. */}
        <div className="flex w-full items-center justify-between px-1">
          <span className="text-xs font-medium text-white/80">
            {billCount > 1 ? `${index + 1} / ${billCount}` : "1 bill"}
          </span>
          <div className="flex items-center gap-2">
            <a
              href={currentUrl || undefined}
              download={currentFilename || `bill-${index + 1}`}
              aria-disabled={!currentUrl}
              onClick={(e) => { if (!currentUrl) e.preventDefault(); }}
              className={`rounded-md px-2 py-1 text-xs font-medium text-white ${
                currentUrl
                  ? "bg-orange-600 hover:bg-orange-700"
                  : "bg-zinc-500/60 cursor-not-allowed pointer-events-none"
              }`}
              title={currentUrl ? `Download ${currentFilename || "this bill"}` : "Bill still loading"}
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-zinc-900/60 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-900/80"
            >
              Close
            </button>
          </div>
        </div>

        {/* Image / PDF */}
        <div className="relative max-h-[80vh] max-w-[90vw] overflow-hidden rounded-lg bg-white">
          {currentUrl === undefined ? (
            <div className="flex h-48 w-64 items-center justify-center text-zinc-400 text-sm">Loading…</div>
          ) : currentUrl === null ? (
            <div className="flex h-48 w-64 items-center justify-center text-zinc-400 text-sm">Failed to load</div>
          ) : isPdf ? (
            <iframe src={currentUrl} className="h-[75vh] w-[80vw]" title="Bill" />
          ) : (
            <img src={currentUrl} alt={currentFilename || "Bill"} className="max-h-[80vh] max-w-[90vw] object-contain" />
          )}
        </div>

        {/* Prev / Next */}
        {billCount > 1 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
              disabled={index === 0}
              className="rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/30 disabled:opacity-30"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(i + 1, billCount - 1))}
              disabled={index === billCount - 1}
              className="rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/30 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
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

function EditExpenseModal({ row, onClose, onSave, saving, onDeleteBill, pastSiteNames = [] }) {
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
                list="expense-past-sites-edit"
                autoComplete="off"
                className={inputClass}
              />
              {pastSiteNames.length > 0 && (
                <datalist id="expense-past-sites-edit">
                  {pastSiteNames.map((s) => <option key={s} value={s} />)}
                </datalist>
              )}
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
function EmployeeAdvanceModal({ onClose, onSave, saving }) {
  const [amount, setAmount] = useState("");
  const [date, setDate]     = useState(todayISO());
  const [note, setNote]     = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    onSave({ amount: Number(amount), date, note });
  }

  const inputCls = "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Record Advance Received</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">Date received</label>
              <input
                type="date"
                value={date}
                max={todayISO()}
                onChange={(e) => setDate(e.target.value || todayISO())}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">Amount (₹)</label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={inputCls}
                required
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">Remark (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. advance for site visit"
              className={inputCls}
              maxLength={200}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-md border border-zinc-200 px-4 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving ? "Saving…" : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddAdvanceModal({ employees, onClose, onSave, saving }) {
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount]         = useState("");
  const [date, setDate]             = useState(todayISO());
  const [note, setNote]             = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [paidDate, setPaidDate]     = useState("");
  const [paidAmount, setPaidAmount] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!employeeId || !amount || Number(amount) <= 0) return;
    onSave({
      employee_id: Number(employeeId),
      amount: Number(amount),
      date,
      note,
      approved_by: approvedBy,
      paid_date: paidDate,
      // Blank paid amount + a paid date means the full advance went out —
      // the server fills it in.
      paid_amount: paidAmount === "" ? null : Number(paidAmount),
    });
  }

  const inputCls = "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Issue Advance</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Select employee…</option>
              {(employees || []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name}
                  {emp.department_name ? ` · ${emp.department_name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">Date</label>
              <input
                type="date"
                value={date}
                max={todayISO()}
                onChange={(e) => setDate(e.target.value || todayISO())}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">Amount (₹)</label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={inputCls}
                required
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">Approved by (optional)</label>
            <input
              type="text"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              placeholder="e.g. Tarini Aggrawal"
              className={inputCls}
              maxLength={120}
            />
          </div>

          {/* Payment details — filling the paid date records the advance as
              already disbursed instead of leaving it in the pending queue. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">Paid date (optional)</label>
              <input
                type="date"
                value={paidDate}
                max={todayISO()}
                onChange={(e) => {
                  setPaidDate(e.target.value);
                  if (!e.target.value) setPaidAmount("");
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-600">Paid amount (₹)</label>
              <input
                type="number"
                min={0}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder={paidDate ? String(amount || 0) : "—"}
                disabled={!paidDate}
                className={`${inputCls} disabled:bg-zinc-50 disabled:text-zinc-400`}
              />
            </div>
          </div>
          {paidDate && (
            <p className="-mt-2 text-[10px] text-zinc-500">
              Marks this advance as paid. Leave the amount blank to record the full ₹
              {Number(amount || 0).toLocaleString("en-IN")}.
            </p>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">Remarks (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. advance for site visit"
              className={inputCls}
              maxLength={200}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-md border border-zinc-200 px-4 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || !employeeId || !amount}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving ? "Saving…" : "Issue Advance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MarkPaidModal({ expenseCount, userName, saving, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [paidDate, setPaidDate] = useState(today);
  const [paymentRef, setPaymentRef] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    onSave({ paid_date: paidDate, payment_ref: paymentRef });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Mark as Paid</h3>
            {userName && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {expenseCount} expense{expenseCount !== 1 ? "s" : ""} · {userName}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:text-zinc-700">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-4 py-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">Payment Date</label>
            <input
              type="date"
              value={paidDate}
              max={today}
              onChange={(e) => setPaidDate(e.target.value)}
              required
              className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-900 focus:border-orange-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600">UTR Number <span className="text-zinc-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="UTR Number"
              className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-orange-400 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || !paidDate} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
              {saving ? "Marking…" : "Mark Paid"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdvancesTable({ items, onAddAdvance }) {
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
        <div className="flex items-center gap-3">
          {onAddAdvance && (
            <button
              type="button"
              onClick={onAddAdvance}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              + Add Advance
            </button>
          )}
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Total advance</p>
            <p className="text-sm font-semibold text-zinc-900 tabular-nums">
              ₹{totalAdvance.toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </div>
      <table className="min-w-full divide-y divide-zinc-100 text-xs">
        <thead className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          <tr>
            <th className="px-4 py-2">Employee</th>
            <th className="px-4 py-2 text-right">Total Expense</th>
            <th className="px-4 py-2 text-right">Total Advance</th>
            <th className="px-4 py-2 text-right">Net Payable</th>
            <th className="px-4 py-2">Latest Expense</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {(items || []).length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                No advances recorded on any expense yet.
              </td>
            </tr>
          ) : (
            items.map((g) => {
              const net = g.totalAmount - (g.rejectedAmt || 0) - (g.paidAmt || 0) - g.totalAdvance;
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
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${net < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    {(net < 0 ? "-₹" : "₹") + Math.abs(net).toLocaleString("en-IN")}
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
          <Table.Th>Decision Note</Table.Th>
          <Table.Th className="text-right">{isAdmin ? "" : "Action"}</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {isLoading ? (
          <Table.Empty colSpan={isAdmin ? 12 : 11} message="Loading expenses…" />
        ) : rows.length === 0 ? (
          <Table.Empty
            colSpan={isAdmin ? 12 : 11}
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
                  onOpen={(expense) => setPreview(expense)}
                />
              </Table.Td>
              <Table.Td className="max-w-[320px] whitespace-pre-wrap break-words text-zinc-600">
                {r.remarks || "—"}
              </Table.Td>
              {/* Decision Note — the note HR / Tarini attached with their
                  decision.  Colour matches the row's status so employees
                  can spot the reason on rejected / held rows quickly. */}
              <Table.Td className="max-w-[240px] whitespace-pre-wrap break-words">
                {r.decision_note ? (
                  <span className={
                    r.status === "rejected"
                      ? "text-rose-700"
                      : r.status === "onhold"
                        ? "text-sky-700"
                        : "text-emerald-700"
                  }>
                    {r.decision_note}
                  </span>
                ) : (
                  <span className="text-zinc-300">—</span>
                )}
              </Table.Td>
              <Table.Td className="text-right">
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600">
                    Open →
                  </span>
                ) : (
                  // Edit while the expense is pending / on hold, and on
                  // rejected rows so the employee can fix and resubmit
                  // (saving sends it back to pending).  Delete stays limited
                  // to pending / on hold.  Approved / paid rows are locked.
                  (r.status === "pending" || r.status === "onhold" || r.status === "rejected") ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(r); }}
                        className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100"
                        title={r.status === "rejected" ? "Fix and resubmit — this sends the expense back for approval" : undefined}
                      >
                        {r.status === "rejected" ? "Edit & resubmit" : "Edit"}
                      </button>
                      {onDelete && r.status !== "rejected" && (
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
                      title="Approved expenses can't be edited or deleted"
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
        expense={preview}
        onClose={() => setPreview(null)}
      />
    )}
    </>
  );
}

function StatusPill({ status }) {
  const cls =
    status === "paid"     ? "bg-violet-50 text-violet-700 ring-violet-200"
    : status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "rejected" ? "bg-rose-50 text-rose-700 ring-rose-200"
    : status === "onhold"   ? "bg-sky-50 text-sky-700 ring-sky-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
  const label = status === "paid" ? "Paid"
    : status === "approved" ? "Approved"
    : status === "rejected" ? "Rejected"
    : status === "onhold"   ? "On Hold"
    : "Pending";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function ExpenseModal({ row, isAdmin, onClose, onDecide, onDelete, decidePending, deletePending, hideOnHold, onMarkPaid, markPaidPending }) {
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
          {onMarkPaid && row.status === "approved" && (
            <button
              type="button"
              onClick={() => onMarkPaid()}
              disabled={markPaidPending}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              title="Mark this approved expense as Paid — terminal, can't be undone"
            >
              {markPaidPending ? "Marking…" : "Mark Paid"}
            </button>
          )}
        </div>
      </div>

      {/* Bill preview sub-modal — opens for whichever bill card was clicked.
          Supports prev/next navigation when an expense has multiple bills. */}
      {openBillIndex >= 0 && openBill && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-zinc-900/70 p-4"
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
