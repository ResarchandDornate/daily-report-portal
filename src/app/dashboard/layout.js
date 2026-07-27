 "use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDepartments, useLogout, useMe } from "@/lib/queries";
import { fullName, todayISO } from "@/lib/data";
import { auth } from "@/lib/api";

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isOverview = pathname === "/dashboard";

  const { data: me, isLoading: meLoading, isError: meError } = useMe();
  const { data: departments = [] } = useDepartments();
  const logout = useLogout();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileNavOpen(false);
  }, [pathname]);

  // Bounce to /login if no token at all, or backend says we're 401
  useEffect(() => {
    if (!auth.isLoggedIn() || meError) router.push("/login");
  }, [meError, router]);

  // Route guard — non-HR users get bounced from HR-only pages back to /dashboard.
  // The only employee-accessible routes are /dashboard and /dashboard/my-report
  // (plus dept- and role-gated extras like Sales Sheets and Teams).
  // Named approver accounts (Tarini, Smita) are NOT HR but get extended
  // access — they can see All Employees, Employees Left, and the employee
  // profile pages so they can deactivate / reactivate as needed.  Matched
  // by the local part of the email so `tarini.aggrawal@…` resolves too.
  const isNamedApprover = (() => {
    if (!me) return false;
    const local = (me.email || "").toLowerCase().split("@")[0];
    return ["tarini", "smita"].some(
      (p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "_"),
    );
  })();
  // Tarini is review-only and doesn't file her own daily report — hide
  // the My Daily Report nav for her and bounce her if she navigates there
  // directly (her role is "hr", so the regular route guard below would
  // skip her).
  const isTarini = (() => {
    if (!me) return false;
    const local = (me.email || "").toLowerCase().split("@")[0];
    return local === "tarini" || local.startsWith("tarini.") || local.startsWith("tarini_");
  })();
  useEffect(() => {
    if (!me) return;
    if (isTarini && pathname === "/dashboard/my-report") {
      router.replace("/dashboard");
      return;
    }
    if (me.role === "hr") return;
    const employeePaths = [
      "/dashboard",
      "/dashboard/my-report",
      "/dashboard/expense",
      "/dashboard/expense/summary",
      "/dashboard/advance-approval",
    ];
    // Inside Sales, Sales Service, and Sales employees get one extra page for
    // their calling / customer-service sheets.
    if (["insideSales", "salesService", "sales"].includes(me.department?.slug)) {
      employeePaths.push("/dashboard/sales-uploads");
    }
    // Tarini / Smita (named approvers) can also visit the employee-roster
    // pages so they can deactivate someone after reviewing them.
    if (isNamedApprover) {
      employeePaths.push("/dashboard/employees");
      employeePaths.push("/dashboard/employees-left");
    }
    // Team heads can access the Teams pages.  /dashboard/teams/<empId>
    // is a dynamic route, so we check the prefix rather than an exact match.
    if (me.is_team_head && (pathname === "/dashboard/teams" || pathname.startsWith("/dashboard/teams/"))) {
      return;
    }
    // Employee profile pages (dynamic route) — let named approvers + team
    // heads peek without leaking them open to every employee.
    if (
      (isNamedApprover || me.is_team_head)
      && pathname.startsWith("/dashboard/employee/")
    ) {
      return;
    }
    const isAllowed = employeePaths.includes(pathname);
    if (!isAllowed) router.replace("/dashboard");
  }, [me, pathname, router, isNamedApprover]);

  if (meLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" />
      </div>
    );
  }

  // "Sales Sheets" is for Sales / Inside Sales / Sales Service employees +
  // HR only.  We can't gate it purely by role (since it's also for an
  // employee role), so we apply the dept check below when filtering the
  // visible nav.
  const NAV = [
    { href: "/dashboard", label: "Overview", icon: "home", roles: ["hr", "employee"] },
    { href: "/dashboard/my-report", label: "My Daily Report", icon: "doc", roles: ["hr", "employee"] },
    {
      label: "Expense",
      icon: "wallet",
      roles: ["hr", "employee"],
      children: [
        { href: "/dashboard/expense", label: "My Expenses" },
        { href: "/dashboard/expense/summary", label: "Summary Expense" },
        { href: "/dashboard/advance-approval", label: "Advance Approval" },
      ],
    },
    {
      href: "/dashboard/sales-uploads",
      label: "Sales Sheets",
      icon: "upload",
      roles: ["hr", "employee"],
      requiresDept: ["insideSales", "salesService", "sales"],
    },
    // Team head sidebar entry — only employees flagged with is_team_head see
    // this.  HR uses the existing department / All Employees views instead,
    // so we deliberately exclude them.
    {
      href: "/dashboard/teams",
      label: "Teams",
      icon: "users",
      roles: ["employee"],
      requiresTeamHead: true,
    },
    {
      href: "/dashboard/employees",
      label: "All Employees",
      icon: "users",
      roles: ["hr", "employee"],
      // Named approvers (Tarini / Smita) get this nav entry too even though
      // they're not HR — the `requiresApprover` flag is consumed below.
      requiresApprover: true,
    },
    {
      href: "/dashboard/employees-left",
      label: "Employees Left",
      icon: "userMinus",
      roles: ["hr", "employee"],
      requiresApprover: true,
    },
    { href: "/dashboard/reports", label: "All Reports", icon: "table", roles: ["hr"] },
    {
      label: "Departments",
      icon: "users",
      roles: ["hr"],
      children: departments.map((d) => ({
        href: `/dashboard/department/${d.slug}`,
        label: d.name,
        color: d.color,
      })),
    },
    { href: "/dashboard/summary", label: "Generate Summary", icon: "chart", roles: ["hr"] },
  ];

  const visibleNav = NAV.filter((n) => {
    if (!n.roles.includes(me.role)) return false;
    // HR always sees dept-gated items; non-HR only when their dept matches.
    if (n.requiresDept && me.role !== "hr") {
      const allowed = Array.isArray(n.requiresDept) ? n.requiresDept : [n.requiresDept];
      return allowed.includes(me.department?.slug);
    }
    // Team-head-gated items: hide unless me.is_team_head is true.
    if (n.requiresTeamHead && !me.is_team_head) return false;
    // Approver-gated items: HR always sees them; non-HR only when they're
    // a named approver (Tarini / Smita).
    if (n.requiresApprover && me.role !== "hr" && !isNamedApprover) return false;
    // Tarini doesn't file her own daily report — hide that link from her.
    if (isTarini && n.href === "/dashboard/my-report") return false;
    return true;
  });
  const meName = fullName(me);
  // Use the user's title when present — so an HR-role user with title "CEO"
  // shows as "CEO" instead of the generic "HR Manager".  Falls back to
  // "HR Manager" for HR users without a custom title.
  const subtitle =
    me.role === "hr"
      ? (me.title || "HR Manager")
      : `${me.department?.name || ""} • ${me.title || ""}`;

  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white lg:flex">
        <div className="flex h-14 items-center border-b border-zinc-200 px-4">
          <Image
            src="/ornateLogo.png"
            alt="Ornate Solar"
            width={120}
            height={32}
            priority
            className="h-8 w-auto"
            style={{ width: "auto" }}
          />
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Workspace
          </p>
          {visibleNav.map((item) =>
            item.children ? (
              <NavGroup key={item.label} item={item} pathname={pathname} />
            ) : (
              <NavLink key={item.href} item={item} active={pathname === item.href} />
            )
          )}
        </nav>

        <div className="border-t border-zinc-200 p-3">
          <div className="flex items-center gap-2.5 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
            <UserAvatar name={meName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-900">{meName}</p>
              <p className="truncate text-[10px] text-zinc-500">{subtitle}</p>
            </div>
            <button
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white hover:text-orange-600"
            >
              <LogoutIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-700 hover:bg-zinc-50 lg:hidden"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
            <Image
              src="/ornateLogo.png"
              alt="Ornate Solar"
              width={90}
              height={24}
              priority
              className="h-5 w-auto lg:hidden"
              style={{ width: "auto" }}
            />
            {/* Back button — every dashboard page except the root */}
            {pathname !== "/dashboard" && (
              <button
                onClick={() => router.back()}
                aria-label="Go back"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                <BackIcon className="h-3.5 w-3.5" />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isOverview && (
              <Suspense fallback={<DateFilterFallback />}>
                <DateFilterChip />
              </Suspense>
            )}
            <div className="hidden text-xs text-zinc-500 lg:block">
              {greeting()}
              <span className="ml-1 text-zinc-400">· {todayLabel()}</span>
            </div>
          </div>
        </header>

        {/* Mobile drawer */}
        {mobileNavOpen && (
          <>
            <div
              onClick={() => setMobileNavOpen(false)}
              className="fixed inset-0 z-40 bg-zinc-900/30 lg:hidden"
            />
            <aside className="fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-zinc-200 bg-white shadow-lg lg:hidden">
              <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-3">
                <Image src="/ornateLogo.png" alt="Ornate Solar" width={100} height={26} className="h-6 w-auto" style={{ width: "auto" }} />
                <button
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
                {visibleNav.map((item) =>
                  item.children ? (
                    <NavGroup key={item.label} item={item} pathname={pathname} />
                  ) : (
                    <NavLink key={item.href} item={item} active={pathname === item.href} />
                  )
                )}
              </nav>
            </aside>
          </>
        )}

        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}

/* ---------- Components ---------- */

// Date filter is isolated in its own component so that useSearchParams() — which
// bails the parent out of static prerendering — only affects this small subtree,
// which is wrapped in <Suspense> in the layout above.  Stored in the URL as
// ?date=YYYY-MM-DD so refreshes / shares preserve it.
function DateFilterChip() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedDate = searchParams.get("date") || todayISO();

  function setSelectedDate(d) {
    const params = new URLSearchParams(searchParams.toString());
    if (!d || d === todayISO()) params.delete("date");
    else params.set("date", d);
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  return (
    <label className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 shadow-sm hover:border-orange-300 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20">
      <CalendarIcon className="h-3.5 w-3.5 text-zinc-500" />
      <span className="font-medium text-zinc-500">Date</span>
      <input
        type="date"
        value={selectedDate}
        max={todayISO()}
        onChange={(e) => setSelectedDate(e.target.value)}
        className="bg-transparent text-[11px] font-medium text-zinc-900 outline-none"
      />
      {selectedDate !== todayISO() && (
        <button
          type="button"
          onClick={() => setSelectedDate(todayISO())}
          title="Reset to today"
          className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      )}
    </label>
  );
}

function DateFilterFallback() {
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 shadow-sm">
      <CalendarIcon className="h-3.5 w-3.5 text-zinc-500" />
      <span className="font-medium text-zinc-500">Date</span>
      <span className="text-[11px] font-medium text-zinc-400">—</span>
    </label>
  );
}

function NavLink({ item, active }) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
        active
          ? "bg-orange-50 text-orange-700"
          : "text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      <NavIcon name={item.icon} className={`h-4 w-4 ${active ? "text-orange-600" : "text-zinc-500"}`} />
      {item.label}
    </Link>
  );
}

function NavGroup({ item, pathname }) {
  const childActive = item.children.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
  const onSection =
    pathname.startsWith("/dashboard/department") || pathname.startsWith("/dashboard/employee");
  const [open, setOpen] = useState(childActive || onSection);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (childActive || onSection) setOpen(true);
  }, [childActive, onSection]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
          onSection ? "text-orange-700" : "text-zinc-700 hover:bg-zinc-100"
        }`}
        aria-expanded={open}
      >
        <NavIcon name={item.icon} className={`h-4 w-4 ${onSection ? "text-orange-600" : "text-zinc-500"}`} />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronIcon className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-0.5 ml-3.5 space-y-0.5 border-l border-zinc-200 pl-2">
          {item.children.map((child) => {
            const active = pathname === child.href || pathname.startsWith(`${child.href}/`);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={`flex items-center gap-2 rounded-md px-2 py-1 text-[12px] transition ${
                  active
                    ? "bg-orange-50 font-medium text-orange-700"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                <Dot color={child.color} />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserAvatar({ name }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-[10px] font-semibold text-white">
      {initials}
    </span>
  );
}

function Dot({ color }) {
  const map = {
    indigo: "bg-indigo-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    sky: "bg-sky-500",
  };
  return <span className={`h-1.5 w-1.5 rounded-full ${map[color] || "bg-zinc-400"}`} />;
}

function ChevronIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M5.5 7.5a1 1 0 0 1 1.4 0L10 10.6l3.1-3.1a1 1 0 1 1 1.4 1.4l-3.8 3.8a1 1 0 0 1-1.4 0L5.5 8.9a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function CalendarIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}

function MenuIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function BackIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M19 12H5" />
      <path d="M11 19l-7-7 7-7" />
    </svg>
  );
}

function LogoutIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function CloseIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function NavIcon({ name, className = "" }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
  };
  if (name === "home") return (<svg {...props}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
  if (name === "doc") return (<svg {...props}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>);
  if (name === "table") return (<svg {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 3v18" /></svg>);
  if (name === "chart") return (<svg {...props}><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-6" /></svg>);
  if (name === "users") return (<svg {...props}><circle cx="9" cy="8" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="17" cy="9" r="3" /><path d="M22 21v-1a3 3 0 0 0-3-3h-2" /></svg>);
  if (name === "upload") return (<svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>);
  if (name === "userMinus") return (<svg {...props}><circle cx="9" cy="8" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M17 11h6" /></svg>);
  if (name === "wallet") return (<svg {...props}><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M21 10h-4a2 2 0 0 0 0 4h4" /></svg>);
  return null;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel() {
  return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });
}
