import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "../components/layout/AppShell";
import { LiveOrb } from "@/components/ui/live-orb";

export const metadata: Metadata = {
  // Invitation links carry a secret token in the URL; never leak it to third-party sites via Referer.
  referrer: "same-origin",
  title: "BizContext AI | Minto Autonomous Operating Workspace",
  description:
    "A unified AI workspace that remembers what an organisation knows, coordinates teams, and acts with zero-friction browser-capable AI agents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light">
      <body className="antialiased min-h-screen bg-[#F8F9FA] text-[#262626] selection:bg-[#9DFF9B] selection:text-[#262626]">
        <AppShell>{children}</AppShell>
        <LiveOrb />
      </body>
    </html>
  );
}
