"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, auth } from "./api";
import { formatPretty, fullName } from "./data";

/* ---------- query keys ---------- */

export const qk = {
  me: ["me"],
  departments: ["departments"],
  organisations: ["organisations"],
  employees: (filters) => ["employees", filters || {}],
  employee: (id) => ["employee", id],
  reports: (filters) => ["reports", filters || {}],
  missingToday: ["reports", "missing-today"],
};

/* ---------- auth ---------- */

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }) =>
      api.post("/api/auth/login", { email, password }).then((r) => r.data),
    onSuccess: (data) => {
      auth.save(data);
      qc.setQueryData(qk.me, data.user);
      toast.success(`Welcome back, ${fullName(data.user)}`);
    },
    onError: (err) => {
      toast.error(err.message || "Login failed");
    },
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: (form) =>
      api
        .post("/api/auth/signup", {
          email: form.email,
          username: form.username,
          password: form.password,
          first_name: form.firstName,
          last_name: form.lastName,
          contact_number: form.contactNumber || "",
          department: form.department || null,
        })
        .then((r) => r.data),
    // New accounts start inactive — no tokens are issued, and an HR admin
    // must activate the account (Employees page) before it can log in.
    // Don't save auth state or route into the dashboard here.
    onSuccess: (data) => {
      toast.success(data?.message || "Account created — an HR admin needs to activate it before you can log in.");
    },
    onError: (err) => {
      toast.error(err.message || "Signup failed");
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return () => {
    auth.clear();
    qc.clear();
    toast.success("Signed out");
  };
}

/* ---------- queries ---------- */

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get("/api/me").then((r) => r.data),
    enabled: auth.isLoggedIn(),
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: qk.departments,
    queryFn: () => api.get("/api/departments").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useOrganisations() {
  return useQuery({
    queryKey: qk.organisations,
    queryFn: () => api.get("/api/organisations").then((r) => r.data),
    enabled: auth.isLoggedIn(),
    staleTime: 5 * 60_000,
  });
}

export function useEmployees(filters = {}, { enabled = true } = {}) {
  return useQuery({
    queryKey: qk.employees(filters),
    queryFn: () => api.get("/api/employees", { params: filters }).then((r) => r.data),
    enabled: auth.isLoggedIn() && enabled,
  });
}

export function useEmployee(id) {
  return useQuery({
    queryKey: qk.employee(id),
    queryFn: () => api.get(`/api/employees/${id}`).then((r) => r.data),
    enabled: auth.isLoggedIn() && !!id,
  });
}

export function useReports(filters = {}) {
  const query = useQuery({
    queryKey: qk.reports(filters),
    queryFn: () => api.get("/api/reports", { params: filters }).then((r) => r.data),
    enabled: auth.isLoggedIn(),
    placeholderData: (prev) => prev,
    // Auto-refresh every 30s so an HR user watching the dashboard sees new
    // submissions land within half a minute, without manually refreshing.
    // Also refetches on window-focus (TanStack's default).
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  // Backend returns `{ items, total, limit, offset }`. Unwrap items as `data`
  // so existing consumers iterating the array keep working; expose pagination
  // metadata on the return value for pages that need it.
  return {
    ...query,
    data: query.data?.items,
    total: query.data?.total ?? 0,
    limit: query.data?.limit ?? 0,
    offset: query.data?.offset ?? 0,
  };
}

export function useMissingToday() {
  return useQuery({
    queryKey: qk.missingToday,
    queryFn: () => api.get("/api/reports/missing-today").then((r) => r.data),
    enabled: auth.isLoggedIn(),
  });
}

/* ---------- mutations ---------- */

export function useSubmitReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, data, user_id }) =>
      api
        .post("/api/reports", { date, data, ...(user_id !== undefined && { user_id }) })
        .then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(`Report saved for ${formatPretty(data.date)}`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save report");
    },
  });
}

/* ---------- HR admin: department + employee CRUD ---------- */

function _invalidateRoster(qc) {
  qc.invalidateQueries({ queryKey: ["employees"] });
  qc.invalidateQueries({ queryKey: ["departments"] });
}

function _invalidateOrgs(qc) {
  qc.invalidateQueries({ queryKey: ["organisations"] });
  qc.invalidateQueries({ queryKey: ["employees"] });
}

export function useCreateOrganisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post("/api/organisations", payload).then((r) => r.data),
    onSuccess: (o) => {
      _invalidateOrgs(qc);
      toast.success(`Organisation "${o.name}" created`);
    },
    onError: (err) => toast.error(err.message || "Failed to create organisation"),
  });
}

export function useUpdateOrganisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }) =>
      api.patch(`/api/organisations/${id}`, patch).then((r) => r.data),
    onSuccess: (o) => {
      _invalidateOrgs(qc);
      toast.success(`Organisation "${o.name}" updated`);
    },
    onError: (err) => toast.error(err.message || "Failed to update organisation"),
  });
}

export function useDeleteOrganisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/organisations/${id}`),
    onSuccess: () => {
      _invalidateOrgs(qc);
      toast.success("Organisation deleted");
    },
    onError: (err) => toast.error(err.message || "Failed to delete organisation"),
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post("/api/departments", payload).then((r) => r.data),
    onSuccess: (d) => {
      _invalidateRoster(qc);
      toast.success(`Department "${d.name}" created`);
    },
    onError: (err) => toast.error(err.message || "Failed to create department"),
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, ...patch }) =>
      api.patch(`/api/departments/${slug}`, patch).then((r) => r.data),
    onSuccess: (d) => {
      _invalidateRoster(qc);
      toast.success(`Department "${d.name}" updated`);
    },
    onError: (err) => toast.error(err.message || "Failed to update department"),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug) => api.delete(`/api/departments/${slug}`),
    onSuccess: (_, slug) => {
      _invalidateRoster(qc);
      toast.success(`Department "${slug}" deleted`);
    },
    onError: (err) => toast.error(err.message || "Failed to delete department"),
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      api.post("/api/employees", payload).then((r) => r.data),
    onSuccess: (u) => {
      _invalidateRoster(qc);
      toast.success(`Employee "${fullName(u)}" created`);
    },
    onError: (err) => toast.error(err.message || "Failed to create employee"),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }) =>
      api.patch(`/api/employees/${id}`, patch).then((r) => r.data),
    onSuccess: (u) => {
      _invalidateRoster(qc);
      qc.invalidateQueries({ queryKey: ["employee", u.id] });
      toast.success(`Employee "${fullName(u)}" updated`);
    },
    onError: (err) => toast.error(err.message || "Failed to update employee"),
  });
}

export function useDeactivateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    // Accepts either a plain `id` (legacy callers) or an object
    // `{ id, date_of_leaving }` to record when the employee's tenure ended.
    mutationFn: (arg) => {
      const id = typeof arg === "object" && arg !== null ? arg.id : arg;
      const body = { is_active: false };
      if (typeof arg === "object" && arg !== null && arg.date_of_leaving) {
        body.date_of_leaving = arg.date_of_leaving;
      }
      return api.patch(`/api/employees/${id}`, body).then((r) => r.data);
    },
    onSuccess: (u) => {
      _invalidateRoster(qc);
      toast.success(`Employee "${fullName(u)}" deactivated`);
    },
    onError: (err) => toast.error(err.message || "Failed to deactivate employee"),
  });
}

export function useReactivateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      api.patch(`/api/employees/${id}`, { is_active: true }).then((r) => r.data),
    onSuccess: (u) => {
      _invalidateRoster(qc);
      toast.success(`Employee "${fullName(u)}" reactivated`);
    },
    onError: (err) => toast.error(err.message || "Failed to reactivate employee"),
  });
}

/* ---------- Sales uploads (Inside Sales weekly/monthly Excel) ---------- */

export const qkSalesUploads = ["sales-uploads"];

export function useSalesUploads() {
  return useQuery({
    queryKey: qkSalesUploads,
    queryFn: () => api.get("/api/sales-uploads").then((r) => r.data),
    enabled: auth.isLoggedIn(),
  });
}

export function useUploadSalesSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, period_type, period_start, period_end, note, on_behalf_of }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("period_type", period_type || "weekly");
      if (period_start) fd.append("period_start", period_start);
      if (period_end) fd.append("period_end", period_end);
      if (note) fd.append("note", note);
      if (on_behalf_of) fd.append("on_behalf_of", String(on_behalf_of));
      return api
        .post("/api/sales-uploads", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkSalesUploads });
      toast.success("Sheet uploaded");
    },
    onError: (err) => toast.error(err.message || "Failed to upload sheet"),
  });
}

export function useDownloadSalesSheet() {
  return useMutation({
    mutationFn: async ({ id, filename }) => {
      // Stream the file bytes back as a Blob, then trigger a browser-side
      // download with the original filename so the URL stays clean
      // (`/api/sales-uploads/{id}/download`) instead of a long presigned URL.
      const response = await api.get(`/api/sales-uploads/${id}/download`, {
        responseType: "blob",
      });
      const blob = response.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `sales-sheet-${id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (err) => toast.error(err.message || "Failed to download file"),
  });
}

export function useDeleteSalesSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/sales-uploads/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkSalesUploads });
      toast.success("Sheet deleted");
    },
    onError: (err) => toast.error(err.message || "Failed to delete sheet"),
  });
}

export function useApplyLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ start_date, days, reason, user_id }) =>
      api
        .post("/api/reports/leave", {
          start_date,
          days,
          reason,
          ...(user_id !== undefined && { user_id }),
        })
        .then((r) => r.data),
    onSuccess: (rows) => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      const n = Array.isArray(rows) ? rows.length : 0;
      toast.success(`Leave applied — ${n} ${n === 1 ? "day" : "days"} marked`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to apply leave");
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/reports/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Report deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete report");
    },
  });
}

// ---- Expense claims ----

const qkExpenses = ["expenses"];

export function useExpenses() {
  return useQuery({
    queryKey: qkExpenses,
    queryFn: () => api.get("/api/expenses").then((r) => r.data),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, mode, expense_type, travel_type, amount, advance, site_name, remarks, bills, on_behalf_of }) => {
      const fd = new FormData();
      fd.append("date", date);
      fd.append("mode", mode || "");
      fd.append("expense_type", expense_type);
      if (travel_type) fd.append("travel_type", travel_type);
      fd.append("amount", String(amount));
      fd.append("advance", String(advance || 0));
      if (site_name) fd.append("site_name", site_name);
      if (remarks) fd.append("remarks", remarks);
      // Delegate filing on behalf of another employee (server authorizes).
      if (on_behalf_of) fd.append("on_behalf_of", String(on_behalf_of));
      // Multi-file: append once per file under the same field name so the
      // FastAPI endpoint receives them as `bills: list[UploadFile]`.
      for (const f of (bills || [])) {
        if (f) fd.append("bills", f);
      }
      return api
        .post("/api/expenses", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Expense submitted — awaiting approval");
    },
    onError: (err) => toast.error(err.message || "Failed to submit expense"),
  });
}

export function useDecideExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }) =>
      api
        .post(`/api/expenses/${id}/decide`, { decision, note: note || "" })
        .then((r) => r.data),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      const label =
        row?.status === "approved" ? "Approved"
        : row?.status === "rejected" ? "Rejected"
        : row?.status === "onhold" ? "On Hold"
        : "Updated";
      toast.success(label);
    },
    onError: (err) => toast.error(err.message || "Failed to decide expense"),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Expense deleted");
    },
    onError: (err) => toast.error(err.message || "Failed to delete expense"),
  });
}

// Delegate scope — which employees (if any) the current user may file
// expenses for.  The server returns {department:null, employees:[]} for
// everyone except configured delegates (e.g. Reception filing for Sales),
// so the form can call this unconditionally to decide whether to show
// the "Filing for" picker.
export function useExpenseDelegateScope() {
  return useQuery({
    queryKey: ["expenseDelegateScope"],
    queryFn: () => api.get("/api/expenses/delegate/employees").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }) =>
      api.patch(`/api/expenses/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Expense updated");
    },
    onError: (err) => toast.error(err.message || "Failed to update expense"),
  });
}

// Append new bill files to an existing pending/onhold expense.
export function useAddExpenseBills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, files }) => {
      const fd = new FormData();
      for (const f of (files || [])) {
        if (f) fd.append("bills", f);
      }
      return api
        .post(`/api/expenses/${id}/bills`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Bill(s) added");
    },
    onError: (err) => toast.error(err.message || "Failed to add bills"),
  });
}

// Finance approver (Shivangi) marks an approved expense as paid.  Server
// enforces both the role gate and the "must be currently approved" check.
export function useMarkPaidExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paid_date, payment_ref }) =>
      api.post(`/api/expenses/${id}/mark-paid`, { paid_date, payment_ref }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Marked as paid");
    },
    onError: (err) => toast.error(err.message || "Failed to mark paid"),
  });
}

// HR issues an advance to an employee — creates an approved expense record.
export function useIssueAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employee_id, amount, date, note, approved_by, paid_date, paid_amount }) =>
      api.post("/api/expenses/advance-issue", {
        employee_id,
        amount,
        date: date || null,
        note: note || null,
        approved_by: approved_by || null,
        paid_date: paid_date || null,
        paid_amount: paid_amount === "" || paid_amount == null ? null : paid_amount,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Advance recorded");
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || "Failed to record advance"),
  });
}

// Employee self-records a received advance (creates a pending advance entry for themselves).
export function useRecordAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ amount, date, note }) =>
      api.post("/api/expenses/record-advance", { amount, date: date || null, note: note || null })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Advance recorded");
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || "Failed to record advance"),
  });
}

// Remove one attached bill by its position in the expense's bills list.
export function useDeleteExpenseBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, index }) =>
      api.delete(`/api/expenses/${id}/bill/${index}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkExpenses });
      toast.success("Bill removed");
    },
    onError: (err) => toast.error(err.message || "Failed to remove bill"),
  });
}

// ── Advance Requests ──────────────────────────────────────────────────────────
const qkAdvanceRequests = ["advance-requests"];

export function useAdvanceRequests() {
  return useQuery({
    queryKey: qkAdvanceRequests,
    queryFn: () => api.get("/api/advance-requests").then((r) => r.data),
  });
}

export function useCreateAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post("/api/advance-requests", body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkAdvanceRequests });
      toast.success("Advance request submitted");
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || "Failed to submit"),
  });
}

export function useDecideAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }) =>
      api.post(`/api/advance-requests/${id}/decide`, { action, note }).then((r) => r.data),
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: qkAdvanceRequests });
      toast.success(action === "approve" ? "Request approved" : "Request rejected");
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || "Failed to decide"),
  });
}

export function useUpdateAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      api.patch(`/api/advance-requests/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkAdvanceRequests });
      toast.success("Request updated");
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || "Failed to update"),
  });
}

export function useDeleteAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/advance-requests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkAdvanceRequests });
      toast.success("Request withdrawn");
    },
    onError: (err) => toast.error(err.message || "Failed to delete"),
  });
}
