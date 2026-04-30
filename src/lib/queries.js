"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, auth } from "./api";

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
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return () => {
    auth.clear();
    qc.clear();
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
  return useQuery({
    queryKey: qk.reports(filters),
    queryFn: () => api.get("/api/reports", { params: filters }).then((r) => r.data),
    enabled: auth.isLoggedIn(),
  });
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
    mutationFn: ({ date, data }) =>
      api.post("/api/reports", { date, data }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/api/reports/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
