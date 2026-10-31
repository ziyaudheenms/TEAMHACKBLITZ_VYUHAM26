"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronDown, Globe, Sparkles, ArrowRight } from "lucide-react";

interface CubeData {
  col: number;
  row: number;
  gradient: string;
  glow?: string;
  delay: string;
}

export function SynthioHeroSection() {
  const [toggleActive, setToggleActive] = useState(true);
  const [selectedLang, setSelectedLang] = useState("EN");
  const [hoveredCube, setHoveredCube] = useState<string | null>(null);

  // 16 columns across the full width wave:
  // Stepped terrain wave matching the reference screenshot:
  // [3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4]
  const columnHeights = [3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4];

  // Generate the cubes across full width with the harmonious color spectrum from globals.css:
  // Cols 0-3: Steel Blue / Azure (--color-brand-blue: #75A0C9)
  // Cols 4-7: Frosted White & Subtle Mint Glow (--color-brand-primary: #74D96F)
  // Cols 8-11: Vivid Magenta / Orchid / Purple
  // Cols 12-15: Warm Coral Peach & Amber Orange (--color-brand-coral: #F09363, --color-brand-orange: #ED6B2D)
  const cubes: CubeData[] = [];

  columnHeights.forEach((height, col) => {
    for (let row = 0; row < height; row++) {
      let gradient = "";
      let glow = "";

      if (col <= 2) {
        // Deep sky blue & cyan
        gradient =
          row === 0
            ? "from-[#60A5FA]/90 via-[#3B82F6]/85 to-[#2563EB]/90"
            : row === 1
            ? "from-[#93C5FD]/85 via-[#60A5FA]/80 to-[#3B82F6]/75"
            : "from-[#BFDBFE]/80 via-[#93C5FD]/75 to-[#60A5FA]/70";
        glow = "rgba(59, 130, 246, 0.25)";
      } else if (col === 3) {
        // Soft cyan-blue transition
        gradient =
          row === 0
            ? "from-[#93C5FD]/80 via-[#75A0C9]/80 to-[#60A5FA]/80"
            : "from-white/90 via-[#DBEAFE]/80 to-[#BFDBFE]/75";
        glow = "rgba(117, 160, 201, 0.2)";
      } else if (col <= 6) {
        // Frosted White / Light Pale Mint Lavender
        gradient =
          row === 0
            ? "from-white/95 via-[#F1F5F9]/90 to-[#E2E8F0]/85"
            : "from-white/95 via-[#F8FAFC]/90 to-[#EDF2F7]/85";
        glow = "rgba(255, 255, 255, 0.5)";
      } else if (col <= 8) {
        // Soft Lavender into Purple
        gradient =
          row === 0
            ? "from-[#C084FC]/85 via-[#A855F7]/85 to-[#9333EA]/85"
            : row === 1
            ? "from-[#DDD6FE]/85 via-[#C084FC]/80 to-[#A855F7]/80"
            : "from-white/90 via-[#E9D5FF]/80 to-[#D8B4FE]/75";
        glow = "rgba(168, 85, 247, 0.25)";
      } else if (col <= 12) {
        // Vivid Magenta / Orchid Pink
        gradient =
          row === 0
            ? "from-[#F472B6]/90 via-[#E879F9]/90 to-[#D946EF]/90"
            : row === 1
            ? "from-[#FBCFE8]/85 via-[#F472B6]/85 to-[#E879F9]/85"
            : row === 2
            ? "from-white/90 via-[#FCE7F3]/85 to-[#F472B6]/80"
            : "from-white/95 via-[#FDF2F8]/90 to-[#FCE7F3]/85";
        glow = "rgba(217, 70, 239, 0.3)";
      } else {
        // Warm Coral & Amber Orange (Minto tokens #F09363 & #ED6B2D)
        gradient =
          row === 0
            ? "from-[#FB923C]/95 via-[#F09363]/95 to-[#ED6B2D]/95"
            : row === 1
            ? "from-[#FDBA74]/90 via-[#FB923C]/90 to-[#F09363]/90"
            : row === 2
            ? "from-[#FED7AA]/85 via-[#FDBA74]/85 to-[#FB923C]/80"
            : "from-white/90 via-[#FFEDD5]/85 to-[#FED7AA]/80";
        glow = "rgba(240, 147, 99, 0.35)";
      }

      // Add gentle staggered animation delay
      const delay = `${((col * 0.1 + row * 0.12) % 3).toFixed(2)}s`;

      cubes.push({ col, row, gradient, glow, delay });
    }
  });

  return (
    <div className="w-full bg-[#E8EAEF] min-h-[92vh] sm:min-h-screen pt-0 pb-3 sm:pb-5 md:pb-8 px-0 flex flex-col items-center justify-start font-sans">
      {/* Full Width Canvas (no side paddings, square top, rounded bottom) */}
      <div className="w-full bg-white rounded-t-none rounded-b-[24px] sm:rounded-b-[36px] md:rounded-b-[44px] shadow-[0_25px_80px_-15px_rgba(20,25,38,0.10)] relative overflow-hidden flex flex-col justify-between min-h-[680px] sm:min-h-[760px] md:min-h-[820px] border-t-0 border-x-0 border-b border-[#E2E8F0] select-none">
        {/* Subtle Pinstripe Vertical Columns in background across full width */}
        <div className="absolute inset-0 pointer-events-none grid grid-cols-8 md:grid-cols-16">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="border-r border-[#ECEFF3]/65 h-full" />
          ))}
        </div>

        {/* Top Navigation Bar with BizContext AI relevant links */}
        <header className="relative z-30 px-6 sm:px-10 md:px-14 lg:px-16 pt-6 sm:pt-8 flex items-center justify-between">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <svg width="30" height="30" viewBox="0 0 28 28" fill="none" className="transition-transform group-hover:scale-105">
                {/* 3 interlocking rounded bubble rings forming triad */}
                <circle cx="14" cy="8.5" r="5" stroke="#1E232F" strokeWidth="2.5" fill="none" />
                <circle cx="9" cy="18" r="5" stroke="#1E232F" strokeWidth="2.5" fill="none" />
                <circle cx="19" cy="18" r="5" stroke="#1E232F" strokeWidth="2.5" fill="none" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-[#1E232F] text-lg md:text-xl tracking-tight">BizContext</span>
              <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40">
                AI
              </span>
            </div>
          </Link>

          {/* Relevant Platform Navigation Links */}
          <nav className="hidden lg:flex items-center gap-8">
            {[
              { label: "Second Brain", href: "/knowledge" },
              { label: "Projects & Kanban", href: "/projects" },
              { label: "Autonomous Agents", href: "/agents" },
              { label: "Team & Skills", href: "/directory" },
              { label: "Analytics", href: "/analytics" },
            ].map((item, idx) => (
              <Link
                key={item.label}
                href={item.href}
                className={`text-xs md:text-sm font-semibold transition-colors ${
                  idx === 0 ? "text-[#1E232F] font-bold" : "text-[#5E6470] hover:text-[#1E232F]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2.5 sm:gap-3.5">
            {/* Language Selector */}
            <div className="relative hidden sm:flex items-center">
              <button
                type="button"
                className="px-3 py-1.5 rounded-full border border-[#E5E7EB] bg-[#F7F8FA] hover:bg-[#EFF1F5] text-[11px] font-semibold text-[#4B5262] flex items-center gap-1.5 transition cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-[#6B7280]" />
                <span>{selectedLang}</span>
                <ChevronDown className="w-3 h-3 text-[#6B7280]" />
              </button>
            </div>

            {/* Login */}
            <Link
              href="/login"
              className="text-xs font-bold text-[#1E232F] hover:text-black px-3.5 py-1.5 rounded-full hover:bg-[#F3F4F6] transition cursor-pointer"
            >
              Sign In
            </Link>

            {/* Get Started / Open Workspace */}
            <Link
              href="/dashboard"
              className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-full bg-[#1E232F] hover:bg-[#2C3444] text-white text-xs font-bold shadow-sm hover:shadow transition-all duration-150 cursor-pointer"
            >
              Open Workspace
            </Link>
          </div>
        </header>

        {/* Hero Content Area */}
        <div className="relative z-20 px-6 sm:px-10 md:px-14 lg:px-16 pt-8 sm:pt-14 md:pt-18 pb-6">
          <div className="max-w-4xl">
            {/* Live Context Badge */}
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#74D96F]/15 border border-[#74D96F]/40 text-[#1F541D] text-[11px] font-bold mb-4 sm:mb-5">
              <Sparkles className="w-3 h-3 text-[#56BE51]" />
              <span>Autonomous Operating Workspace v2.0</span>
            </div>

            {/* Headline with Interactive Gradient Toggle */}
            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-[4.4rem] font-black text-[#1E232F] tracking-tight leading-[1.08]">
              <span>Your next-level </span>
              {/* Interactive Gradient Toggle Switch */}
              <button
                type="button"
                onClick={() => setToggleActive(!toggleActive)}
                className={`relative inline-flex items-center h-8 sm:h-9 md:h-10 w-16 sm:w-18 md:w-20 rounded-full p-1 cursor-pointer align-middle mx-1.5 transition-all duration-300 shadow-inner group ${
                  toggleActive
                    ? "bg-gradient-to-r from-[#6366F1] via-[#A855F7] to-[#F97316]"
                    : "bg-gradient-to-r from-[#74D96F] via-[#75A0C9] to-[#F09363]"
                }`}
                title="Click to toggle productivity turbo mode"
                aria-label="Toggle productivity engine"
              >
                {/* Glow aura */}
                <div className="absolute inset-0 rounded-full blur-xs opacity-50 bg-inherit" />
                {/* Glossy White 3D Knob */}
                <div
                  className={`relative z-10 w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-full bg-white shadow-[0_3px_10px_rgba(0,0,0,0.35),inset_0_1px_2px_rgba(255,255,255,1)] transform transition-transform duration-300 ${
                    toggleActive ? "translate-x-8 sm:translate-x-9 md:translate-x-10" : "translate-x-0"
                  }`}
                />
              </button>
              <br />
              <span className="bg-gradient-to-r from-[#8E9EB5] via-[#75A0C9] to-[#607D8B] bg-clip-text text-transparent font-black">
                autonomous{" "}
              </span>
              <span className="text-[#1E232F]">workspace.</span>
            </h1>

            {/* Subtitle */}
            <p className="mt-3.5 sm:mt-5 text-sm sm:text-base md:text-lg text-[#666666] font-medium max-w-2xl leading-relaxed">
              A self-driving AI operating system that remembers your organisation&apos;s knowledge, coordinates teams with smart workload assignment, and deploys autonomous browser agents.
            </p>

            {/* Primary Action Buttons */}
            <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-3.5">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center px-7 py-3.5 rounded-full bg-[#0F1E36] hover:bg-[#182F54] active:scale-95 text-white font-bold text-xs sm:text-sm tracking-wide shadow-[0_14px_30px_-6px_rgba(15,30,54,0.45)] hover:shadow-[0_18px_36px_-6px_rgba(15,30,54,0.55)] transition-all duration-200 cursor-pointer"
              >
                <span>Boost Productivity</span>
              </Link>

              <Link
                href="/knowledge"
                className="inline-flex items-center justify-center space-x-1.5 px-6 py-3.5 rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#1E232F] font-bold text-xs sm:text-sm transition cursor-pointer"
              >
                <span>Explore Second Brain</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* 3D Frosted Glass Mosaic Grid Stepped Wave across Full Width */}
        <div className="relative w-full h-[280px] sm:h-[340px] md:h-[400px] mt-auto overflow-hidden pointer-events-auto">
          {/* Subtle atmospheric ambient glows behind the cubes */}
          <div className="absolute bottom-0 left-0 w-1/3 h-48 bg-[#60A5FA]/20 blur-3xl pointer-events-none rounded-full" />
          <div className="absolute bottom-0 right-1/4 w-1/3 h-56 bg-[#E879F9]/25 blur-3xl pointer-events-none rounded-full" />
          <div className="absolute bottom-0 right-0 w-1/4 h-48 bg-[#F09363]/25 blur-3xl pointer-events-none rounded-full" />

          {/* Grid columns */}
          <div className="absolute inset-0 px-2 sm:px-6 md:px-10 pb-2 sm:pb-4 flex items-end justify-between gap-1 sm:gap-2 md:gap-2.5">
            {columnHeights.map((height, colIndex) => {
              // Find all cubes in this column
              const colCubes = cubes.filter((c) => c.col === colIndex);

              return (
                <div
                  key={colIndex}
                  className="flex-1 flex flex-col-reverse gap-1 sm:gap-2 md:gap-2.5 items-stretch min-w-0"
                >
                  {colCubes.map((cube) => {
                    const cubeKey = `${cube.col}-${cube.row}`;
                    const isHovered = hoveredCube === cubeKey;

                    return (
                      <div
                        key={cubeKey}
                        onMouseEnter={() => setHoveredCube(cubeKey)}
                        onMouseLeave={() => setHoveredCube(null)}
                        style={{
                          animation: `floatSlow 5s ease-in-out infinite`,
                          animationDelay: cube.delay,
                        }}
                        className={`aspect-square w-full rounded-xl sm:rounded-2xl md:rounded-[22px] bg-gradient-to-br ${
                          cube.gradient
                        } backdrop-blur-xl border border-white/70 shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.06),0_8px_20px_-4px_rgba(0,0,0,0.08)] transition-all duration-300 relative overflow-hidden cursor-pointer ${
                          isHovered
                            ? "scale-105 -translate-y-2 shadow-[0_16px_32px_-4px_rgba(0,0,0,0.18),inset_0_2px_6px_rgba(255,255,255,1)] border-white z-20"
                            : "hover:scale-[1.02]"
                        }`}
                      >
                        {/* Radial 3D specular highlight at top-left of each glass cube */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            background:
                              "radial-gradient(circle at 35% 25%, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.2) 45%, transparent 75%)",
                          }}
                        />

                        {/* Glossy top edge highlight */}
                        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent pointer-events-none rounded-t-xl sm:rounded-t-2xl" />

                        {/* Subtle bottom shadow depth */}
                        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black/10 to-transparent pointer-events-none rounded-b-xl sm:rounded-b-2xl" />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
export default SynthioHeroSection;
