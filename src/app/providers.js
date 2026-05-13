"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

export function Providers({ children }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {/*
        Global toast renderer.  Imperative API: any component or hook can call
        toast.success("...") / toast.error("...") / toast("...") and a small
        animated rectangle pops up in the corner for ~3 seconds.
      */}
      <Toaster
        position="top-right"
        richColors
        duration={2000}
        toastOptions={{
          style: {
            fontFamily: "var(--font-geist-sans)",
            fontSize: "12px",
            padding: "8px 12px",
            minHeight: "auto",
            width: "auto",
            minWidth: "180px",
            maxWidth: "320px",
          },
        }}
      />
    </QueryClientProvider>
  );
}
