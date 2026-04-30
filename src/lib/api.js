"use client";

import axios from "axios";

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
    if (err.response?.status === 401) {
      auth.clear();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth:logout"));
      }
    }
    const detail = err.response?.data?.detail;
    if (detail) {
      err.message = typeof detail === "string" ? detail : JSON.stringify(detail);
    }
    return Promise.reject(err);
  },
);
