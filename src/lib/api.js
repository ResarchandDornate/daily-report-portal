"use client";

import axios from "axios";
import { toast } from "sonner";

/**
 * axios instance for the FastAPI backend.
 *
 *   import { api, auth } from "@/lib/api";
 *   const { data } = await api.get("/api/me");
 *
 * Request interceptor attaches Bearer token from localStorage.
 * Response interceptor clears token + emits "auth:logout" on 401.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

const TOKEN_KEY = "accessToken";
const REFRESH_KEY = "refreshToken";
const USER_KEY = "currentUser";

export const auth = {
  getToken: () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  getUser: () => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  save: ({ access_token, refresh_token, user }) => {
    localStorage.setItem(TOKEN_KEY, access_token);
    localStorage.setItem(REFRESH_KEY, refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
  isLoggedIn: () => !!auth.getToken(),
};

export const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = auth.getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail;
    if (detail) {
      err.message = typeof detail === "string" ? detail : JSON.stringify(detail);
    }

    if (status === 401) {
      auth.clear();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth:logout"));
      }
      // Show a toast unless the failing request was a login attempt — the
      // login mutation has its own toast and we'd otherwise show two at once.
      const isLoginEndpoint = (err.config?.url || "").includes("/api/auth/login");
      if (!isLoginEndpoint) {
        toast.error("Session expired. Please log in again.");
      }
    } else if (!err.response) {
      // No HTTP response at all — network down, server unreachable, CORS, etc.
      toast.error("Can't reach the server. Check your connection.");
    } else if (status >= 500) {
      toast.error(`Server error (${status}). Please try again.`);
    }
    // 4xx errors (other than 401) are surfaced via the mutation's onError so
    // the user sees the specific field-level message — not a generic toast.

    return Promise.reject(err);
  },
);
