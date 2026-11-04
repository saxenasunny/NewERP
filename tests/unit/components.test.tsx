// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

describe("Button", () => {
  it("defaults to type=button so it never submits a form implicitly", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("calls the handler when enabled and not when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Continue</Button>);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Continue
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("maps variants to distinct classes", () => {
    expect(buttonClasses({ variant: "danger" })).toContain("bg-danger");
    expect(buttonClasses({ variant: "primary" })).toContain("bg-brand-700");
    expect(buttonClasses({ size: "sm" })).toContain("h-8");
  });
});

describe("Input", () => {
  it("associates the label, hint, and error with the control", () => {
    render(
      <Input
        id="learner-id"
        label="Learner ID"
        hint="Institutional identifier"
        error="Required"
        required
      />,
    );
    const input = screen.getByLabelText(/Learner ID/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toContain("learner-id-hint");
    expect(describedBy).toContain("learner-id-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });

  it("omits aria-invalid when valid", () => {
    render(<Input id="email" label="Email" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });
});

describe("Breadcrumbs", () => {
  it("marks the last item as the current page and links earlier items", () => {
    render(
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Courses", href: "/admin" },
          { label: "Course detail" },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Course detail")).toHaveAttribute("aria-current", "page");
  });
});

describe("EmptyState", () => {
  it("renders a heading and description", () => {
    render(<EmptyState title="No submissions" description="Nothing has been submitted yet." />);
    expect(screen.getByRole("heading", { name: "No submissions" })).toBeInTheDocument();
    expect(screen.getByText("Nothing has been submitted yet.")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("always exposes text, not colour alone", () => {
    render(<StatusBadge tone="warning">Late</StatusBadge>);
    expect(screen.getByText("Late")).toBeInTheDocument();
  });
});

describe("Alert", () => {
  it("announces errors assertively and leaves informational alerts static", () => {
    const { rerender } = render(
      <Alert tone="danger" title="Permission denied">
        You cannot release grades.
      </Alert>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");

    rerender(
      <Alert tone="info" title="Information">
        Draft only.
      </Alert>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders a single level-one heading", () => {
    render(<PageHeader title="Institution overview" description="Configure the institution." />);
    expect(screen.getByRole("heading", { level: 1, name: "Institution overview" })).toBeVisible();
  });
});
