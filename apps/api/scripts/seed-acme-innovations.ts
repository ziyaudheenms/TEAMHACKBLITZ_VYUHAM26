/**
 * Adds a realistic, idempotent demo dataset to an existing Acme Innovations
 * organisation. It does not create auth accounts or delete existing data.
 *
 *   bun run seed:acme
 *
 * Set ACME_ORGANISATION_ID to seed a specific Acme tenant when more than one
 * organisation has that name.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const requestedOrgId = process.env.ACME_ORGANISATION_ID;

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!url || !serviceKey) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env).");
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  fail(
    "Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=1 only when this is intentional."
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const IDs = {
  departments: {
    product: "82b5e5ab-b543-4c7e-86c2-1d76bd583a11",
    success: "82b5e5ab-b543-4c7e-86c2-1d76bd583a12",
    growth: "82b5e5ab-b543-4c7e-86c2-1d76bd583a13",
    operations: "82b5e5ab-b543-4c7e-86c2-1d76bd583a14",
  },
  people: {
    elena: "13e5c4e4-1b97-43f3-8b33-0e8cd2a73911",
    marcus: "13e5c4e4-1b97-43f3-8b33-0e8cd2a73912",
    priya: "13e5c4e4-1b97-43f3-8b33-0e8cd2a73913",
    sofia: "13e5c4e4-1b97-43f3-8b33-0e8cd2a73914",
    daniel: "13e5c4e4-1b97-43f3-8b33-0e8cd2a73915",
    aisha: "13e5c4e4-1b97-43f3-8b33-0e8cd2a73916",
  },
  users: {
    elena: "f5ac902e-b63a-45ea-97bd-f36eef3d8c11",
    marcus: "f5ac902e-b63a-45ea-97bd-f36eef3d8c12",
    priya: "f5ac902e-b63a-45ea-97bd-f36eef3d8c13",
    sofia: "f5ac902e-b63a-45ea-97bd-f36eef3d8c14",
    daniel: "f5ac902e-b63a-45ea-97bd-f36eef3d8c15",
    aisha: "f5ac902e-b63a-45ea-97bd-f36eef3d8c16",
    copilot: "f5ac902e-b63a-45ea-97bd-f36eef3d8c17",
  },
  projects: {
    atlas: "ad9ad16e-3cc2-4c85-906f-656575331211",
    signal: "ad9ad16e-3cc2-4c85-906f-656575331212",
    operations: "ad9ad16e-3cc2-4c85-906f-656575331213",
  },
  tasks: {
    scheduling: "5f5c915f-1bd7-4313-b0e4-aeddd9a24111",
    offlineSync: "5f5c915f-1bd7-4313-b0e4-aeddd9a24112",
    launchMetrics: "5f5c915f-1bd7-4313-b0e4-aeddd9a24113",
    interviewSynthesis: "5f5c915f-1bd7-4313-b0e4-aeddd9a24114",
    partnerKit: "5f5c915f-1bd7-4313-b0e4-aeddd9a24115",
    billingSop: "5f5c915f-1bd7-4313-b0e4-aeddd9a24116",
    accessReview: "5f5c915f-1bd7-4313-b0e4-aeddd9a24117",
    launchRehearsal: "5f5c915f-1bd7-4313-b0e4-aeddd9a24118",
  },
  tickets: {
    onboarding: "6b07ef49-10e6-4b3a-a583-e78018753811",
    exports: "6b07ef49-10e6-4b3a-a583-e78018753812",
    billing: "6b07ef49-10e6-4b3a-a583-e78018753813",
  },
  meetings: {
    launch: "09c89d5e-7521-4de2-bf06-56a1fb9c4211",
    customer: "09c89d5e-7521-4de2-bf06-56a1fb9c4212",
  },
  pages: {
    overview: "514bb7f5-b7bf-4ef4-91e4-1cf0bf371411",
    launchBrief: "514bb7f5-b7bf-4ef4-91e4-1cf0bf371412",
    customerInsights: "514bb7f5-b7bf-4ef4-91e4-1cf0bf371413",
    operatingPrinciples: "514bb7f5-b7bf-4ef4-91e4-1cf0bf371414",
  },
  agents: {
    copilot: "0aa949a9-7b68-46d4-9f3d-274c1eea5811",
    researcher: "0aa949a9-7b68-46d4-9f3d-274c1eea5812",
  },
  channels: {
    launch: "0880ed11-b819-49aa-85a3-896481028c11",
    customers: "0880ed11-b819-49aa-85a3-896481028c12",
    leadership: "0880ed11-b819-49aa-85a3-896481028c13",
  },
  messages: {
    launchKickoff: "695db814-5cd4-4a1b-89fe-6846a9f8ca11",
    launchUpdate: "695db814-5cd4-4a1b-89fe-6846a9f8ca12",
    customerTheme: "695db814-5cd4-4a1b-89fe-6846a9f8ca13",
    customerInsight: "695db814-5cd4-4a1b-89fe-6846a9f8ca14",
    leadershipUpdate: "695db814-5cd4-4a1b-89fe-6846a9f8ca15",
  },
} as const;

async function resolveOrganisation() {
  if (requestedOrgId) {
    const { data, error } = await supabase
      .from("organisations")
      .select("id, name, slug")
      .eq("id", requestedOrgId)
      .maybeSingle();
    if (error || !data) fail(`Could not find ACME_ORGANISATION_ID ${requestedOrgId}.`);
    if (data.name !== "Acme Innovations")
      fail("ACME_ORGANISATION_ID does not belong to Acme Innovations.");
    return data;
  }

  const { data, error } = await supabase
    .from("organisations")
    .select("id, name, slug")
    .eq("name", "Acme Innovations");
  if (error) fail(`Could not look up Acme Innovations: ${error.message}`);
  if (!data?.length)
    fail(
      "No Acme Innovations organisation exists. Create the organisation first, then run this seed."
    );
  if (data.length > 1)
    fail(
      "More than one Acme Innovations organisation exists. Set ACME_ORGANISATION_ID to the intended tenant."
    );
  return data[0];
}

async function upsert(table: string, rows: Record<string, unknown>[]) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) fail(`Could not seed ${table}: ${error.message}`);
  console.log(`✔ ${table}: ${rows.length} demo record${rows.length === 1 ? "" : "s"}`);
}

const organisation = await resolveOrganisation();
const orgId = organisation.id;

const { data: owners, error: ownerError } = await supabase
  .from("organisation_members")
  .select("user_id, role, joined_at")
  .eq("organisation_id", orgId)
  .is("left_at", null)
  .in("role", ["owner", "admin"])
  .order("joined_at", { ascending: true })
  .limit(1);
if (ownerError || !owners?.[0]?.user_id) {
  fail("Acme Innovations needs an active owner or admin before it can receive demo data.");
}
const actorId = owners[0].user_id as string;

console.log(`Seeding Acme Innovations (${organisation.slug}) with additive demo data…`);

await upsert("departments", [
  { id: IDs.departments.product, organisation_id: orgId, name: "Product & Engineering" },
  { id: IDs.departments.success, organisation_id: orgId, name: "Customer Success" },
  { id: IDs.departments.growth, organisation_id: orgId, name: "Growth & Partnerships" },
  { id: IDs.departments.operations, organisation_id: orgId, name: "Operations & Finance" },
]);

await upsert("employee_profiles", [
  {
    id: IDs.people.elena,
    organisation_id: orgId,
    user_id: IDs.users.elena,
    first_name: "Elena",
    last_name: "Torres",
    work_email: "elena.torres@acme.example",
    department_id: IDs.departments.product,
    designation: "Chief Executive Officer",
    employment_status: "active",
  },
  {
    id: IDs.people.marcus,
    organisation_id: orgId,
    user_id: IDs.users.marcus,
    first_name: "Marcus",
    last_name: "Lee",
    work_email: "marcus.lee@acme.example",
    department_id: IDs.departments.product,
    designation: "VP, Product & Engineering",
    employment_status: "active",
  },
  {
    id: IDs.people.priya,
    organisation_id: orgId,
    user_id: IDs.users.priya,
    first_name: "Priya",
    last_name: "Nair",
    work_email: "priya.nair@acme.example",
    department_id: IDs.departments.product,
    designation: "Staff Software Engineer",
    employment_status: "active",
  },
  {
    id: IDs.people.sofia,
    organisation_id: orgId,
    user_id: IDs.users.sofia,
    first_name: "Sofia",
    last_name: "Patel",
    work_email: "sofia.patel@acme.example",
    department_id: IDs.departments.success,
    designation: "Head of Customer Success",
    employment_status: "active",
  },
  {
    id: IDs.people.daniel,
    organisation_id: orgId,
    user_id: IDs.users.daniel,
    first_name: "Daniel",
    last_name: "Kim",
    work_email: "daniel.kim@acme.example",
    department_id: IDs.departments.growth,
    designation: "Partnerships Lead",
    employment_status: "active",
  },
  {
    id: IDs.people.aisha,
    organisation_id: orgId,
    user_id: IDs.users.aisha,
    first_name: "Aisha",
    last_name: "Rahman",
    work_email: "aisha.rahman@acme.example",
    department_id: IDs.departments.operations,
    designation: "Finance & Operations Manager",
    employment_status: "active",
  },
]);

await upsert("projects", [
  {
    id: IDs.projects.atlas,
    organisation_id: orgId,
    name: "Atlas Mobile Launch",
    description:
      "Launch Acme's field-operations mobile experience for scheduling, proof of service, and offline work.",
    status: "active",
    created_by: actorId,
  },
  {
    id: IDs.projects.signal,
    organisation_id: orgId,
    name: "Signal Customer Insights",
    description:
      "Turn customer interviews and product telemetry into a reliable renewal-risk and expansion-opportunity workflow.",
    status: "active",
    created_by: actorId,
  },
  {
    id: IDs.projects.operations,
    organisation_id: orgId,
    name: "Operational Excellence Q4",
    description:
      "Strengthen finance operations, access reviews, and repeatable launch readiness across the company.",
    status: "active",
    created_by: actorId,
  },
]);

await upsert("tasks", [
  {
    id: IDs.tasks.scheduling,
    organisation_id: orgId,
    project_id: IDs.projects.atlas,
    title: "Ship the installation scheduling beta",
    description:
      "Complete the scheduler flow, technician capacity rules, and pilot-account handoff.",
    priority: "urgent",
    status: "in_review",
    primary_assignee_id: IDs.users.priya,
    due_date: "2026-11-04T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.offlineSync,
    organisation_id: orgId,
    project_id: IDs.projects.atlas,
    title: "Resolve offline sync conflict handling",
    description:
      "Document and test predictable conflict resolution for technicians returning from low-connectivity sites.",
    priority: "high",
    status: "in_progress",
    primary_assignee_id: IDs.users.priya,
    due_date: "2026-11-07T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.launchMetrics,
    organisation_id: orgId,
    project_id: IDs.projects.atlas,
    title: "Define launch success metrics",
    description:
      "Agree activation, first-job completion, weekly retention, and support-contact targets for the pilot.",
    priority: "high",
    status: "open",
    primary_assignee_id: IDs.users.marcus,
    due_date: "2026-11-05T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.interviewSynthesis,
    organisation_id: orgId,
    project_id: IDs.projects.signal,
    title: "Synthesize ten customer interviews",
    description:
      "Publish the top workflow friction points, quotes, and evidence-backed product opportunities.",
    priority: "high",
    status: "done",
    primary_assignee_id: IDs.users.sofia,
    due_date: "2026-10-30T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.partnerKit,
    organisation_id: orgId,
    project_id: IDs.projects.signal,
    title: "Prepare the partner enablement kit",
    description:
      "Create the co-selling deck, onboarding checklist, and shared lead-registration process.",
    priority: "medium",
    status: "in_progress",
    primary_assignee_id: IDs.users.daniel,
    due_date: "2026-11-10T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.billingSop,
    organisation_id: orgId,
    project_id: IDs.projects.operations,
    title: "Publish monthly billing reconciliation SOP",
    description:
      "Define ownership, deadlines, and exception handling for invoice reconciliation before close.",
    priority: "medium",
    status: "open",
    primary_assignee_id: IDs.users.aisha,
    due_date: "2026-11-08T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.accessReview,
    organisation_id: orgId,
    project_id: IDs.projects.operations,
    title: "Complete Q4 access review",
    description:
      "Validate administrator access, service credentials, and offboarding safeguards across production systems.",
    priority: "urgent",
    status: "blocked",
    primary_assignee_id: IDs.users.marcus,
    due_date: "2026-11-03T17:00:00Z",
    created_by: actorId,
  },
  {
    id: IDs.tasks.launchRehearsal,
    organisation_id: orgId,
    project_id: IDs.projects.atlas,
    title: "Run the launch-day rehearsal",
    description:
      "Test the escalation tree, communications template, support coverage, and rollback decision process.",
    priority: "high",
    status: "open",
    primary_assignee_id: IDs.users.elena,
    due_date: "2026-11-12T17:00:00Z",
    created_by: actorId,
  },
]);

await upsert("tickets", [
  {
    id: IDs.tickets.onboarding,
    organisation_id: orgId,
    ticket_number: "ACME-1042",
    title: "Pilot team cannot complete technician onboarding",
    description:
      "The pilot account reaches the permissions step but cannot assign its first field technician. Customer Success needs a same-day workaround.",
    category: "customer_support",
    priority: "urgent",
    status: "in_progress",
    requester_id: IDs.users.sofia,
    assignee_id: IDs.users.priya,
  },
  {
    id: IDs.tickets.exports,
    organisation_id: orgId,
    ticket_number: "ACME-1045",
    title: "CSV export drops service-location notes",
    description:
      "Operations reported that service-location notes are missing from the weekly account-health export.",
    category: "product",
    priority: "high",
    status: "open",
    requester_id: IDs.users.sofia,
    assignee_id: IDs.users.priya,
  },
  {
    id: IDs.tickets.billing,
    organisation_id: orgId,
    ticket_number: "ACME-1048",
    title: "Partner invoice needs a corrected tax entity",
    description:
      "A launch partner needs the October invoice reissued under the correct billing entity before payment can be processed.",
    category: "billing",
    priority: "medium",
    status: "open",
    requester_id: IDs.users.aisha,
    assignee_id: IDs.users.daniel,
  },
]);

await upsert("meetings", [
  {
    id: IDs.meetings.launch,
    organisation_id: orgId,
    project_id: IDs.projects.atlas,
    title: "Atlas launch readiness review",
    agenda: "Review pilot readiness, open risks, success metrics, and launch-day ownership.",
    meeting_date: "2026-10-29T14:00:00Z",
    minutes_content:
      "The team agreed that the Atlas pilot can proceed once technician onboarding and offline conflict handling are verified. Priya owns the onboarding workaround and sync test plan. Sofia will confirm pilot coverage with the first three accounts. Elena will lead the launch-day escalation call.",
    created_by: actorId,
  },
  {
    id: IDs.meetings.customer,
    organisation_id: orgId,
    project_id: IDs.projects.signal,
    title: "Customer signal synthesis",
    agenda: "Align on recurring customer themes and select the next two experiments.",
    meeting_date: "2026-10-30T10:30:00Z",
    minutes_content:
      "Customer interviews point to three recurring needs: faster technician onboarding, clearer service-location history, and proactive renewal-risk alerts. The team selected CSV note completeness and onboarding time-to-first-job as the next experiments.",
    created_by: actorId,
  },
]);

await upsert("pages", [
  {
    id: IDs.pages.overview,
    organisation_id: orgId,
    title: "Acme Innovations: Company Overview",
    slug: "acme-innovations-company-overview",
    visibility: "internal",
    created_by: actorId,
    content:
      "# Acme Innovations\n\nAcme Innovations builds workflow software for field-service teams. Our platform helps operations leaders schedule work, give technicians a reliable mobile experience, and turn service data into proactive customer outcomes.\n\n## 2026 focus\n\n- Launch Atlas, the mobile workflow experience for field teams.\n- Reduce time-to-first-job for new technicians.\n- Give Customer Success early, evidence-backed renewal-risk signals.\n- Build repeatable finance and access-control operations as the company scales.",
  },
  {
    id: IDs.pages.launchBrief,
    organisation_id: orgId,
    title: "Atlas Mobile Launch Brief",
    slug: "atlas-mobile-launch-brief",
    visibility: "internal",
    created_by: actorId,
    content:
      "# Atlas Mobile Launch Brief\n\n## Goal\nLaunch a reliable field-operations mobile experience for the pilot cohort by 14 November 2026.\n\n## Success measures\n\n- 80% of invited technicians complete onboarding within 24 hours.\n- 70% of pilot technicians complete a first job in their first week.\n- No unresolved P1 issue during the first five business days.\n\n## Current risks\n\nTechnician permission assignment and offline-sync conflict handling are the two launch blockers. Every blocker needs an owner, mitigation, and daily status before launch.",
  },
  {
    id: IDs.pages.customerInsights,
    organisation_id: orgId,
    title: "Customer Insight: Q4 Interview Themes",
    slug: "customer-insight-q4-interview-themes",
    visibility: "internal",
    created_by: actorId,
    content:
      "# Customer Insight: Q4 Interview Themes\n\nTen customer interviews surfaced three repeated friction points:\n\n1. New technicians need to reach their first completed job faster.\n2. Supervisors need service-location notes in operational exports.\n3. Customer Success needs an early-warning view of account engagement and renewal risk.\n\nPrioritise improvements that remove onboarding friction and make operational context dependable.",
  },
  {
    id: IDs.pages.operatingPrinciples,
    organisation_id: orgId,
    title: "Operating Principles",
    slug: "acme-operating-principles",
    visibility: "public",
    created_by: actorId,
    content:
      "# Operating Principles\n\n- Start with the customer workflow, not the feature list.\n- Name a directly responsible owner for every commitment.\n- Prefer measurable learning over untested assumptions.\n- Escalate risks early, with a proposed next step.\n- Build systems that make the next customer and teammate more successful.",
  },
]);

await upsert("agents", [
  {
    id: IDs.agents.copilot,
    organisation_id: orgId,
    name: "Acme Operations Copilot",
    description:
      "Answers grounded questions about Acme's projects, customer commitments, operating principles, and meeting decisions.",
    instructions:
      "Use Acme's internal knowledge, projects, tickets, and meetings to give concise, cited operational answers. Distinguish known facts from open risks.",
    model: "gemini-2.5-flash",
    browser_permission: "B1",
    status: "active",
    created_by: actorId,
  },
  {
    id: IDs.agents.researcher,
    organisation_id: orgId,
    name: "Market Research Assistant",
    description: "Collects read-only external context for product, partner, and customer research.",
    instructions:
      "Use only read-only public web research. Summarise sources, flag uncertainty, and never take external actions.",
    model: "gemini-2.5-flash",
    browser_permission: "B1",
    status: "active",
    created_by: actorId,
  },
]);

await upsert("channels", [
  {
    id: IDs.channels.launch,
    organisation_id: orgId,
    name: "atlas-launch",
    description: "Launch readiness, blockers, and pilot coordination",
    is_private: false,
    created_by: actorId,
  },
  {
    id: IDs.channels.customers,
    organisation_id: orgId,
    name: "customer-voice",
    description: "Interview learnings, support patterns, and product opportunities",
    is_private: false,
    created_by: actorId,
  },
  {
    id: IDs.channels.leadership,
    organisation_id: orgId,
    name: "leadership-updates",
    description: "Weekly company priorities and operating updates",
    is_private: false,
    created_by: actorId,
  },
]);

await upsert("channel_messages", [
  {
    id: IDs.messages.launchKickoff,
    channel_id: IDs.channels.launch,
    sender_id: IDs.users.elena,
    sender_name: "Elena Torres",
    is_ai: false,
    content:
      "Atlas is our top company priority for the next two weeks. Please post blockers with an owner, impact, and proposed next step so we can clear them quickly.",
  },
  {
    id: IDs.messages.launchUpdate,
    channel_id: IDs.channels.launch,
    sender_id: IDs.users.priya,
    sender_name: "Priya Nair",
    is_ai: false,
    content:
      "The onboarding permission path is now reproduced. I am testing the fix alongside the offline-sync conflict cases and will share the pilot checklist tomorrow.",
  },
  {
    id: IDs.messages.customerTheme,
    channel_id: IDs.channels.customers,
    sender_id: IDs.users.sofia,
    sender_name: "Sofia Patel",
    is_ai: false,
    content:
      "The clearest interview theme is time-to-first-job: new technicians need confidence in the workflow before they are left to operate independently.",
  },
  {
    id: IDs.messages.customerInsight,
    channel_id: IDs.channels.customers,
    sender_id: IDs.users.copilot,
    sender_name: "Acme Operations Copilot",
    is_ai: true,
    content:
      "Insight: onboarding speed and dependable service-location context are the strongest repeated themes across the current customer interviews.",
  },
  {
    id: IDs.messages.leadershipUpdate,
    channel_id: IDs.channels.leadership,
    sender_id: IDs.users.elena,
    sender_name: "Elena Torres",
    is_ai: false,
    content:
      "This week's leadership focus: unblock Atlas, turn customer evidence into two testable product bets, and complete the Q4 access review.",
  },
]);

console.log("\nAcme Innovations demo dataset is ready.");
