import Link from "next/link";

import { Alert } from "@/components/ui/alert";

export function PermissionDenied({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="danger" title="Permission denied">
        {message}
      </Alert>
      <Link href="/dashboard" className="text-brand-800 text-sm font-medium hover:underline">
        Return to your dashboard
      </Link>
    </div>
  );
}
