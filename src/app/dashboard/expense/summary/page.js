"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useExpenses, useMe } from "@/lib/queries";

// Approver-gate helpers — mirrors the ones on the main Expense page so
// the summary respects the same visibility rules.  HR + Tarini + Smita
// see the whole company; regular employees see only their own row.
const APPROVER_LOCAL_PREFIXES = ["tarini", "smita"];
const FINANCE_LOCAL_PREFIXES  = ["shivangi"];
function _localMatches(email, prefixes) {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  return prefixes.some((p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "_"));
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nf = (n) => (Number(n) || 0).toLocaleString("en-IN");

// Colour by payment progress — matches the legend below the header.
function statusColor(total, paid) {
  if (total <= 0) return "text-zinc-300";
  if (paid >= total) return "text-emerald-600";
  if (paid > 0)      return "text-orange-600";
  return "text-rose-600";
}

export default function ExpenseSummaryPage() {
  const { data: me } = useMe();
  const { data: rawExpenses = [], isLoading } = useExpenses();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");

  const isAdmin = useMemo(() => {
    if (!me) return false;
    if (me.role === "hr") return true;
    if (_localMatches(me.email, APPROVER_LOCAL_PREFIXES)) return true;
    return _localMatches(me.email, FINANCE_LOCAL_PREFIXES);
  }, [me]);

  // Non-admin users only see their own expense rows — the table then
  // reduces to a single line for them.  Approvers see everyone.
  const scopedExpenses = useMemo(() => {
    if (!me) return [];
    if (isAdmin) return rawExpenses;
    return rawExpenses.filter((e) => e.user_id === me.id);
  }, [rawExpenses, me, isAdmin]);

  // Pivot: rows = employee × cell (total, paid).  Rejected expenses are
  // excluded so they don't inflate the numbers or drag the colour.
  const { rows, grandTotal, grandPaid, monthTotals, monthPaid, years } = useMemo(() => {
    const yearSet = new Set([now.getFullYear()]);
    const byUser = new Map();
    for (const e of scopedExpenses) {
      if (!e.date) continue;
      if (e.status === "rejected") continue;
      const d = new Date(e.date);
      const yr = d.getFullYear();
      yearSet.add(yr);
      if (yr !== year) continue;
      const mo = d.getMonth();
      const key = e.user_id;
      if (!byUser.has(key)) {
        byUser.set(key, {
          userId: key,
          name: e.user_name || "—",
          dept: e.user_department || "",
          months: Array.from({ length: 12 }, () => ({ total: 0, paid: 0 })),
          total: 0,
          paid: 0,
        });
      }
      const g = byUser.get(key);
      const amt = Number(e.amount) || 0;
      g.months[mo].total += amt;
      g.total += amt;
      if (e.status === "paid") {
        g.months[mo].paid += amt;
        g.paid += amt;
      }
    }
    const arr = Array.from(byUser.values()).sort((a, b) => {
      const da = (a.dept || "").toLowerCase();
      const db = (b.dept || "").toLowerCase();
      if (!da && db) return 1;
      if (da && !db) return -1;
      if (da !== db) return da.localeCompare(db);
      return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
    });
    const mt = Array(12).fill(0);
    const mp = Array(12).fill(0);
    let gt = 0;
    let gp = 0;
    for (const r of arr) {
      for (let i = 0; i < 12; i++) { mt[i] += r.months[i].total; mp[i] += r.months[i].paid; }
      gt += r.total;
      gp += r.paid;
    }
    return {
      rows: arr,
      grandTotal: gt,
      grandPaid: gp,
      monthTotals: mt,
      monthPaid: mp,
      years: Array.from(yearSet).sort((a, b) => b - a),
    };
  }, [scopedExpenses, year]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply search + re-derive footer totals from the visible subset so the
  // Total row reflects only what's currently on screen.
  const {
    visibleRows,
    visibleMonthTotals,
    visibleMonthPaid,
    visibleGrandTotal,
    visibleGrandPaid,
  } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.dept || "").toLowerCase().includes(q))
      : rows;
    const mt = Array(12).fill(0);
    const mp = Array(12).fill(0);
    let gt = 0;
    let gp = 0;
    for (const r of filtered) {
      for (let i = 0; i < 12; i++) { mt[i] += r.months[i].total; mp[i] += r.months[i].paid; }
      gt += r.total;
      gp += r.paid;
    }
    return {
      visibleRows: filtered,
      visibleMonthTotals: mt,
      visibleMonthPaid: mp,
      visibleGrandTotal: gt,
      visibleGrandPaid: gp,
    };
  }, [rows, search]);

  const isFirstOfDept = useMemo(() => {
    const flags = new Array(visibleRows.length).fill(false);
    let prev = null;
    for (let i = 0; i < visibleRows.length; i++) {
      if (visibleRows[i].dept !== prev) { flags[i] = true; prev = visibleRows[i].dept; }
    }
    return flags;
  }, [visibleRows]);

  function handleDownload() {
    const header = ["Employee", "Department", ...MONTHS_SHORT, "Total"];
    const dataRows = visibleRows.map((r) => [
      r.name,
      r.dept || "",
      ...r.months.map((m) => m.total || 0),
      r.total || 0,
    ]);
    const footer = ["Total", "", ...visibleMonthTotals.map((v) => v || 0), visibleGrandTotal || 0];
    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows, footer]);
    ws["!cols"] = [
      { wch: 24 }, { wch: 22 },
      ...MONTHS_SHORT.map(() => ({ wch: 11 })),
      { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Yearly ${year}`);
    XLSX.writeFile(wb, `yearly-expense-${year}.xlsx`);
  }

  return (
    <div className="space-y-4">
      {/* Header — matches the gradient style used across the Expense pages. */}
      <header className="relative overflow-hidden rounded-lg border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50 to-stone-50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">Summary Expense</h1>
            <p className="text-[11px] text-zinc-600">
              {isAdmin
                ? "Yearly per-employee expense matrix — rows grouped by department."
                : "Your yearly expense summary."}
            </p>
            <p className="mt-1 text-[10px] text-zinc-500 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Fully paid</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> Partially paid</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Not paid</span>
            </p>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Total {year}</div>
            <div className="text-sm font-bold text-orange-700">{nf(visibleGrandTotal)}</div>
            <div className="text-[10px] text-emerald-700">{nf(visibleGrandPaid)} paid</div>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or department…"
            className="w-full rounded-md border border-zinc-300 bg-white pl-2.5 pr-6 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Year</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-orange-500"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          type="button"
          onClick={handleDownload}
          disabled={visibleRows.length === 0}
          className="ml-auto rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          title="Download the current view as an Excel workbook"
        >
          ↓ Excel
        </button>
      </div>

      {/* Matrix */}
      <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          {isLoading ? (
            <p className="p-8 text-center text-sm text-zinc-500">Loading…</p>
          ) : visibleRows.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">
              {rows.length === 0
                ? `No expenses recorded in ${year}.`
                : `No employees match "${search}".`}
            </p>
          ) : (
            <table className="min-w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600 bg-zinc-100">
                  <th className="sticky top-0 left-0 z-40 bg-zinc-100 px-2 py-2 text-left border-b border-zinc-200">Employee</th>
                  <th className="sticky top-0 z-30 bg-zinc-100 px-2 py-2 text-left border-b border-zinc-200">Department</th>
                  {MONTHS_SHORT.map((m) => (
                    <th key={m} className="sticky top-0 z-30 bg-zinc-100 px-2 py-2 text-right whitespace-nowrap border-b border-zinc-200">{m}</th>
                  ))}
                  <th className="sticky top-0 z-30 bg-zinc-100 px-2 py-2 text-right whitespace-nowrap border-b border-zinc-200">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visibleRows.map((r, i) => (
                  <tr
                    key={r.userId}
                    className={`hover:bg-zinc-50/60 ${isFirstOfDept[i] && i > 0 ? "border-t-2 border-t-orange-100" : ""}`}
                  >
                    <td className="sticky left-0 z-10 bg-white px-2 py-2 font-medium text-zinc-900 whitespace-nowrap">
                      {r.name}
                    </td>
                    <td className="px-2 py-2 text-zinc-600 whitespace-nowrap">{r.dept || "—"}</td>
                    {r.months.map((cell, mi) => {
                      const cls = statusColor(cell.total, cell.paid);
                      const title = cell.total > 0 ? `Total ${nf(cell.total)} · Paid ${nf(cell.paid)}` : "";
                      return (
                        <td key={mi} className={`px-2 py-2 text-right tabular-nums font-medium ${cls}`} title={title}>
                          {cell.total > 0 ? nf(cell.total) : "—"}
                        </td>
                      );
                    })}
                    <td
                      className={`px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${statusColor(r.total, r.paid)}`}
                      title={`Total ${nf(r.total)} · Paid ${nf(r.paid)}`}
                    >
                      {nf(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-semibold">
                <tr className="bg-orange-50">
                  <td className="sticky bottom-0 left-0 z-30 bg-orange-50 px-2 py-2 whitespace-nowrap border-t border-orange-100">Total</td>
                  <td className="sticky bottom-0 z-20 bg-orange-50 px-2 py-2 border-t border-orange-100" />
                  {visibleMonthTotals.map((v, i) => {
                    const cls = statusColor(v, visibleMonthPaid[i]);
                    return (
                      <td key={i} className={`sticky bottom-0 z-20 bg-orange-50 px-2 py-2 text-right tabular-nums border-t border-orange-100 ${cls}`}>
                        {v > 0 ? nf(v) : "—"}
                      </td>
                    );
                  })}
                  <td className={`sticky bottom-0 z-20 bg-orange-50 px-2 py-2 text-right tabular-nums whitespace-nowrap border-t border-orange-100 ${statusColor(visibleGrandTotal, visibleGrandPaid)}`}>
                    {nf(visibleGrandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
