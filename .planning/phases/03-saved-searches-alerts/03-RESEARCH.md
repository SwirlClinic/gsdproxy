# Phase 3: Saved Searches & Alerts - Research

**Researched:** 2026-02-16
**Domain:** Saved search CRUD, email digest alerts, in-app scheduling
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Saved search creation
- Save from both the search results page ("Save this search" button) and the dashboard ("Create saved search" form)
- Auto-generate name from query/filters, but allow user to rename later
- Unlimited saved searches for paid subscribers; free users cannot save searches
- Alerts are off by default when saving a search -- user explicitly enables

#### Dashboard list view
- Card grid layout for saved searches
- Minimal card content: name, alert on/off toggle, delete button
- Clicking a card navigates to the search page with those filters applied (run the search)
- Empty state: "No saved searches yet" message with CTA button linking to the job search page

#### Alert digest format
- User chooses frequency per saved search: daily, weekly, or instant
- One combined digest email with sections per saved search that has new matches
- Rich job details in email: job title, company, location, salary if available, posted date, and link
- Cap at 10-20 jobs per saved search in the digest, with "View all X matches" link to the site

#### Alert trigger logic
- "New" jobs = results from the most recent scrape run that match the saved search (may include previously sent jobs)
- Skip the email entirely when zero new matches across all saved searches
- In-app scheduler (e.g. node-cron) for triggering digest sends, not external cron

### Claude's Discretion
- Exact card grid responsive breakpoints and spacing
- Email template styling and branding
- Specific node-cron scheduling implementation
- How "instant" frequency is implemented (poll interval vs scrape hook)
- Exact cap number within the 10-20 range for digest jobs

### Deferred Ideas (OUT OF SCOPE)
(None specified)
</user_constraints>

## Summary

Phase 3 adds saved search persistence and email alerts to the job search dashboard. The core technical challenges are: (1) modeling saved searches with their filter criteria as serialized JSON, (2) building a digest email system using Resend + React Email, and (3) implementing an in-app scheduler with node-cron to trigger alert processing. This phase builds on Phase 2's dashboard shell and authentication -- all saved search operations are gated behind paid subscription status.

The stack is well-established: Prisma for data modeling (SavedSearch model with a Json field for filters), Resend v6.9.x for email delivery (100 emails/day free tier), React Email v5.x with @react-email/components for type-safe email templates, and node-cron v4.x for scheduling. The key architectural pattern is a "digest processor" that runs on a cron schedule, queries all users with enabled alerts whose frequency matches the current trigger, re-executes their saved search filters against the jobs table, and sends a single combined email per user via Resend.

**Primary recommendation:** Use a Json column in the SavedSearch model to store the serialized search filters (query, location, etc.), a Prisma enum for alert frequency (OFF, INSTANT, DAILY, WEEKLY), and a `lastAlertedAt` timestamp per saved search for tracking what's been sent. For "instant" alerts, use a scrape-completion hook that triggers alert processing immediately after each scrape run finishes -- this avoids wasteful polling.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| resend | ^6.9.0 | Email delivery API | Official SDK with native TypeScript types, `react` parameter accepts React Email components directly, 100 emails/day free tier. Used across ecosystem with 920K+ weekly downloads via React Email. |
| @react-email/components | ^1.0.7 | Email template components | Unified package containing all React Email components (Html, Head, Body, Container, Section, Row, Column, Text, Heading, Button, Link, Hr, Img, Preview, Tailwind). TypeScript-first with prop types. |
| @react-email/render | ^2.0.4 | Render React components to HTML string | Async `render()` function converts React Email components to email-safe HTML. Required when pre-rendering templates outside of Resend's `react` param. |
| node-cron | ^4.0.0 | In-app cron scheduler | Pure JS scheduler with cron expression syntax. v4 is a full TypeScript rewrite with new options (name, timezone, noOverlap, maxExecutions). 99.1% TypeScript codebase. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| prisma-json-types-generator | latest | Type-safe Json fields in Prisma | Optional. Adds compile-time TypeScript types to Prisma Json fields via schema comments. Use if you want autocomplete on SavedSearch.filters. |
| zod | (already installed) | Runtime validation for filter shapes | Validate saved search filter payloads from API requests before persisting to the Json column. Shared type between API validation and Prisma model. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-cron | cron (kelektiv) | `cron` has native TypeScript types and Luxon DateTime support but more complex API. node-cron v4 is simpler and sufficient for 2-3 scheduled tasks. |
| node-cron | node-schedule | Heavier, supports Date-based scheduling. Overkill for fixed cron expressions. |
| React Email | MJML | MJML produces responsive emails but uses its own markup language, not React. React Email integrates natively with Resend's `react` param. |
| Resend `react` param | Pre-render with @react-email/render + send as `html` | Pre-rendering gives more control (e.g., caching HTML). The `react` param is simpler for most cases. Use pre-render only if you need to cache or log the HTML. |

**Installation:**
```bash
npm install resend @react-email/components @react-email/render node-cron
npm install -D react-email @types/node-cron
```

Note: `react` and `react-dom` are likely already installed from the Next.js app. If not:
```bash
npm install react react-dom
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── email/
│   │   ├── resend.ts              # Resend client singleton
│   │   ├── templates/
│   │   │   └── digest-email.tsx   # Digest email React component
│   │   └── send-digest.ts        # Orchestrates building + sending a digest
│   ├── scheduler/
│   │   ├── cron.ts                # node-cron setup, registers all scheduled jobs
│   │   └── digest-processor.ts   # Alert processing logic (query matches, build digest, send)
│   └── saved-search/
│       ├── filters.ts             # Zod schema for search filters, serialization helpers
│       └── execute.ts             # Re-execute a saved search's filters against the DB
├── app/
│   ├── api/
│   │   └── saved-searches/
│   │       ├── route.ts           # GET (list), POST (create)
│   │       └── [id]/
│   │           ├── route.ts       # DELETE, PATCH (rename, toggle alert, change frequency)
│   │           └── ...
│   └── dashboard/
│       └── saved-searches/
│           └── page.tsx           # Dashboard card grid view
└── ...
```

### Pattern 1: SavedSearch Data Model with Json Filters
**What:** Store the search criteria (query string, location, salary range, etc.) as a serialized JSON object in a Prisma `Json` column. Define a Zod schema that validates the filter shape at the API boundary.

**When to use:** Always for this phase. The filter structure may evolve as new search facets are added, and a Json column avoids schema migrations for every new filter field.

**Example:**
```prisma
// schema.prisma

enum AlertFrequency {
  OFF
  INSTANT
  DAILY
  WEEKLY
}

model SavedSearch {
  id            String         @id @default(cuid())
  userId        String
  name          String
  filters       Json           // { query?: string, location?: string, salary_min?: number, ... }
  alertEnabled  Boolean        @default(false)
  alertFrequency AlertFrequency @default(OFF)
  lastAlertedAt DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([alertEnabled, alertFrequency])
}
```

```typescript
// src/lib/saved-search/filters.ts
import { z } from "zod";

export const savedSearchFiltersSchema = z.object({
  query: z.string().optional(),
  location: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  jobType: z.enum(["full-time", "part-time", "contract", "remote"]).optional(),
  // Add more as needed -- the Json column accommodates new fields without migration
});

export type SavedSearchFilters = z.infer<typeof savedSearchFiltersSchema>;
```

### Pattern 2: Digest Email Processor
**What:** A function triggered by cron (or scrape hook) that processes all users who have enabled alerts matching the current trigger frequency. For each user, it collects all their active saved searches, re-executes each search against the jobs table, and builds a single combined digest email.

**When to use:** Called by the cron scheduler for DAILY/WEEKLY frequencies, and by the scrape-completion hook for INSTANT frequency.

**Example:**
```typescript
// src/lib/scheduler/digest-processor.ts
import { prisma } from "@/lib/prisma";
import { sendDigestEmail } from "@/lib/email/send-digest";
import { executeSearch } from "@/lib/saved-search/execute";
import type { AlertFrequency } from "@prisma/client";

export async function processDigests(frequency: AlertFrequency) {
  // Find all saved searches with this frequency that have alerts enabled
  const searches = await prisma.savedSearch.findMany({
    where: {
      alertEnabled: true,
      alertFrequency: frequency,
    },
    include: { user: true },
  });

  // Group by user -- one email per user
  const byUser = new Map<string, typeof searches>();
  for (const search of searches) {
    const existing = byUser.get(search.userId) ?? [];
    existing.push(search);
    byUser.set(search.userId, existing);
  }

  for (const [userId, userSearches] of byUser) {
    const sections: DigestSection[] = [];

    for (const search of userSearches) {
      const jobs = await executeSearch(search.filters, {
        limit: 15, // Cap within 10-20 range
      });

      if (jobs.length > 0) {
        sections.push({
          searchName: search.name,
          searchId: search.id,
          jobs,
          totalMatches: jobs.length,
        });
      }
    }

    // Skip email if no matches across all searches
    if (sections.length === 0) continue;

    const user = userSearches[0].user;
    await sendDigestEmail({
      to: user.email,
      userName: user.name,
      sections,
    });

    // Update lastAlertedAt for all processed searches
    await prisma.savedSearch.updateMany({
      where: { id: { in: userSearches.map((s) => s.id) } },
      data: { lastAlertedAt: new Date() },
    });
  }
}
```

### Pattern 3: node-cron v4 Scheduler Setup
**What:** Register cron jobs at app startup that trigger digest processing at fixed intervals. Use `cron.schedule()` (auto-starts) for always-on jobs.

**When to use:** During application initialization (e.g., in a layout.tsx server component, or a dedicated startup script).

**Important v4 changes from v3:**
- `schedule()` auto-starts immediately (no `scheduled: false` option)
- Use `createTask()` if you need a task that starts stopped
- Event names use colon notation: `task:started`, `task:stopped`, `task:destroyed`
- Options: `name`, `timezone`, `noOverlap`, `maxExecutions`, `maxRandomDelay`

**Example:**
```typescript
// src/lib/scheduler/cron.ts
import cron from "node-cron";
import { processDigests } from "./digest-processor";

export function startScheduler() {
  // Daily digest: run at 8:00 AM UTC every day
  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] Processing daily digests");
    await processDigests("DAILY");
  }, {
    name: "daily-digest",
    timezone: "UTC",
    noOverlap: true, // Prevent concurrent runs
  });

  // Weekly digest: run at 8:00 AM UTC every Monday
  cron.schedule("0 8 * * 1", async () => {
    console.log("[cron] Processing weekly digests");
    await processDigests("WEEKLY");
  }, {
    name: "weekly-digest",
    timezone: "UTC",
    noOverlap: true,
  });

  console.log("[cron] Scheduler started");
}
```

### Pattern 4: React Email Digest Template
**What:** A React component that renders the combined digest email with sections per saved search, each containing a list of matching jobs with rich details.

**When to use:** Passed to Resend's `react` parameter when sending the digest email.

**Example:**
```tsx
// src/lib/email/templates/digest-email.tsx
import {
  Html, Head, Body, Container, Section, Row, Column,
  Text, Heading, Button, Link, Hr, Preview, Tailwind,
} from "@react-email/components";

interface Job {
  title: string;
  company: string;
  location: string;
  salary?: string;
  postedDate: string;
  url: string;
}

interface DigestSection {
  searchName: string;
  searchId: string;
  jobs: Job[];
  totalMatches: number;
}

interface DigestEmailProps {
  userName: string;
  sections: DigestSection[];
  siteUrl: string;
}

export function DigestEmail({ userName, sections, siteUrl }: DigestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New job matches for your saved searches</Preview>
      <Tailwind>
        <Body className="bg-gray-50 font-sans">
          <Container className="bg-white mx-auto p-6 max-w-[600px]">
            <Heading className="text-xl font-bold text-gray-900">
              Job Alert Digest
            </Heading>
            <Text className="text-gray-600">
              Hi {userName}, here are new matches for your saved searches:
            </Text>

            {sections.map((section) => (
              <Section key={section.searchId} className="mt-6">
                <Heading as="h2" className="text-lg font-semibold text-gray-800">
                  {section.searchName}
                </Heading>

                {section.jobs.map((job, i) => (
                  <Section key={i} className="border-b border-gray-200 py-3">
                    <Link href={job.url} className="text-blue-600 font-medium">
                      {job.title}
                    </Link>
                    <Text className="text-sm text-gray-600 mt-1">
                      {job.company} -- {job.location}
                      {job.salary ? ` -- ${job.salary}` : ""}
                    </Text>
                    <Text className="text-xs text-gray-400">
                      Posted: {job.postedDate}
                    </Text>
                  </Section>
                ))}

                {section.totalMatches > section.jobs.length && (
                  <Button
                    href={`${siteUrl}/search?savedSearch=${section.searchId}`}
                    className="bg-blue-600 text-white px-4 py-2 rounded mt-2"
                  >
                    View all {section.totalMatches} matches
                  </Button>
                )}

                <Hr />
              </Section>
            ))}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
```

### Pattern 5: "Instant" Alerts via Scrape-Completion Hook
**What:** Instead of polling on a short cron interval, trigger instant alert processing immediately after a scrape run completes. The scraper (or scrape orchestrator) calls `processDigests("INSTANT")` as the final step of its pipeline.

**When to use:** For the INSTANT alert frequency. This avoids a short-interval cron (e.g., every 5 minutes) that would run mostly empty.

**Why this over polling:** The user decided "New jobs = results from the most recent scrape run." The scrape run itself is the event that creates new data. Hooking into the scrape completion is the natural trigger point. A poll-based cron would either run too frequently (wasting cycles on empty runs) or too infrequently (defeating the purpose of "instant").

**Example:**
```typescript
// In the scrape orchestrator, after a scrape run completes:
import { processDigests } from "@/lib/scheduler/digest-processor";

async function onScrapeComplete() {
  // Process instant alerts immediately after new jobs are ingested
  await processDigests("INSTANT");
}
```

### Anti-Patterns to Avoid
- **Storing filters as separate columns:** Avoid adding a column for every filter field (query, location, salary, jobType, etc.). This creates migration churn as filters evolve. Use a Json column instead.
- **Sending individual emails per saved search:** The user decided on a combined digest. Never send multiple emails to the same user in one digest cycle.
- **Polling for instant alerts on a short cron:** A 1-minute or 5-minute cron running `processDigests("INSTANT")` when no scrape has happened wastes resources. Use a scrape-completion hook.
- **Not checking subscription status in API routes:** Every saved search mutation (create, toggle alert) must verify the user is a paid subscriber. Free users cannot save searches at all.
- **Sending Resend emails synchronously in the request path:** Digest processing should run asynchronously (cron job or background task), never in response to a user HTTP request.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email HTML rendering | Custom HTML string templates | React Email components + @react-email/render | Email HTML is notoriously fragile across clients. React Email's components handle table-based layouts, client-specific CSS, and dark mode automatically. |
| Cron scheduling | setTimeout/setInterval chains | node-cron v4 | Cron expressions are standard, timezone-aware, and the library handles edge cases (DST transitions, missed ticks). setTimeout drifts over time. |
| Email delivery | Direct SMTP connection | Resend SDK | Deliverability, bounce handling, spam compliance, DKIM/SPF -- Resend handles all of this. |
| Search filter validation | Manual if/else checks | Zod schema validation | Runtime type safety with descriptive errors. The Zod schema doubles as the TypeScript type definition. |

**Key insight:** Email rendering is the most deceptive "I'll just build it" domain. What looks like simple HTML becomes a nightmare of Outlook conditionals, Gmail CSS stripping, and dark mode inversions. React Email exists specifically because hand-rolled email HTML breaks in production.

## Common Pitfalls

### Pitfall 1: Resend Free Tier Rate Limits
**What goes wrong:** The free tier allows 100 emails/day and 3,000 emails/month, with a rate limit of 2 requests/second. If you have many users with daily alerts, you hit limits quickly. Each recipient in a `to` array counts as a separate email.
**Why it happens:** Developers test with 1-2 users and never hit limits. Production with 50+ daily digest users exceeds the free tier on day one.
**How to avoid:** Monitor email volume from the start. Plan for upgrading to Resend Pro ($20/month for 50K emails) when user count grows. For the free tier, process digests sequentially with a small delay between sends to stay under 2 req/s. Consider batching: Resend's batch endpoint sends up to 100 emails per request.
**Warning signs:** 429 errors from Resend API, emails not arriving, "quota exceeded" errors in logs.

### Pitfall 2: Digest Processing Takes Too Long
**What goes wrong:** Processing digests for many users with many saved searches involves N database queries (one per saved search) plus email sending. If this runs in a single synchronous loop, a daily digest job could take minutes.
**Why it happens:** Each saved search re-executes a full query against the jobs table. With 100 users x 5 saved searches each = 500 database queries per digest run.
**How to avoid:** Add database indexes on the jobs table columns commonly used in search filters (title, location, company, postedDate). Process users concurrently with controlled parallelism (e.g., Promise.all with chunks of 10). Use `noOverlap: true` on the cron job to prevent overlapping runs.
**Warning signs:** Digest cron job overlapping with next run, users receiving emails hours late.

### Pitfall 3: "New" Jobs Definition Ambiguity
**What goes wrong:** The user decided "new = results from the most recent scrape run that match the saved search (may include previously sent jobs)." Developers might try to implement deduplication (track which jobs were already sent per search), adding unnecessary complexity.
**Why it happens:** Natural instinct is to only send "new-to-user" jobs. But the user explicitly chose simpler semantics.
**How to avoid:** Follow the decision literally. "New" means "from the most recent scrape." The `lastAlertedAt` field is useful for knowing when the last digest was sent, but it does NOT filter out previously seen jobs. The query simply runs the search filters against current data.
**Warning signs:** Over-engineering with a "sent_jobs" junction table, complex deduplication queries.

### Pitfall 4: node-cron v4 Breaking Changes
**What goes wrong:** Code written for node-cron v3 (the version most tutorials reference) breaks with v4. Specifically: `scheduled: false` and `runOnInit: true` options no longer exist.
**Why it happens:** Most online tutorials and examples reference v3. v4 was released May 2025 with breaking changes.
**How to avoid:** Use `cron.schedule()` for auto-started tasks. Use `cron.createTask()` for tasks that should start stopped. Replace `runOnInit` with an explicit `task.execute()` call after creation. Event names now use colon notation (`task:started` not `task-started`).
**Warning signs:** TypeScript errors about unknown options, tasks not starting, event listeners not firing.

### Pitfall 5: Subscription Check Bypass
**What goes wrong:** A free user finds a way to create saved searches by calling the API directly, bypassing the UI.
**Why it happens:** Subscription check only in the frontend, not in the API route.
**How to avoid:** Check subscription status server-side in every saved search API route handler. Use `auth.api.getSession({ headers })` to get the authenticated user, then verify their subscription status from the database. Return 403 for free users attempting to create saved searches.
**Warning signs:** Free users appearing in the SavedSearch table.

## Code Examples

### Sending a Digest Email via Resend with React Component
```typescript
// src/lib/email/send-digest.ts
import { Resend } from "resend";
import { DigestEmail } from "./templates/digest-email";

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendDigestParams {
  to: string;
  userName: string;
  sections: DigestSection[];
}

export async function sendDigestEmail({ to, userName, sections }: SendDigestParams) {
  const { data, error } = await resend.emails.send({
    from: "Job Alerts <alerts@yourdomain.com>",
    to: [to],
    subject: `${sections.length} saved search${sections.length > 1 ? "es" : ""} have new matches`,
    react: DigestEmail({
      userName,
      sections,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL!,
    }),
  });

  if (error) {
    console.error(`Failed to send digest to ${to}:`, error);
    throw error;
  }

  return data;
}
```

### Saved Search CRUD API Route (Create)
```typescript
// src/app/api/saved-searches/route.ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { savedSearchFiltersSchema } from "@/lib/saved-search/filters";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check paid subscription
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hasSubscription: true },
  });
  if (!user?.hasSubscription) {
    return NextResponse.json(
      { error: "Saved searches require a paid subscription" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const filters = savedSearchFiltersSchema.parse(body.filters);

  const savedSearch = await prisma.savedSearch.create({
    data: {
      userId: session.user.id,
      name: body.name || generateSearchName(filters),
      filters: filters as any, // Prisma Json field accepts plain objects
      alertEnabled: false,      // Alerts off by default per user decision
      alertFrequency: "OFF",
    },
  });

  return NextResponse.json(savedSearch, { status: 201 });
}

function generateSearchName(filters: Record<string, unknown>): string {
  const parts: string[] = [];
  if (filters.query) parts.push(String(filters.query));
  if (filters.location) parts.push(`in ${filters.location}`);
  if (filters.jobType) parts.push(String(filters.jobType));
  return parts.join(" ") || "Untitled Search";
}
```

### Toggle Alert and Set Frequency
```typescript
// src/app/api/saved-searches/[id]/route.ts
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const search = await prisma.savedSearch.findUnique({
    where: { id: params.id },
  });

  if (!search || search.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.alertEnabled !== undefined) {
    updates.alertEnabled = body.alertEnabled;
    // When disabling alerts, reset frequency to OFF
    if (!body.alertEnabled) updates.alertFrequency = "OFF";
  }
  if (body.alertFrequency !== undefined) {
    updates.alertFrequency = body.alertFrequency;
    // When setting a frequency, auto-enable alerts
    if (body.alertFrequency !== "OFF") updates.alertEnabled = true;
  }

  const updated = await prisma.savedSearch.update({
    where: { id: params.id },
    data: updates,
  });

  return NextResponse.json(updated);
}
```

### Executing Saved Search Filters Against Jobs Table
```typescript
// src/lib/saved-search/execute.ts
import { prisma } from "@/lib/prisma";
import type { SavedSearchFilters } from "./filters";

export async function executeSearch(
  filters: SavedSearchFilters,
  options: { limit?: number } = {}
) {
  const where: Record<string, unknown> = {};

  if (filters.query) {
    where.OR = [
      { title: { contains: filters.query, mode: "insensitive" } },
      { company: { contains: filters.query, mode: "insensitive" } },
      { description: { contains: filters.query, mode: "insensitive" } },
    ];
  }
  if (filters.location) {
    where.location = { contains: filters.location, mode: "insensitive" };
  }
  if (filters.salaryMin) {
    where.salaryMax = { gte: filters.salaryMin };
  }
  if (filters.salaryMax) {
    where.salaryMin = { lte: filters.salaryMax };
  }
  if (filters.jobType) {
    where.jobType = filters.jobType;
  }

  return prisma.job.findMany({
    where,
    orderBy: { postedDate: "desc" },
    take: options.limit ?? 15,
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      salaryMin: true,
      salaryMax: true,
      postedDate: true,
      url: true,
    },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `renderAsync()` in React Email | `render()` (async by default) | React Email 5.0 / @react-email/render 2.0 (2025) | All `renderAsync` calls must be replaced with `render`. The function is now async natively. |
| node-cron v3 `scheduled: false` option | node-cron v4 `createTask()` function | v4.0.0 (May 2025) | Tasks auto-start by default with `schedule()`. Use `createTask()` for deferred start. |
| node-cron v3 event names (`task-started`) | node-cron v4 colon notation (`task:started`) | v4.0.0 (May 2025) | Event listener code must update to new naming convention. |
| Separate @react-email/* packages | Unified @react-email/components | 2024 | Single import for all components instead of installing each individually. |
| Resend v4-v5 | Resend v6.9.x | 2025-2026 | 100% TypeScript, stable API surface. Check for any deprecations in upgrade guide. |

**Deprecated/outdated:**
- `renderAsync()` from @react-email/render -- replaced by async `render()` in v2.0
- node-cron `scheduled` and `runOnInit` options -- removed in v4.0.0
- Individual @react-email/section, @react-email/button packages -- consolidated into @react-email/components

## Open Questions

1. **Where does the scheduler run in a Next.js app?**
   - What we know: node-cron needs a long-running Node.js process. Next.js serverless/edge functions don't maintain persistent state.
   - What's unclear: Whether the Next.js app has a custom server, standalone mode, or if cron should run in a separate process.
   - Recommendation: If using `next start` (Node.js server), the scheduler can initialize in a server-side module that runs once on startup (e.g., instrumentation.ts or a custom server entry). If serverless, the scheduler must run as a separate worker process. The planner should determine the deployment model.

2. **Jobs table schema**
   - What we know: The `executeSearch` function queries a jobs table. Phase 3 depends on this table existing from prior work (scraping infrastructure).
   - What's unclear: The exact schema of the jobs table (column names, types). The research assumes `title`, `company`, `location`, `salaryMin`, `salaryMax`, `postedDate`, `url`, `jobType`, and `description` exist.
   - Recommendation: The planner should verify the jobs table schema from the existing codebase or prior phase artifacts and adjust the `executeSearch` function accordingly.

3. **Resend domain verification**
   - What we know: Resend requires domain verification to send from a custom domain. The free tier uses `onboarding@resend.dev` as the sender.
   - What's unclear: Whether the user has a verified domain set up in Resend.
   - Recommendation: Start with Resend's test domain for development. Add domain verification as a deployment task, not a development task.

4. **Existing search page filter state**
   - What we know: The "Save this search" button captures the current search filters from the search results page.
   - What's unclear: How the existing search page manages filter state (URL params, React state, form state). The saved search creation must capture whatever state the search page uses.
   - Recommendation: The planner should inspect the existing search page to determine how filters are represented and ensure the SavedSearch.filters Json column mirrors that structure.

## Sources

### Primary (HIGH confidence)
- [Resend Node.js SDK](https://resend.com/docs/send-with-nodejs) -- Email sending API, `react` parameter, TypeScript types
- [Resend API Reference: Send Email](https://resend.com/docs/api-reference/emails/send-email) -- Full parameter list including `react`, `scheduled_at`, `tags`
- [Resend API Reference: Batch Emails](https://resend.com/docs/api-reference/emails/send-batch-emails) -- Up to 100 emails per batch request
- [Resend Account Quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits) -- 100/day free, 2 req/s rate limit, 4% bounce threshold
- [Resend Pricing](https://resend.com/pricing) -- Free: 100/day, 3K/month; Pro: $20/month, 50K emails
- [resend/resend-node GitHub](https://github.com/resend/resend-node) -- SDK v6.9.2, 100% TypeScript
- [React Email 5.0 Announcement](https://resend.com/blog/react-email-5) -- Tailwind 4, dark mode, 920K weekly downloads, React 19.2 support
- [@react-email/render npm](https://www.npmjs.com/package/@react-email/render) -- v2.0.4, async render(), replaces renderAsync
- [@react-email/components npm](https://www.npmjs.com/package/@react-email/components) -- v1.0.7, unified component package
- [node-cron v4 Migration Guide](https://nodecron.com/migrating-from-v3) -- Breaking changes: removed scheduled/runOnInit, added createTask
- [node-cron Scheduling Options](https://nodecron.com/scheduling-options.html) -- name, timezone, noOverlap, maxExecutions, maxRandomDelay
- [node-cron GitHub](https://github.com/node-cron/node-cron) -- v4.0.0, 99.1% TypeScript
- [Prisma: Working with Json Fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields) -- Json type, filtering, reading/writing

### Secondary (MEDIUM confidence)
- [Better Auth Next.js Integration](https://www.better-auth.com/docs/integrations/next) -- `auth.api.getSession({ headers })` pattern for server-side auth
- [prisma-json-types-generator](https://www.npmjs.com/package/prisma-json-types-generator) -- Compile-time type safety for Prisma Json fields
- [npm-compare: cron vs node-cron vs node-schedule](https://npm-compare.com/cron,node-cron,node-schedule) -- Package comparison

### Tertiary (LOW confidence)
- [FreeCodeCamp: React Email + Resend Tutorial](https://www.freecodecamp.org/news/create-and-send-email-templates-using-react-email-and-resend-in-nextjs/) -- Integration example (verified against official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries verified via npm, official docs, and GitHub. Version numbers confirmed.
- Architecture: HIGH -- Patterns follow established conventions for Prisma + Next.js + email services. Digest processor pattern is well-understood.
- Pitfalls: HIGH -- Rate limits verified from official Resend docs. node-cron v4 breaking changes verified from official migration guide.
- Data model: MEDIUM -- SavedSearch schema is standard Prisma modeling, but exact Jobs table schema is assumed and needs verification.
- Scheduler placement: MEDIUM -- Where node-cron runs in a Next.js app depends on deployment model (not fully determined).

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable domain -- libraries are mature)
