"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, auth } from "./api";
import { formatPretty, fullName } from "./data";

/* ---------- query keys ---------- */

export const qk = {
  me: ["me"],
  departments: ["departments"],
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
