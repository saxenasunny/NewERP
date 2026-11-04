// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Publish course"
        description="Learners will see published content."
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      >
        <p>Publishing requires permission.</p>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("opens as a modal with an accessible name and closes via the close button", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(false);

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(dialog?.open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Publish course" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(dialog?.open).toBe(false);
  });

  it("closes when the footer action is used", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.querySelector("dialog")?.open).toBe(false);
  });
});
