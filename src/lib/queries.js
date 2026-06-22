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
  const qc = useQueryClient();
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
    onSuccess: (data) => {
      auth.save(data);
      qc.setQueryData(qk.me, data.user);
      toast.success(`Account created — welcome, ${fullName(data.user)}`);
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

export function useEmployees(filters = {}) {
  return useQuery({
    queryKey: qk.employees(filters),
    queryFn: () => api.get("/api/employees", { params: filters }).then((r) => r.data),
    enabled: auth.isLoggedIn(),
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
    mutationFn: (id) =>
      api.patch(`/api/employees/${id}`, { is_active: false }).then((r) => r.data),
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
    mutationFn: ({ file, period_type, period_start, period_end, note }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("period_type", period_type || "weekly");
      if (period_start) fd.append("period_start", period_start);
      if (period_end) fd.append("period_end", period_end);
      if (note) fd.append("note", note);
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
    mutationFn: ({ date, mode, expense_type, travel_type, amount, remarks, bills }) => {
      const fd = new FormData();
      fd.append("date", date);
      fd.append("mode", mode || "");
      fd.append("expense_type", expense_type);
      if (travel_type) fd.append("travel_type", travel_type);
      fd.append("amount", String(amount));
      if (remarks) fd.append("remarks", remarks);
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
      const verb = row?.status === "approved" ? "Approved" : "Rejected";
      toast.success(`${verb}`);
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
