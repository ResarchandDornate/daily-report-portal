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

let _refreshPromise = null;

async function _tryRefresh() {
  const refreshToken = typeof window !== "undefined"
    ? localStorage.getItem(REFRESH_KEY) : null;
  if (!refreshToken) return false;
  try {
    const res = await axios.post(
      `${BASE}/api/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" } },
    );
    auth.save(res.data);
    return true;
  } catch {
    return false;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail;
    if (detail) {
      err.message = typeof detail === "string" ? detail : JSON.stringify(detail);
    }

    if (status === 401) {
      const isLoginEndpoint = (err.config?.url || "").includes("/api/auth/login");
      const isRefreshEndpoint = (err.config?.url || "").includes("/api/auth/refresh");
      const alreadyRetried = err.config?._retry;

      if (!isLoginEndpoint && !isRefreshEndpoint && !alreadyRetried) {
        // Deduplicate concurrent refresh attempts.
        if (!_refreshPromise) {
          _refreshPromise = _tryRefresh().finally(() => { _refreshPromise = null; });
        }
        const refreshed = await _refreshPromise;
        if (refreshed) {
          // Retry the original request with the new token.
          err.config._retry = true;
          err.config.headers.Authorization = `Bearer ${auth.getToken()}`;
          return api(err.config);
        }
      }

      // Refresh failed (or this was a login/refresh call) — log out.
      auth.clear();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth:logout"));
      }
      if (!isLoginEndpoint) {
        toast.error("Session expired. Please log in again.");
      }
    } else if (!err.response) {
      toast.error("Can't reach the server. Check your connection.");
    } else if (status >= 500) {
      toast.error(`Server error (${status}). Please try again.`);
    }

    return Promise.reject(err);
  },
);
