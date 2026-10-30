"use client";

import React, { useState, useEffect } from "react";
import { api, ApiStatus } from "../../services/api";
import { Wifi, WifiOff, RefreshCw, Server, X, CheckCircle2, AlertCircle } from "lucide-react";

interface ApiStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApiStatusModal: React.FC<ApiStatusModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<ApiStatus>({
    isLive: false,
    endpoint: api.getBaseUrl(),
    lastChecked: "",
  });
  const [endpointInput, setEndpointInput] = useState(api.getBaseUrl());
  const [isChecking, setIsChecking] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const unsubscribe = api.subscribeStatus((newStatus) => {
      setStatus(newStatus);
      setEndpointInput(newStatus.endpoint);
    });
    return () => unsubscribe();
  }, []);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    const url = endpointInput.trim();
    if (!url) {
      setTestResult({ ok: false, message: "Enter the API base URL first." });
      return;
    }
    if (isChecking) return;
    setIsChecking(true);
    setTestResult(null);
    try {
      api.setBaseUrl(url);
      const isLive = await api.checkApiHealth();
      setTestResult(
        isLive
          ? { ok: true, message: "Connected to the API." }
          : {
              ok: false,
              message: "Could not reach the API at this address. Check the URL and that the server is running.",
            }
      );
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error && err.message ? err.message : "Connection test failed." });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="API connection"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 animate-in fade-in"
    >
      <div className="w-full max-w-lg rounded-3xl border border-[#DEDEDE] bg-[#EDEDED] p-6 sm:p-8 shadow-2xl text-[#262626]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#D6D6D6]">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-2xl ${status.isLive ? "bg-[#74D96F]/20 text-[#1F541D]" : "bg-[#F09363]/20 text-[#843209]"}`}>
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#262626] tracking-tight">API connection</h3>
              <p className="text-xs text-[#666666]">Where the app sends its requests</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-white border border-[#BEBEBE] text-[#262626] hover:bg-slate-50 flex items-center justify-center transition shadow-xs cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl p-4 bg-white border border-[#BEBEBE] shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#666666] uppercase tracking-wider">Status</span>
              <span className={`inline-flex items-center text-xs px-3 py-1 rounded-full font-bold ${
                status.isLive ? "bg-[#74D96F]/20 text-[#1F541D] border border-[#56BE51]/40" : "bg-[#F09363]/20 text-[#843209] border border-[#F09363]/40"
              }`}>
                {status.isLive ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 mr-1 text-[#56BE51]" /> Connected
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 mr-1 text-[#ED6B2D]" /> Offline
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-[#666666] leading-relaxed">
              {status.isLive
                ? "The app is talking to the API server."
                : "The API server can't be reached. Sign-in, people, departments and AI answers need it."}
            </p>
            {status.lastChecked && (
              <p className="text-[11px] text-[#9E9E9E] mt-1">Last checked {status.lastChecked}</p>
            )}
          </div>

          <div>
            <label htmlFor="api-base-url" className="block text-xs font-bold text-[#262626] uppercase tracking-wider mb-1.5">
              API Base URL
            </label>
            <div className="flex space-x-2">
              <input
                id="api-base-url"
                type="text"
                value={endpointInput}
                onChange={(e) => setEndpointInput(e.target.value)}
                placeholder="http://localhost:3001/api/v1"
                className="flex-1 rounded-2xl border border-[#BEBEBE] bg-white px-3.5 py-2.5 text-sm text-[#262626] focus:border-[#75A0C9] focus:outline-none focus:ring-2 focus:ring-[#75A0C9]/20"
              />
              <button
                onClick={handleTestConnection}
                disabled={isChecking}
                className="inline-flex items-center px-5 py-2.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isChecking ? "animate-spin" : ""}`} />
                Test connection
              </button>
            </div>
            <p className="text-[11px] text-[#666666] mt-1 font-mono">Default: http://localhost:3001/api/v1</p>
          </div>

          {testResult && (
            <div
              role={testResult.ok ? "status" : "alert"}
              className={`p-3 rounded-2xl text-xs flex items-start space-x-2 border ${
                testResult.ok
                  ? "bg-[#74D96F]/20 border-[#56BE51]/40 text-[#1F541D]"
                  : "bg-rose-50 border-rose-200 text-rose-700"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-[#D6D6D6] flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-full bg-[#262626] hover:bg-black text-white text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
