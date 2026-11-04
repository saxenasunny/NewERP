import { Alert } from "@/components/ui/alert";

export function PreviewBanner() {
  return (
    <Alert tone="info" title="Design preview">
      This screen shows layout and navigation only. Sign-in and persisted learning records arrive in
      later phases. Nothing here can be created, edited, or saved.
    </Alert>
  );
}
