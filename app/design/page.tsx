import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DialogDemo } from "@/components/design/dialog-demo";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Design system" };

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-ink text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="text-ink-muted text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  // Internal reference page; not part of the product surface.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Design system" }]} />

      <PageHeader
        eyebrow="Development only"
        title="Design system"
        description="Shared components and tokens. Every interactive example below is real; none represents an unbuilt product action."
      />

      <Section
        title="Buttons"
        description="Variants share height, focus ring, and disabled treatment."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section
        title="Form fields"
        description="Labels are always visible; hints and errors are linked with aria-describedby."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Input id="design-name" label="Display name" placeholder="Jordan Rivera" required />
          <Input
            id="design-email"
            label="Institution email"
            type="email"
            hint="Used only for sign-in and notifications."
            placeholder="name@northstar.example"
          />
          <Input
            id="design-invalid"
            label="Learner ID"
            defaultValue="STU-01"
            error="Learner IDs must be at least 6 characters."
          />
          <Select id="design-term" label="Term" defaultValue="2026-1">
            <option value="2026-1">Semester 1, 2026–27</option>
            <option value="2026-2">Semester 2, 2026–27</option>
          </Select>
          <div className="sm:col-span-2">
            <Textarea
              id="design-notes"
              label="Notes"
              hint="Plain text until a sanitised rich-text editor is introduced."
              placeholder="Optional"
            />
          </div>
        </div>
      </Section>

      <Section title="Status badges" description="Status is always written out, never colour-only.">
        <div className="flex flex-wrap gap-2">
          <StatusBadge>Draft</StatusBadge>
          <StatusBadge tone="brand">Published</StatusBadge>
          <StatusBadge tone="success">Graded</StatusBadge>
          <StatusBadge tone="warning">Late</StatusBadge>
          <StatusBadge tone="danger">Overdue</StatusBadge>
          <StatusBadge tone="info">Scheduled</StatusBadge>
        </div>
      </Section>

      <Section title="Alerts" description="Inline feedback for page-level states.">
        <div className="flex flex-col gap-3">
          <Alert tone="info" title="Information">
            Published content is visible to enrolled learners only.
          </Alert>
          <Alert tone="success" title="Saved">
            The draft was saved.
          </Alert>
          <Alert tone="warning" title="Check dates">
            The availability window ends before it starts.
          </Alert>
          <Alert tone="danger" title="Permission denied">
            You do not have permission to release grades for this course.
          </Alert>
        </div>
      </Section>

      <Section
        title="Empty and loading states"
        description="Distinguish “nothing yet” from “still loading”."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <EmptyState
            title="No submissions yet"
            description="Student submissions appear here once the assignment is published."
          />
          <div className="rounded-card border-border bg-surface flex flex-col gap-3 border p-4">
            <p className="text-ink-muted text-sm">Loading skeleton</p>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </Section>

      <Section title="Dialog" description="Native modal with keyboard and backdrop support.">
        <DialogDemo />
      </Section>
    </main>
  );
}
