import type { Metadata } from "next";
import Link from "next/link";

import { getAccountContext } from "@/lib/auth/account";
import { ROLES, type RoleKey } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Apex Campus Cloud · Higher Education Academic ERP & Learning Platform",
  description:
    "Unified institutional campus ERP, Outcome-Based Education (OBE) framework, dynamic timetable scheduling, and verified digital learning portal for higher education.",
};

export default async function Home() {
  const account = await getAccountContext();

  const userRoleLabel = account?.navRole
    ? ROLES[account.navRole as RoleKey]?.label || account.navRole
    : "Portal";

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Official Institutional Top Header ────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-[#b3d4ea]/70 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          {/* Institution Brand & Seal */}
          <Link href="/" className="group flex items-center gap-3 transition-opacity hover:opacity-95">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#001D39] via-[#0A4174] to-[#49769F] text-lg font-bold text-white shadow-md shadow-[#001D39]/20 ring-2 ring-[#7BBDE8]/60"
            >
              🏛️
            </span>
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-base font-bold tracking-tight text-[#001D39]">
                APEX CAMPUS
                <span className="rounded-md bg-[#0A4174]/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[#0A4174] uppercase">
                  HigherEd ERP
                </span>
              </span>
              <span className="text-xs font-medium text-[#49769F]">
                Academic Cloud &amp; Digital Learning Platform
              </span>
            </div>
          </Link>

          {/* Quick Nav Links (Desktop) */}
          <nav aria-label="Portal Navigation" className="hidden items-center gap-6 md:flex">
            <a
              href="#portals"
              className="text-sm font-semibold text-[#001D39] transition-colors hover:text-[#0A4174]"
            >
              Portals
            </a>
            <a
              href="#modules"
              className="text-sm font-semibold text-[#001D39] transition-colors hover:text-[#0A4174]"
            >
              Academic Modules
            </a>
            <a
              href="#accreditation"
              className="text-sm font-semibold text-[#001D39] transition-colors hover:text-[#0A4174]"
            >
              OBE &amp; Accreditation
            </a>
            <Link
              href="/calendar"
              className="text-sm font-semibold text-[#001D39] transition-colors hover:text-[#0A4174]"
            >
              Academic Calendar
            </Link>
          </nav>

          {/* User Status / Action Button */}
          <div className="flex items-center gap-3">
            {account ? (
              <div className="flex items-center gap-2.5">
                <div className="hidden text-right sm:block">
                  <p className="text-xs font-semibold text-[#001D39]">{account.user.name}</p>
                  <p className="text-[11px] font-medium text-[#49769F]">
                    {account.tenant?.institutionName || userRoleLabel}
                  </p>
                </div>
                <Link
                  href={account.homePath}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#001D39] via-[#0A4174] to-[#49769F] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#001D39]/20 transition-all hover:shadow-lg hover:brightness-110"
                >
                  Enter {userRoleLabel}
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/select-institution"
                  className="hidden rounded-xl border border-[#b3d4ea] bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#0A4174] transition-colors hover:bg-white sm:inline-flex"
                >
                  Institutions
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#001D39] to-[#0A4174] px-4 py-2 text-xs font-bold text-white shadow-md shadow-[#001D39]/25 transition-all hover:from-[#0A4174] hover:to-[#49769F]"
                >
                  Sign In to Portal
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero Section ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:px-8">
        <div className="mx-auto max-w-5xl text-center">
          {/* Institutional Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#7BBDE8]/60 bg-white/70 px-3.5 py-1.5 text-xs font-bold text-[#0A4174] shadow-sm backdrop-blur-md">
            <span className="flex size-2 rounded-full bg-[#0d9488] ring-4 ring-[#0d9488]/20" />
            Official University Academic Enterprise Platform
            <span className="hidden text-[#49769F] sm:inline">·</span>
            <span className="hidden text-[#49769F] sm:inline">Outcome-Based Education (OBE) Standard</span>
          </div>

          {/* Hero Main Heading */}
          <h1 className="text-4xl font-extrabold tracking-tight text-[#001D39] sm:text-5xl lg:text-6xl">
            Unified Academic ERP &amp; <br />
            <span className="bg-gradient-to-r from-[#0A4174] via-[#49769F] to-[#4E8EA2] bg-clip-text text-transparent">
              Digital Learning Ecosystem
            </span>
          </h1>

          {/* Hero Subtitle */}
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-[#001D39]/80 sm:text-lg">
            An integrated, multi-tenant digital campus infrastructure engineered for universities and
            autonomous colleges. Unifying academic governance, Outcome-Based Education (OBE) curriculum
            matrices, conflict-free timetable scheduling, faculty instruction, and student lifecycle management.
          </p>

          {/* Primary Action Buttons */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {account ? (
              <Link
                href={account.homePath}
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#001D39] via-[#0A4174] to-[#49769F] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#001D39]/30 transition-all hover:scale-[1.02] hover:shadow-xl hover:brightness-110"
              >
                Continue to {userRoleLabel} Workspace
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#001D39] via-[#0A4174] to-[#49769F] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#001D39]/30 transition-all hover:scale-[1.02] hover:shadow-xl hover:brightness-110"
              >
                Sign In to Campus Portal
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            )}

            <a
              href="#portals"
              className="inline-flex items-center gap-2 rounded-xl border border-[#b3d4ea] bg-white/80 px-5 py-3.5 text-sm font-bold text-[#001D39] shadow-sm backdrop-blur-md transition-all hover:bg-white hover:border-[#7BBDE8]"
            >
              Browse Portals
              <svg className="size-4 text-[#49769F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </a>

            <Link
              href="/calendar"
              className="inline-flex items-center gap-2 rounded-xl border border-[#b3d4ea] bg-white/80 px-5 py-3.5 text-sm font-bold text-[#0A4174] shadow-sm backdrop-blur-md transition-all hover:bg-white hover:border-[#7BBDE8]"
            >
              <svg className="size-4 text-[#0A4174]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Academic Calendar
            </Link>
          </div>

          {/* Quick Metrics & Pillars Bar */}
          <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-4 text-left shadow-sm backdrop-blur-md">
              <div className="text-xl font-black text-[#001D39] sm:text-2xl">100% OBE</div>
              <div className="text-xs font-bold text-[#0A4174]">Accreditation Ready</div>
              <p className="mt-1 text-[11px] text-[#49769F]">CO-PO mapping, Bloom&apos;s taxonomy &amp; attainment.</p>
            </div>

            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-4 text-left shadow-sm backdrop-blur-md">
              <div className="text-xl font-black text-[#001D39] sm:text-2xl">Conflict-Free</div>
              <div className="text-xs font-bold text-[#0A4174]">Smart Timetabling</div>
              <p className="mt-1 text-[11px] text-[#49769F]">Algorithmic room allocation &amp; faculty schedules.</p>
            </div>

            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-4 text-left shadow-sm backdrop-blur-md">
              <div className="text-xl font-black text-[#001D39] sm:text-2xl">Dynamic QR</div>
              <div className="text-xs font-bold text-[#0A4174]">Attendance System</div>
              <p className="mt-1 text-[11px] text-[#49769F]">Anti-proxy check-in &amp; live compliance tracking.</p>
            </div>

            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-4 text-left shadow-sm backdrop-blur-md">
              <div className="text-xl font-black text-[#001D39] sm:text-2xl">Multi-Tenant</div>
              <div className="text-xs font-bold text-[#0A4174]">Data Sovereignty</div>
              <p className="mt-1 text-[11px] text-[#49769F]">Row-level isolation &amp; role-based security.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Official Campus Portals Section ──────────────────────────────────────── */}
      <section id="portals" className="border-t border-[#b3d4ea]/60 bg-white/40 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <span className="text-xs font-bold tracking-wider text-[#0A4174] uppercase">
              Unified Campus Access
            </span>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-[#001D39] sm:text-3xl">
              Official Portals &amp; Workspaces
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[#49769F]">
              Dedicated, role-governed digital workspaces tailored for students, faculty, academic
              deans, and chancellery administrators.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Student Portal */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#b3d4ea] bg-white/80 p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-[#7BBDE8] hover:shadow-md">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-tr from-[#001D39] to-[#0A4174] text-xl text-white shadow-sm">
                    🎓
                  </span>
                  <span className="rounded-md bg-[#0A4174]/10 px-2 py-0.5 text-[10px] font-bold text-[#0A4174] uppercase">
                    Learner
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#001D39]">Student Learning Portal</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                  Access enrolled course offerings, interactive syllabus modules, assignment dropboxes,
                  proctored quizzes, and real-time attendance compliance.
                </p>
                <ul className="mt-4 space-y-2 border-t border-[#b3d4ea]/50 pt-3 text-xs text-[#001D39]">
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Registered Course Offerings
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Assignments &amp; Quizzes
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Attendance &amp; Check-In Tokens
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Gradebook Transcripts
                  </li>
                </ul>
              </div>
              <div className="mt-6 border-t border-[#b3d4ea]/50 pt-4">
                <Link
                  href="/student"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#001D39] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#0A4174]"
                >
                  Access Student Portal
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Faculty Workspace */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#b3d4ea] bg-white/80 p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-[#7BBDE8] hover:shadow-md">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-tr from-[#0A4174] to-[#49769F] text-xl text-white shadow-sm">
                    👨‍🏫
                  </span>
                  <span className="rounded-md bg-[#0A4174]/10 px-2 py-0.5 text-[10px] font-bold text-[#0A4174] uppercase">
                    Instruction
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#001D39]">Faculty Workspace</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                  Structure lesson plans, publish resources, conduct automated attendance check-ins, author
                  question banks, and evaluate outcome attainment.
                </p>
                <ul className="mt-4 space-y-2 border-t border-[#b3d4ea]/50 pt-3 text-xs text-[#001D39]">
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Course &amp; Unit Lesson Delivery
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Dynamic Attendance Check-In
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Question Bank &amp; Exam Builder
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    OBE Course Outcome Mapping
                  </li>
                </ul>
              </div>
              <div className="mt-6 border-t border-[#b3d4ea]/50 pt-4">
                <Link
                  href="/faculty"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#001D39] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#0A4174]"
                >
                  Open Faculty Suite
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Admin Console */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#b3d4ea] bg-white/80 p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-[#7BBDE8] hover:shadow-md">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-tr from-[#49769F] to-[#4E8EA2] text-xl text-white shadow-sm">
                    🏢
                  </span>
                  <span className="rounded-md bg-[#0A4174]/10 px-2 py-0.5 text-[10px] font-bold text-[#0A4174] uppercase">
                    Governance
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#001D39]">Institution Admin</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                  Configure academic years, departments, programmes, cohorts, room allocations, conflict-free
                  timetables, and institutional user rosters.
                </p>
                <ul className="mt-4 space-y-2 border-t border-[#b3d4ea]/50 pt-3 text-xs text-[#001D39]">
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Academic Structure &amp; Cohorts
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Conflict-Free Timetable Grids
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Lecture Halls &amp; Room Logistics
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Bulk CSV User Provisioning
                  </li>
                </ul>
              </div>
              <div className="mt-6 border-t border-[#b3d4ea]/50 pt-4">
                <Link
                  href="/admin"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#001D39] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#0A4174]"
                >
                  Access Admin Console
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Platform Super Admin */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#b3d4ea] bg-white/80 p-6 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-[#7BBDE8] hover:shadow-md">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-tr from-[#001D39] via-[#0A4174] to-[#7BBDE8] text-xl text-white shadow-sm">
                    🌐
                  </span>
                  <span className="rounded-md bg-[#0A4174]/10 px-2 py-0.5 text-[10px] font-bold text-[#0A4174] uppercase">
                    Multi-Campus
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#001D39]">Platform Operations</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                  Enterprise-grade governance for university chancellery and platform operators managing
                  multi-tenant institutions and cloud health.
                </p>
                <ul className="mt-4 space-y-2 border-t border-[#b3d4ea]/50 pt-3 text-xs text-[#001D39]">
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Multi-Tenant Campus Provisioning
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Centralized Audit Log Trails
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    System Telemetry &amp; Liveness
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    Global Policy Enforcement
                  </li>
                </ul>
              </div>
              <div className="mt-6 border-t border-[#b3d4ea]/50 pt-4">
                <Link
                  href="/platform"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#001D39] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#0A4174]"
                >
                  Platform Command
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Key Academic Pillars / Modules Section ───────────────────────────────── */}
      <section id="modules" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <span className="text-xs font-bold tracking-wider text-[#0A4174] uppercase">
              Core Capabilities
            </span>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-[#001D39] sm:text-3xl">
              Enterprise Academic Infrastructure
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[#49769F]">
              Designed specifically for higher education compliance, accreditation, and daily operational excellence.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Module 1: OBE */}
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0A4174]/15 text-[#0A4174]">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-[#001D39]">
                Outcome-Based Education (OBE)
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                Full Bloom&apos;s Taxonomy alignment. Define Program Educational Objectives (PEOs), Program
                Outcomes (POs), and Course Outcomes (COs) with automated attainment matrices for NBA &amp;
                NAAC accreditation.
              </p>
            </div>

            {/* Module 2: Conflict-Free Timetable */}
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0A4174]/15 text-[#0A4174]">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-[#001D39]">
                Conflict-Free Timetable Engine
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                Multi-grid weekly scheduling preventing instructor clashes, cohort overlaps, and venue
                double-bookings with full room capacity enforcement and dynamic calendar integration.
              </p>
            </div>

            {/* Module 3: Dynamic Attendance */}
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0A4174]/15 text-[#0A4174]">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-[#001D39]">
                Anti-Proxy Attendance &amp; Tokens
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                Generate secure, time-sensitive numeric or QR check-in tokens per teaching session. Real-time
                attendance percentage monitoring and automated alerts for students below mandatory thresholds.
              </p>
            </div>

            {/* Module 4: Gradebook */}
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0A4174]/15 text-[#0A4174]">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-[#001D39]">
                Criterion Gradebook &amp; Transcripts
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                Configurable weighted assessment categories (CIE, midterm, end-semester, practicals) with
                automatic grade curve distribution, tamper-evident audit trails, and official grade release.
              </p>
            </div>

            {/* Module 5: Assessment & Question Banks */}
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0A4174]/15 text-[#0A4174]">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-[#001D39]">
                Question Banks &amp; Online Examinations
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                Categorize questions by cognitive difficulty and Course Outcome. Assemble timed quizzes,
                randomize questions, auto-grade objective tests, and grade subjective questions with custom rubrics.
              </p>
            </div>

            {/* Module 6: Campus Communication */}
            <div className="rounded-2xl border border-[#b3d4ea]/80 bg-white/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0A4174]/15 text-[#0A4174]">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold text-[#001D39]">
                Targeted Campus Communications
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#49769F]">
                Course-specific announcements, threaded academic discussion boards, direct faculty-student
                messaging channels, and background reminder queues for impending assignment deadlines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Institutional Governance & Security Strip ────────────────────────────── */}
      <section id="accreditation" className="border-y border-[#0A4174]/30 bg-[#001D39] px-4 py-12 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="rounded-md bg-[#7BBDE8]/20 px-2.5 py-1 text-xs font-bold text-[#7BBDE8] uppercase">
                Institutional Assurance &amp; Compliance
              </span>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Engineered for Academic Rigor and Enterprise Security
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#BDD8E9]/80">
                Autonomous colleges and universities demand stringent data boundaries. Apex Campus Cloud
                is built upon strict PostgreSQL row-level isolation, fail-closed permission checks, and
                immutable transactional audit trails.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-[#0A4174] bg-[#001122]/60 p-4">
                <div className="text-lg font-bold text-[#7BBDE8]">Tenant Isolation</div>
                <p className="mt-1 text-xs text-[#BDD8E9]/70">
                  Autonomous data stores per institution with strict cross-tenant isolation.
                </p>
              </div>

              <div className="rounded-xl border border-[#0A4174] bg-[#001122]/60 p-4">
                <div className="text-lg font-bold text-[#7BBDE8]">Role-Based Access</div>
                <p className="mt-1 text-xs text-[#BDD8E9]/70">
                  Granular permission checks separating platform, administrative, faculty, and student scopes.
                </p>
              </div>

              <div className="rounded-xl border border-[#0A4174] bg-[#001122]/60 p-4">
                <div className="text-lg font-bold text-[#7BBDE8]">Audit Trail</div>
                <p className="mt-1 text-xs text-[#BDD8E9]/70">
                  Immutable event ledger logging grades, attendance revisions, and governance actions.
                </p>
              </div>

              <div className="rounded-xl border border-[#0A4174] bg-[#001122]/60 p-4">
                <div className="text-lg font-bold text-[#7BBDE8]">Accreditation Ready</div>
                <p className="mt-1 text-xs text-[#BDD8E9]/70">
                  Standardized metrics ready for NBA, NAAC, and international accreditation audits.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Official Institutional Footer ────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-[#b3d4ea]/70 bg-white/80 px-4 pt-12 pb-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {/* Col 1: Platform Info */}
            <div>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-lg bg-[#001D39] text-sm text-white"
                >
                  🏛️
                </span>
                <span className="text-sm font-bold text-[#001D39]">APEX CAMPUS CLOUD</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#49769F]">
                The complete higher education enterprise academic management ecosystem. Powering
                institutional governance, digital learning, and accreditation compliance.
              </p>
            </div>

            {/* Col 2: Campus Portals */}
            <div>
              <p className="text-xs font-bold tracking-wider text-[#001D39] uppercase">
                Campus Portals
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                <li>
                  <Link href="/student" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Student Learning Portal
                  </Link>
                </li>
                <li>
                  <Link href="/faculty" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Faculty Academic Workspace
                  </Link>
                </li>
                <li>
                  <Link href="/admin" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Institutional Administration
                  </Link>
                </li>
                <li>
                  <Link href="/platform" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Platform Super Admin
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 3: Academic Operations */}
            <div>
              <p className="text-xs font-bold tracking-wider text-[#001D39] uppercase">
                Academic Operations
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                <li>
                  <Link href="/calendar" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Institutional Academic Calendar
                  </Link>
                </li>
                <li>
                  <a href="#modules" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    OBE Curriculum &amp; CO-PO Framework
                  </a>
                </li>
                <li>
                  <a href="#modules" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Conflict-Free Scheduling Matrix
                  </a>
                </li>
                <li>
                  <Link href="/select-institution" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Institution Switcher &amp; Directory
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 4: System & Governance */}
            <div>
              <p className="text-xs font-bold tracking-wider text-[#001D39] uppercase">
                Governance &amp; Support
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                <li>
                  <a href="/api/health" className="flex items-center gap-1.5 text-[#49769F] transition-colors hover:text-[#001D39]">
                    <span className="size-1.5 rounded-full bg-[#0d9488]" />
                    System Status &amp; Telemetry
                  </a>
                </li>
                <li>
                  <a href="#accreditation" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Accreditation &amp; Compliance Standards
                  </a>
                </li>
                <li>
                  <Link href="/sign-in" className="text-[#49769F] transition-colors hover:text-[#001D39]">
                    Institution Account Sign In
                  </Link>
                </li>
                <li>
                  <span className="text-[11px] text-[#49769F]/80">
                    Enterprise Edition v2.4 (HigherEd)
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-[#b3d4ea]/60 pt-6 text-xs text-[#49769F] sm:flex-row">
            <p>© 2026 Apex Campus Cloud · Higher Education Academic ERP &amp; LMS. All rights reserved.</p>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-[#0A4174] font-medium">Outcome-Based Education Certified</span>
              <span>·</span>
              <span>Multi-Tenant Architecture</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
