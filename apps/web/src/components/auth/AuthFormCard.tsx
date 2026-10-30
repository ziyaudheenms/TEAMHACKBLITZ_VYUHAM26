"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, User, ArrowRight, Eye, EyeOff, AlertCircle, Loader2, X } from "lucide-react";
import { api } from "../../services/api";

interface AuthFormCardProps {
  initialMode?: "login" | "register";
  className?: string;
  onClose?: () => void;
}

const inputClass =
  "w-full pl-10 pr-4 py-2.5 bg-white border border-[#BEBEBE] focus:border-[#75A0C9] focus:ring-2 focus:ring-[#75A0C9]/20 rounded-2xl text-sm text-[#262626] placeholder-[#9E9E9E] outline-none transition";

export const AuthFormCard: React.FC<AuthFormCardProps> = ({
  initialMode = "login",
  className = "",
  onClose,
}) => {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    rememberMe: true,
  });

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Arriving from an invitation: /login?email=… pre-fills the address.
  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get("email");
    if (email) setForm((prev) => (prev.email ? prev : { ...prev, email }));
  }, []);

  const isRegister = mode === "register";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isRegister && form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    try {
      if (isRegister) {
        await api.signup({
          email: form.email.trim(),
          password: form.password,
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
        });
      } else {
        await api.login(form.email.trim(), form.password, form.rememberMe);
      }

      onClose?.();
      const from = new URLSearchParams(window.location.search).get("from");
      // Hard navigation so the middleware sees the freshly set auth cookie.
      window.location.assign(from && from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`relative w-full rounded-[36px] bg-[#EDEDED] border border-[#DEDEDE] p-6 sm:p-8 md:p-10 shadow-[0_16px_50px_rgba(0,0,0,0.1)] ${className}`}
    >
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#262626] tracking-tight">
            {isRegister ? "Create your account" : "Welcome back"}
          </h2>
          <p className="text-xs text-[#666666] mt-1">
            {isRegister
              ? "Start using your organisation's second brain."
              : "Sign in to continue to your workspace."}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full text-[#666666] hover:text-[#262626] hover:bg-[#E2E2E2] transition sm:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 p-3 rounded-2xl text-xs font-medium border bg-rose-50 border-rose-200 text-rose-700 flex items-start space-x-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {isRegister && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="block text-[11px] font-bold text-[#262626] uppercase tracking-wider mb-1">
                First name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#666666] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="firstName"
                  name="firstName"
                  autoComplete="given-name"
                  required
                  value={form.firstName}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="lastName" className="block text-[11px] font-bold text-[#262626] uppercase tracking-wider mb-1">
                Last name
              </label>
              <input
                id="lastName"
                name="lastName"
                autoComplete="family-name"
                value={form.lastName}
                onChange={handleChange}
                className={inputClass.replace("pl-10", "pl-4")}
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-[11px] font-bold text-[#262626] uppercase tracking-wider mb-1">
            Email
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-[#666666] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={handleChange}
              placeholder="you@company.com"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="block text-[11px] font-bold text-[#262626] uppercase tracking-wider mb-1">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-[#666666] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={isRegister ? 8 : undefined}
              value={form.password}
              onChange={handleChange}
              placeholder={isRegister ? "At least 8 characters" : "Your password"}
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#666666] hover:text-[#262626] p-1 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {!isRegister && (
          <label className="flex items-center space-x-2 text-xs text-[#666666] cursor-pointer select-none">
            <input
              type="checkbox"
              name="rememberMe"
              checked={form.rememberMe}
              onChange={handleChange}
              className="rounded border-[#BEBEBE] accent-[#56BE51]"
            />
            <span>Keep me signed in for 30 days</span>
          </label>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-[#262626] hover:bg-[#1a1a1a] disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-full transition-all shadow-sm active:translate-y-0.5 flex items-center justify-center space-x-2 cursor-pointer"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{isRegister ? "Creating account..." : "Signing in..."}</span>
            </>
          ) : (
            <>
              <span className="text-sm font-extrabold tracking-tight">
                {isRegister ? "Create account" : "Sign in"}
              </span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <p className="text-center text-xs text-[#666666] mt-5">
        {isRegister ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          onClick={() => switchMode(isRegister ? "login" : "register")}
          className="font-bold text-[#262626] underline decoration-dotted hover:text-[#1F541D] cursor-pointer"
        >
          {isRegister ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
};
