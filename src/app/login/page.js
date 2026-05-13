"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FiEye,
  FiEyeOff,
  FiLock,
  FiMail,
  FiUser,
  FiPhone,
  FiArrowRight,
  FiBriefcase,
} from "react-icons/fi";
import Image from "next/image";
import { useDepartments, useLogin, useSignup } from "@/lib/queries";

export default function LoginPage() {
  const router = useRouter();

  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const loginMutation = useLogin();
  const signupMutation = useSignup();
  const loading = loginMutation.isPending || signupMutation.isPending;
  const { data: departments = [] } = useDepartments();

  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [signupData, setSignupData] = useState({
    email: "",
    username: "",
    firstName: "",
    lastName: "",
    contactNumber: "",
    department: "",
    password: "",
    confirmPassword: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (isSignup) {
      if (
        !signupData.email ||
        !signupData.username ||
        !signupData.firstName ||
        !signupData.lastName ||
        !signupData.department ||
        !signupData.password ||
        !signupData.confirmPassword
      ) {
        setErrorMsg("Please fill all required fields");
        return;
      }
      if (signupData.password !== signupData.confirmPassword) {
        setErrorMsg("Passwords do not match");
        return;
      }
      try {
        await signupMutation.mutateAsync(signupData);
        router.push("/dashboard");
      } catch {
        // Server-side error already surfaced as a toast via the mutation.
      }
      return;
    }

    if (!loginData.email || !loginData.password) {
      setErrorMsg("Please fill in all fields");
      return;
    }
    try {
      await loginMutation.mutateAsync(loginData);
      router.push("/dashboard");
    } catch {
      // Server-side error already surfaced as a toast via the mutation.
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-linear-to-br from-yellow-100 via-orange-50 to-pink-50">
      {/* Background decorations — span the whole page */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-32 h-112 w-md rounded-full bg-orange-300/40 blur-3xl animate-pulse-soft" />
        <div className="absolute -bottom-40 -right-32 h-128 w-lg rounded-full bg-amber-300/40 blur-3xl animate-pulse-soft [animation-delay:2s]" />
        <div className="absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-200/30 blur-3xl animate-pulse-soft [animation-delay:4s]" />
        <div className="absolute inset-0 bg-dot-pattern opacity-30" />
      </div>

      <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 p-5 lg:flex-row lg:items-center lg:justify-center lg:gap-12 lg:p-10">
        {/* LEFT — branding text */}
        <div className="w-full max-w-xs space-y-2 text-center lg:max-w-sm lg:text-left">

          <div  className="text-center  ml-8  mb-7">
          <Image
            src="/ornateLogo.png"
            alt="Ornate Solar Logo"
            width={120}
            height={36}
            className="mx-auto h-9 w-auto lg:mx-0"
            style={{ width: "auto" }}
            priority
          />
          </div>

          <span className="inline-flex items-center gap-1 text-[18px] font-semibold uppercase tracking-wider text-orange-700">
            <span className="h-1 w-1 rounded-full bg-emerald-500" />
            Daily Report Portal
          </span>

          <h2 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Track work{" "}
            <span className="text-brand-gradient text-4xl">Stay aligned.</span>
          </h2>

          <p className="mx-auto max-w-xs text-sm text-zinc-600 leading-relaxed lg:mx-0">
            Submit daily updates, track team activity, and share weekly or
            monthly summaries with leadership.
          </p>
        </div>

        {/* RIGHT — login / signup form */}
        <div className="w-full max-w-sm">
            <div className="group relative overflow-hidden rounded-xl border border-orange-100 bg-white/95 shadow-lift backdrop-blur-sm transition hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-18px_rgba(234,88,12,0.32)]">
              {/* Animated gradient strip */}
              <div className="h-0.5 bg-shine" />
              {/* Inner glow */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-px h-24 bg-linear-to-b from-orange-100/60 to-transparent"
              />

              <div className="relative px-5 py-5 lg:px-6 lg:py-6">
                <div className="mb-4 text-center">
                  <h2 className="text-base font-bold tracking-tight text-zinc-900">
                    {isSignup ? (
                      <>Create your <span className="text-brand-gradient">account</span></>
                    ) : (
                      <>Welcome <span className="text-brand-gradient">back</span></>
                    )}
                  </h2>
                 
                </div>

                {errorMsg && (
                  <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                    {errorMsg}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                  {isSignup && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="First name" icon={FiUser}>
                        <input
                          type="text"
                          value={signupData.firstName}
                          onChange={(e) =>
                            setSignupData({ ...signupData, firstName: e.target.value })
                          }
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Last name" icon={FiUser}>
                        <input
                          type="text"
                          value={signupData.lastName}
                          onChange={(e) =>
                            setSignupData({ ...signupData, lastName: e.target.value })
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  )}

                  <Field label="Email" icon={FiMail}>
                    <input
                      type="email"
                      value={isSignup ? signupData.email : loginData.email}
                      onChange={(e) =>
                        isSignup
                          ? setSignupData({ ...signupData, email: e.target.value })
                          : setLoginData({ ...loginData, email: e.target.value })
                      }
                      placeholder="you@ornatesolar.com"
                      className={inputClass}
                    />
                  </Field>

                  {isSignup && (
                    <Field label="Username" icon={FiUser}>
                      <input
                        type="text"
                        value={signupData.username}
                        onChange={(e) =>
                          setSignupData({ ...signupData, username: e.target.value })
                        }
                        className={inputClass}
                      />
                    </Field>
                  )}

                  {isSignup && (
                    <Field label="Contact number" icon={FiPhone}>
                      <input
                        type="tel"
                        value={signupData.contactNumber}
                        onChange={(e) =>
                          setSignupData({
                            ...signupData,
                            contactNumber: e.target.value,
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                  )}

                  {isSignup && (
                    <Field label="Department" icon={FiBriefcase}>
                      <select
                        value={signupData.department}
                        onChange={(e) =>
                          setSignupData({ ...signupData, department: e.target.value })
                        }
                        className={`${inputClass} appearance-none cursor-pointer`}
                      >
                        <option value="">Select your department</option>
                        {departments.map((d) => (
                          <option key={d.slug} value={d.slug}>{d.name}</option>
                        ))}
                      </select>
                    </Field>
                  )}

                  <Field label="Password" icon={FiLock}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={isSignup ? signupData.password : loginData.password}
                      onChange={(e) =>
                        isSignup
                          ? setSignupData({ ...signupData, password: e.target.value })
                          : setLoginData({ ...loginData, password: e.target.value })
                      }
                      placeholder="Enter your password"
                      className={`${inputClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition hover:text-orange-600"
                    >
                      {showPassword ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                    </button>
                  </Field>

                  {isSignup && (
                    <Field label="Confirm password" icon={FiLock}>
                      <input
                        type="password"
                        value={signupData.confirmPassword}
                        onChange={(e) =>
                          setSignupData({
                            ...signupData,
                            confirmPassword: e.target.value,
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-brand-button group/btn relative mt-1.5 inline-flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-md px-3 py-2 text-xs font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover/btn:translate-x-full"
                    />
                    {loading ? (
                      <>
                        <Spinner className="h-3 w-3" />
                        Processing…
                      </>
                    ) : (
                      <>
                        {isSignup ? "Create account" : "Login"}
                        <FiArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Card footer */}
              <div className="border-t border-zinc-100 bg-stone-50/60 px-5 py-2.5 text-center">
                <p className="text-[11px] text-zinc-600">
                  {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg("");
                      setIsSignup(!isSignup);
                    }}
                    className="font-semibold text-orange-700 hover:text-orange-800"
                  >
                    {isSignup ? "Login" : "Create account"}
                  </button>
                </p>
              </div>
            </div>

          
          </div>
        </div>
      </div>
  );
}

/* ---------- bits ---------- */

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-[11px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

function Field({ label, icon: Icon, children }) {
  return (
    <div className="group">
      <label className="mb-0.5 block text-[11px] font-medium text-zinc-700">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400 transition group-focus-within:text-orange-600" />
        {children}
      </div>
    </div>
  );
}

function Spinner({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
