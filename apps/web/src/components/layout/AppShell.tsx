"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Brain,
  BookOpen,
  FolderKanban,
  Ticket as TicketIcon,
  Video,
  MessageSquare,
  Users,
  Bot,
  Globe,
  HardDrive,
  BarChart3,
  Settings,
  Sparkles,
  Wifi,
  WifiOff,
  Menu,
  Building2,
  LogOut,
  Bell,
  Shield,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { api, ApiStatus } from "../../services/api";
import type { StoredSession } from "../../services/http";
import { ApiStatusModal } from "./ApiStatusModal";
import { SecondBrainModal } from "./SecondBrainModal";

interface AppShellProps {
  children: React.ReactNode;
}

type Role = "owner" | "admin" | "member" | "guest";

const ROLE_HIERARCHY: Record<Role, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

function hasRole(userRole: string | null, minRole: Role): boolean {
  if (!userRole) return false;
  return (ROLE_HIERARCHY[userRole as Role] ?? 0) >= ROLE_HIERARCHY[minRole];
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  const styles: Record<string, string> = {
    owner: "bg-purple-100 text-purple-700 border-purple-200",
    admin: "bg-amber-100 text-amber-700 border-amber-200",
    member: "bg-green-100 text-green-700 border-green-200",
    guest: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${styles[role] ?? styles.guest}`}>
      {role}
    </span>
  );
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<StoredSession["user"] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    isLive: false,
    endpoint: api.getBaseUrl(),
    lastChecked: "",
  });
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [notifVisible, setNotifVisible] = useState(false);

  const isAuthPage = pathname === "/login" || pathname === "/register";
  const isLandingPage = pathname === "/";
  const isPublic = isAuthPage || isLandingPage;

  const loadNotifications = useCallback(async () => {
    try {
      const count = await api.getUnreadNotificationsCount();
      if (count !== unreadNotifs) {
        if (count > unreadNotifs) setNotifVisible(true);
        setUnreadNotifs(count);
      }
    } catch {
      /* non-critical */
    }
  }, [unreadNotifs]);

  useEffect(() => {
    if (isPublic) return;
    const session = api.getSession();
    setCurrentUser(session?.user ?? null);
    setRole(session?.role ?? null);
    setIsSuperAdmin(session?.isSuperAdmin === true);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);

    api
      .getOrganisations()
      .then((orgs) => {
        const current = orgs.find((o) => o.id === session?.organisationId) ?? orgs[0];
        setOrgName(current?.name ?? null);
      })
      .catch(() => setOrgName(null));

    loadNotifications();
    const notifInterval = setInterval(loadNotifications, 30_000);
    return () => clearInterval(notifInterval);
  }, [isPublic]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.checkApiHealth();
    const unsubscribe = api.subscribeStatus((newStatus) => setApiStatus(newStatus));

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsAiModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleLogout = async () => {
    await api.logout();
    router.push("/login");
  };

  const displayName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email.split("@")[0]
    : "";
  const initials = (displayName || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Role-gated nav groups
  const navGroups = [
    ...(isSuperAdmin
      ? [
          {
            label: "PLATFORM",
            items: [
              { name: "Admin console", href: "/admin", icon: ShieldCheck, show: true, badge: null as string | null },
            ],
          },
        ]
      : []),
    {
      label: "WORKSPACE",
      items: [
        { name: "Home", href: "/dashboard", icon: Brain, show: true },
        { name: "Knowledge", href: "/knowledge", icon: BookOpen, show: true },
        { name: "Projects", href: "/projects", icon: FolderKanban, show: true },
        { name: "Tickets", href: "/tickets", icon: TicketIcon, show: true },
        { name: "Meetings", href: "/meetings", icon: Video, show: true },
        { name: "Chat", href: "/chat", icon: MessageSquare, show: true },
      ],
    },
    {
      label: "PEOPLE & AUTOMATION",
      items: [
        { name: "People", href: "/directory", icon: Users, show: true },
        {
          name: "Agents",
          href: "/agents",
          icon: Bot,
          show: true,
          badge: hasRole(role, "admin") ? "admin" : null,
        },
        {
          name: "Browser jobs",
          href: "/browser-jobs",
          icon: Globe,
          show: true,
          badge: hasRole(role, "admin") ? "admin" : null,
        },
      ],
    },
    {
      label: "SYSTEM",
      items: [
        { name: "Files", href: "/storage", icon: HardDrive, show: true },
        { name: "Analytics", href: "/analytics", icon: BarChart3, show: hasRole(role, "member") },
        {
          name: "Settings",
          href: "/settings",
          icon: Settings,
          show: true,
          badge: hasRole(role, "admin") ? "admin" : null,
        },
      ],
    },
  ];

  if (isPublic) {
    return <main className="min-h-screen w-full bg-white text-[#262626]">{children}</main>;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8F9FA] text-[#262626]">
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col border-r border-[#EDEDED] bg-white transition-all duration-300 z-30 ${
          isSidebarOpen ? "w-64" : "w-[4.5rem]"
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[#EDEDED]">
          <Link href="/dashboard" className="flex items-center space-x-3 group">
            <div className="w-8 h-8 rounded-xl bg-[#74D96F] flex items-center justify-center shadow-[0_2px_10px_rgba(116,217,111,0.35)] shrink-0 transition-transform group-hover:scale-105 animate-pulse-glow">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8" strokeOpacity="0.4" strokeWidth="2" />
                <path d="M7.5 12h8.5a4 4 0 0 0-4-4c-3.5 0-4.5 3-4.5 4s1 4 4.5 4c2.5 0 3.8-1.5 4-2.5" />
              </svg>
            </div>
            {isSidebarOpen && (
              <div className="truncate animate-fade-in">
                <h1 className="font-extrabold text-sm tracking-tight text-[#262626]">BizContext</h1>
                <p className="text-[9px] text-[#9E9E9E] font-medium">AI Workspace</p>
              </div>
            )}
          </Link>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="text-[#666666] hover:text-[#262626] p-1.5 rounded-lg hover:bg-[#EDEDED] transition cursor-pointer"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>

        {/* Org selector */}
        {isSidebarOpen && orgName && (
          <div className="px-3 pt-3 animate-slide-down">
            <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-[#F8F9FA] border border-[#EDEDED] text-xs">
              <Building2 className="w-3.5 h-3.5 text-[#56BE51] shrink-0" />
              <span className="truncate font-bold text-[#262626] flex-1">{orgName}</span>
              {role && <RoleBadge role={role} />}
            </div>
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
          {navGroups.map((group, gIdx) => (
            <div key={gIdx}>
              {isSidebarOpen && (
                <div className="text-[10px] font-bold tracking-wider text-[#9E9E9E] uppercase px-2 mb-1.5">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items
                  .filter((item) => item.show)
                  .map((item, iIdx) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-all group animate-slide-in-left stagger-${iIdx + 1} ${
                          isActive
                            ? "bg-[#74D96F]/15 text-[#1F541D] border border-[#74D96F]/30 font-bold shadow-xs"
                            : "text-[#666666] hover:text-[#262626] hover:bg-[#EDEDED] font-medium"
                        }`}
                        title={!isSidebarOpen ? item.name : undefined}
                      >
                        <div className="flex items-center space-x-3">
                          <Icon
                            className={`w-4 h-4 shrink-0 transition-colors ${
                              isActive ? "text-[#56BE51]" : "text-[#666666] group-hover:text-[#262626]"
                            }`}
                          />
                          {isSidebarOpen && <span>{item.name}</span>}
                        </div>
                        {isSidebarOpen && item.badge && (
                          <span title="Admin feature" className="shrink-0">
                            <Shield className="w-3 h-3 text-amber-500" />
                          </span>
                        )}
                        {isSidebarOpen && isActive && (
                          <ChevronRight className="w-3 h-3 text-[#56BE51] shrink-0" />
                        )}
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-[#EDEDED] bg-[#F8F9FA]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 truncate min-w-0">
              <div className="relative shrink-0">
                <div
                  aria-hidden
                  className="w-8 h-8 rounded-lg bg-[#74D96F]/25 text-[#1F541D] text-xs font-bold flex items-center justify-center border border-[#74D96F]/40"
                >
                  {initials}
                </div>
              </div>
              {isSidebarOpen && (
                <div className="truncate min-w-0">
                  <div className="text-xs font-bold text-[#262626] truncate">{displayName}</div>
                  {role && <RoleBadge role={role} />}
                </div>
              )}
            </div>

            {isSidebarOpen && (
              <button
                type="button"
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-[#666666] hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top navbar */}
        <header className="h-14 border-b border-[#EDEDED] bg-white/90 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-20">
          {/* Second Brain search bar */}
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] border border-[#D8D8D8] hover:border-[#BEBEBE] text-xs text-[#666666] hover:text-[#262626] transition w-full max-w-sm shadow-xs group cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#56BE51] group-hover:scale-110 transition-transform" />
            <span className="truncate">Ask your second brain...</span>
            <kbd className="hidden sm:inline-block ml-auto text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-white text-[#262626] border border-[#BEBEBE]">
              ⌘K
            </kbd>
          </button>

          {/* Right actions */}
          <div className="flex items-center space-x-2 ml-3">
            {/* Notification bell */}
            <button
              onClick={() => router.push("/settings")}
              className="relative p-2 rounded-xl text-[#666666] hover:text-[#262626] hover:bg-[#EDEDED] transition cursor-pointer"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifs > 0 && (
                <span
                  className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-[#F09363] text-white text-[9px] font-bold flex items-center justify-center px-1 ${
                    notifVisible ? "animate-notif-pop" : ""
                  }`}
                  onAnimationEnd={() => setNotifVisible(false)}
                >
                  {unreadNotifs > 99 ? "99+" : unreadNotifs}
                </span>
              )}
            </button>

            {/* API status pill */}
            <button
              onClick={() => setIsApiModalOpen(true)}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition cursor-pointer ${
                apiStatus.isLive
                  ? "bg-[#74D96F]/15 border-[#56BE51]/35 text-[#1F541D] hover:bg-[#74D96F]/25"
                  : "bg-[#F09363]/15 border-[#F09363]/35 text-[#843209] hover:bg-[#F09363]/25"
              }`}
              title="API connection status"
            >
              {apiStatus.isLive ? (
                <>
                  <Wifi className="w-3 h-3 text-[#56BE51]" />
                  <span className="hidden md:inline">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-[#ED6B2D]" />
                  <span className="hidden md:inline">Offline</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#F8F9FA] page-enter">
          {children}
        </main>
      </div>

      {/* Modals */}
      <ApiStatusModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />
      <SecondBrainModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
};
