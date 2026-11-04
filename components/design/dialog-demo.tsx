"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function DialogDemo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button onClick={() => setOpen(true)}>Open example dialog</Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Example dialog"
        description="Native dialog: focus stays inside, Escape closes it, and the page behind is inert."
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <p>
          Confirmation dialogs for destructive or bulk actions will use this component once those
          actions exist.
        </p>
      </Dialog>
    </div>
  );
}
