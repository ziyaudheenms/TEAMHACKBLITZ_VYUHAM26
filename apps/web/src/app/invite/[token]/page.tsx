"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowRight, Building2, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { api, type InvitationPreview } from "../../../services/api";
import { ApiError } from "../../../services/http";
import { MintoLogo } from "../../../components/auth/MintoLogo";

type Phase = "loading" | "ready" | "invalid" | "done";

const inputClass =
  "w-full rounded-2xl border border-[#BEBEBE] bg-white px-4 py-2.5 text-sm text-[#262626] outline-none transition focus:border-[#75A0C9] focus:ring-2 focus:ring-[#75A0C9]/20";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [phase, setPhase] = useState<Phase>("loading");
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [chooseOwn, setChooseOwn] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; organisationName: string; usedOwnPassword: boolean; accountIsNew: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .previewInvitation(token)
      .then((p) => {
        if (cancelled) return;
        setInvite(p);
        setPhase("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(
          e instanceof ApiError && e.status === 0
            ? "We can't reach the server right now. Please try again in a moment."
            : "This invitation link is invalid or has expired. Ask your administrator for a new one."
        );
        setPhase("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (chooseOwn && password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.acceptInvitation(token, chooseOwn ? password : undefined);
      setResult(r);
      setPassword("");
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const loginHref = result ? `/login?email=${encodeURIComponent(result.email)}` : "/login";

  return (
    <div className="flex min-h-screen w-full flex-col bg-white text-[#262626] selection:bg-[#9DFF9B]">
      <header className="mx-auto w-full max-w-6xl px-6 pt-8 sm:px-10">
        <MintoLogo />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-6 py-10">
        <div className="w-full rounded-[36px] border border-[#DEDEDE] bg-[#EDEDED] p-7 shadow-[0_16px_50px_rgba(0,0,0,0.1)] animate-scale-in sm:p-9">
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-[#666666]" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-[#56BE51]" />
              Checking your invitation…
            </div>
          )}

          {phase === "invalid" && (
            <div className="space-y-4 text-center" role="alert">
              <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
              <h1 className="text-xl font-extrabold tracking-tight">Invitation unavailable</h1>
              <p className="text-sm text-[#666666]">{loadError}</p>
              <Link href="/login" className="inline-block text-sm font-bold underline decoration-dotted hover:text-[#1F541D]">
                Go to sign in
              </Link>
            </div>
          )}

          {phase === "ready" && invite && (
            <form onSubmit={accept} className="space-y-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#74D96F] shadow-[0_4px_14px_rgba(116,217,111,0.4)]">
                <Building2 className="h-5 w-5 text-[#262626]" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">Join {invite.organisationName}</h1>
                <p className="mt-1 text-sm text-[#666666]">
                  Hi {invite.firstName}, you've been invited as <strong className="capitalize">{invite.role}</strong>
                  {invite.designation ? ` · ${invite.designation}` : ""}.
                </p>
              </div>

              <dl className="space-y-1 rounded-2xl bg-white/70 p-4 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-[#9E9E9E]">Your account</dt>
                  <dd className="break-all font-semibold">{invite.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[#9E9E9E]">Link expires</dt>
                  <dd className="font-semibold">{new Date(invite.expiresAt).toLocaleDateString()}</dd>
                </div>
              </dl>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                  <AlertCircle className="mt-px h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {invite.accountIsNew ? (
                <div className="space-y-3">
                  <p className="text-xs text-[#666666]">
                    Your organisation has set a password for you. After activating, sign in with it.
                  </p>
                  <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-[#262626]">
                    <input
                      type="checkbox"
                      checked={chooseOwn}
                      onChange={(e) => setChooseOwn(e.target.checked)}
                      className="rounded border-[#BEBEBE] accent-[#56BE51]"
                    />
                    I'd rather choose my own password
                  </label>
                  {chooseOwn && (
                    <div className="relative animate-slide-down">
                      <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666666]" />
                      <label htmlFor="new-password" className="sr-only">
                        New password
                      </label>
                      <input
                        id="new-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className={`${inputClass} pl-10 pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-[#666666] hover:text-[#262626]"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#666666]">You already have an account. You'll keep using your current password.</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#262626] px-6 py-3.5 text-sm font-extrabold text-white transition hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Activating…" : "Accept invitation"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}

          {phase === "done" && result && (
            <div className="space-y-5 text-center animate-scale-in" role="status">
              <CheckCircle2 className="mx-auto h-10 w-10 text-[#56BE51]" />
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">You're in</h1>
                <p className="mt-1 text-sm text-[#666666]">
                  Your account for <strong>{result.organisationName}</strong> is active.
                </p>
              </div>
              <p className="rounded-2xl bg-white/70 p-4 text-xs text-[#262626]">
                Sign in as <strong className="break-all">{result.email}</strong> with{" "}
                {!result.accountIsNew
                  ? "your existing password."
                  : result.usedOwnPassword
                    ? "the password you just chose."
                    : "the password your organisation gave you."}
              </p>
              <Link
                href={loginHref}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#74D96F] px-6 py-3.5 text-sm font-extrabold text-[#262626] transition hover:bg-[#62CE5C]"
              >
                Continue to sign in <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
