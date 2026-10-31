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
  X,
  Home,
  ChevronsLeft,
  Folder,
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
    owner: "bg-[#7928CA]/30 text-[#D8B4FE] border-[#A855F7]/40",
    admin: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    member: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    guest: "bg-gray-500/20 text-gray-300 border-gray-500/40",
  };
  return (
    <span className={`text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${styles[role] ?? styles.guest}`}>
      {role}
    </span>
  );
}

function MainBackgroundWaves() {
  return (
    <div className="absolute top-0 right-0 w-full max-w-5xl h-[420px] pointer-events-none select-none z-0 overflow-hidden">
      <svg
        viewBox="0 0 1440 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full object-cover object-right-top"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="mainMintGrad1" x1="1440" y1="0" x2="600" y2="400" gradientUnits="userSpaceOnUse">
            <stop stopColor="#99E6C9" stopOpacity="0.32" />
            <stop offset="0.4" stopColor="#6EE7B7" stopOpacity="0.18" />
            <stop offset="0.75" stopColor="#A7F3D0" stopOpacity="0.08" />
            <stop offset="1" stopColor="#F8FAF9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="mainMintGrad2" x1="1440" y1="30" x2="750" y2="350" gradientUnits="userSpaceOnUse">
            <stop stopColor="#80E5BE" stopOpacity="0.22" />
            <stop offset="0.5" stopColor="#74D96F" stopOpacity="0.10" />
            <stop offset="1" stopColor="#F8FAF9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="mainMintGrad3" x1="1350" y1="0" x2="900" y2="280" gradientUnits="userSpaceOnUse">
            <stop stopColor="#62C983" stopOpacity="0.16" />
            <stop offset="0.6" stopColor="#A7F3D0" stopOpacity="0.05" />
            <stop offset="1" stopColor="#F8FAF9" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Outer broad flowing ambient wave swell */}
        <path
          d="M280,0 C520,130 820,175 1100,120 C1250,90 1370,130 1440,150 L1440,0 Z"
          fill="url(#mainMintGrad1)"
        />

        {/* Middle translucent ribbon */}
        <path
          d="M480,0 C700,165 980,215 1240,145 C1325,120 1395,140 1440,160 L1440,0 Z"
          fill="url(#mainMintGrad2)"
        />

        {/* Foreground accent ribbon */}
        <path
          d="M720,0 C920,175 1160,205 1330,155 C1380,140 1415,150 1440,160 L1440,0 Z"
          fill="url(#mainMintGrad3)"
        />

        {/* Silk contour trace lines */}
        <path
          d="M320,0 C560,140 850,185 1120,125 C1260,95 1375,135 1440,152"
          stroke="#48B966"
          strokeWidth="1.2"
          strokeOpacity="0.32"
          fill="none"
        />
        <path
          d="M520,0 C740,175 1010,220 1260,150 C1335,125 1400,145 1440,162"
          stroke="#74D96F"
          strokeWidth="1.5"
          strokeOpacity="0.35"
          fill="none"
        />
        <path
          d="M800,0 C980,180 1200,205 1350,155 C1390,142 1420,150 1440,158"
          stroke="#34D399"
          strokeWidth="1"
          strokeOpacity="0.22"
          fill="none"
        />
      </svg>
    </div>
  );
}

function SidebarBackgroundWaves() {
  return (
    <div className="absolute bottom-0 left-0 w-full h-80 overflow-hidden pointer-events-none select-none z-0">
      <svg
        viewBox="0 0 300 350"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full object-cover"
      >
        <defs>
          <linearGradient id="sideGrad1" x1="0" y1="350" x2="250" y2="120" gradientUnits="userSpaceOnUse">
            <stop stopColor="#144A3C" stopOpacity="0.45" />
            <stop offset="0.55" stopColor="#0E352B" stopOpacity="0.20" />
            <stop offset="1" stopColor="#061814" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sideGrad2" x1="50" y1="350" x2="300" y2="180" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1A5747" stopOpacity="0.35" />
            <stop offset="0.6" stopColor="#0E352B" stopOpacity="0.10" />
            <stop offset="1" stopColor="#061814" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Ambient deep emerald wave */}
        <path
          d="M0,350 L300,350 L300,210 C240,190 180,270 120,235 C60,200 20,260 0,240 Z"
          fill="url(#sideGrad1)"
        />

        {/* Layer 2 wave */}
        <path
          d="M0,350 L300,350 L300,260 C230,240 160,310 100,285 C50,260 20,295 0,285 Z"
          fill="url(#sideGrad2)"
        />

        {/* Emerald contour trace lines */}
        <path
          d="M0,240 C25,260 65,205 125,240 C185,275 240,195 300,210"
          stroke="#56BE51"
          strokeWidth="1.2"
          strokeOpacity="0.28"
          fill="none"
        />
        <path
          d="M0,285 C45,295 100,260 160,295 C220,325 260,245 300,260"
          stroke="#74D96F"
          strokeWidth="1"
          strokeOpacity="0.22"
          fill="none"
        />
      </svg>
    </div>
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
  const isInvitePage = pathname.startsWith("/invite/");
  const isPublic = isAuthPage || isLandingPage || isInvitePage;

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

  // Role-gated nav groups matching screenshot
  const navGroups = [
    ...(isSuperAdmin
      ? [
          {
            label: "PLATFORM",
            items: [
              { name: "Admin console", href: "/admin", icon: ShieldCheck, show: true, badge: null as string | null, dot: false },
            ],
          },
        ]
      : []),
    {
      label: "MAIN",
      items: [
        { name: "Home", href: "/dashboard", icon: Home, show: true, dot: false },
        { name: "Knowledge", href: "/knowledge", icon: BookOpen, show: true, dot: false },
        { name: "Projects", href: "/projects", icon: FolderKanban, show: true, dot: false },
        { name: "Tickets", href: "/tickets", icon: TicketIcon, show: true, dot: false },
        { name: "Meetings", href: "/meetings", icon: Video, show: true, dot: false },
        { name: "Chat", href: "/chat", icon: MessageSquare, show: true, dot: false },
      ],
    },
    {
      label: "PEOPLE & AUTOMATION",
      items: [
        { name: "People", href: "/directory", icon: Users, show: true, dot: false },
        {
          name: "Agents",
          href: "/agents",
          icon: Bot,
          show: true,
          badge: hasRole(role, "admin") ? "admin" : null,
          dot: true,
        },
      ],
    },
    {
      label: "SYSTEM",
      items: [
        { name: "Files", href: "/storage", icon: HardDrive, show: true, dot: false },
        { name: "Analytics", href: "/analytics", icon: BarChart3, show: hasRole(role, "member"), dot: false },
        {
          name: "Settings",
          href: "/settings",
          icon: Settings,
          show: true,
          badge: hasRole(role, "admin") ? "admin" : null,
          dot: true,
        },
      ],
    },
  ];

  if (isPublic) {
    return <main className="min-h-screen w-full bg-white text-[#262626]">{children}</main>;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8F9FA] text-[#262626]">
      {/* ── Mobile backdrop overlay ── */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar (sliding drawer on mobile, collapsible aside on desktop) ── */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col border-r border-[#0D2620] bg-[#061814] text-[#A3B8B0] transition-all duration-300 shadow-2xl lg:shadow-none relative overflow-hidden ${
          isSidebarOpen
            ? "translate-x-0 w-72 lg:w-64"
            : "-translate-x-full lg:translate-x-0 lg:w-[4.5rem]"
        }`}
      >
        <SidebarBackgroundWaves />

        {/* Brand header */}
        <div className="relative z-10 flex items-center justify-between px-4 py-4 border-b border-[#0D2620]">
          <Link
            href="/dashboard"
            onClick={() => {
              if (typeof window !== "undefined" && window.innerWidth < 1024) {
                setIsSidebarOpen(false);
              }
            }}
            className="flex items-center space-x-3 group"
          >
            <div className="w-8 h-8 rounded-xl bg-[#0F352A] border border-[#1B5242] flex items-center justify-center shadow-xs shrink-0 transition-transform group-hover:scale-105">
              <div className="w-4 h-4 rounded-full border-2 border-[#56BE51] flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-[#74D96F]" />
              </div>
            </div>
            {isSidebarOpen && (
              <div className="truncate animate-fade-in">
                <h1 className="font-extrabold text-sm tracking-tight text-white">BizContext</h1>
                <p className="text-[9px] text-[#5C7E74] font-medium">AI Workspace</p>
              </div>
            )}
          </Link>
          {/* Close button on mobile */}
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden text-[#5C7E74] hover:text-white p-1.5 rounded-lg hover:bg-[#0A2620] transition cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Collapse/expand toggle on desktop */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="hidden lg:block text-[#5C7E74] hover:text-white p-1.5 rounded-lg hover:bg-[#0A2620] transition cursor-pointer"
            aria-label="Toggle sidebar"
          >
            <ChevronsLeft className={`w-4 h-4 transition-transform ${isSidebarOpen ? "" : "rotate-180"}`} />
          </button>
        </div>

        {/* Org selector matching screenshot */}
        {isSidebarOpen && (
          <div className="relative z-10 px-3 pt-3 animate-slide-down">
            <div className="flex items-center space-x-2 p-2.5 rounded-2xl bg-[#09221C] border border-[#133A30] text-xs">
              <div className="w-6 h-6 rounded-lg bg-[#12382E] flex items-center justify-center text-[#74D96F] shrink-0">
                <Building2 className="w-3.5 h-3.5 text-[#56BE51]" />
              </div>
              <span className="truncate font-bold text-white flex-1">{orgName || "Acme Innovations"}</span>
              <RoleBadge role={role || "owner"} />
              <ChevronRight className="w-3.5 h-3.5 text-[#4D6E63] shrink-0" />
            </div>
          </div>
        )}

        {/* Nav links */}
        <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-3 space-y-5">
          {navGroups.map((group, gIdx) => (
            <div key={gIdx}>
              {isSidebarOpen && (
                <div className="text-[10px] font-extrabold tracking-widest text-[#426157] uppercase px-2 mb-2">
                  {group.label}
                </div>
              )}
              <div className="space-y-1">
                {group.items
                  .filter((item) => item.show)
                  .map((item, iIdx) => {
                    const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => {
                          if (typeof window !== "undefined" && window.innerWidth < 1024) {
                            setIsSidebarOpen(false);
                          }
                        }}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-2xl text-xs transition-all group animate-slide-in-left stagger-${iIdx + 1} ${
                          isActive
                            ? "bg-[#0D382E] border border-[#185746] text-white font-bold shadow-xs"
                            : "text-[#8EAAA1] hover:text-white hover:bg-[#0A2620] font-medium"
                        }`}
                        title={!isSidebarOpen ? item.name : undefined}
                      >
                        <div className="flex items-center space-x-3">
                          <Icon
                            className={`w-4 h-4 shrink-0 transition-colors ${
                              isActive ? "text-[#74D96F]" : "text-[#7E9D93] group-hover:text-white"
                            }`}
                          />
                          {isSidebarOpen && <span>{item.name}</span>}
                        </div>
                        {isSidebarOpen && item.dot && (
                          <span className="w-2 h-2 rounded-full bg-[#F09363] shadow-[0_0_8px_#F09363] shrink-0" />
                        )}
                        {isSidebarOpen && isActive && (
                          <ChevronRight className="w-3.5 h-3.5 text-[#74D96F] shrink-0" />
                        )}
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer matching screenshot */}
        <div className="relative z-10 p-3.5 border-t border-[#0D2620] bg-[#051410]/80 backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 truncate min-w-0">
              <div className="relative shrink-0">
                <div
                  aria-hidden
                  className="w-8 h-8 rounded-xl bg-[#0F352A] text-[#74D96F] text-xs font-bold flex items-center justify-center border border-[#1B5242]"
                >
                  {initials}
                </div>
              </div>
              {isSidebarOpen && (
                <div className="truncate min-w-0">
                  <div className="text-xs font-bold text-white truncate">{displayName}</div>
                  <RoleBadge role={role || "owner"} />
                </div>
              )}
            </div>

            {isSidebarOpen && (
              <button
                type="button"
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-[#5C7E74] hover:text-rose-400 hover:bg-[#0D2620] transition cursor-pointer"
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[#F8FAF9]">
        {/* Mint organic vector waves background matching screenshot */}
        <MainBackgroundWaves />

        {/* Top navbar */}
        <header className="h-16 bg-transparent px-4 sm:px-8 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center space-x-2 flex-1 min-w-0 mr-4">
            {/* Hamburger button for mobile */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-1.5 -ml-1 rounded-xl text-[#666666] hover:text-[#262626] hover:bg-[#EDEDED] transition cursor-pointer shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Second Brain search bar matching screenshot */}
            <button
              onClick={() => setIsAiModalOpen(true)}
              className="flex items-center space-x-2.5 px-4 py-2 rounded-full bg-white hover:bg-[#FAFBFB] border border-[#DCE4E0] hover:border-[#74D96F]/60 text-xs text-[#52665F] hover:text-[#262626] transition w-full max-w-[220px] xs:max-w-xs sm:max-w-md shadow-2xs group cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#56BE51] group-hover:scale-110 transition-transform shrink-0" />
              <span className="truncate">Ask second brain... (Search files, knowledge, people, anything)</span>
              <kbd className="hidden sm:inline-block ml-auto text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#F0F2F1] text-[#262626] border border-[#D5DCD8]">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right actions */}
          <div className="flex items-center space-x-3 shrink-0">
            {/* Notification bell matching screenshot */}
            <button
              onClick={() => router.push("/settings")}
              className="relative p-2.5 rounded-full border border-[#DCE4E0] bg-white hover:bg-[#F8F9FA] text-[#52665F] hover:text-[#262626] transition cursor-pointer shadow-2xs"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
            </button>

            {/* API status pill matching screenshot */}
            <button
              onClick={() => setIsApiModalOpen(true)}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer shadow-2xs ${
                apiStatus.isLive
                  ? "bg-[#EAF8E9] border-[#C6ECC4] text-[#1F541D] hover:bg-[#DCF3DB]"
                  : "bg-[#FDF1EB] border-[#F8D4C3] text-[#843209] hover:bg-[#FAE8DE]"
              }`}
              title="API connection status"
            >
              {apiStatus.isLive ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-[#56BE51]" />
                  <span className="hidden sm:inline">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-[#ED6B2D]" />
                  <span className="hidden sm:inline">Offline</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Page content with ambient waves visible behind */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-7 md:p-8 bg-transparent page-enter relative z-10">
          {children}
        </main>
      </div>

      {/* Modals */}
      <ApiStatusModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />
      <SecondBrainModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
};
