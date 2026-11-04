import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
      <span className="sr-only">Loading page</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </main>
  );
}
