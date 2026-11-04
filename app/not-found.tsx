import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-16">
      <h1 className="text-ink text-2xl font-semibold">Page not found</h1>
      <p className="text-ink-muted">The page does not exist, or you do not have access to it.</p>
      <div>
        <Link
          href="/"
          className="bg-brand-700 hover:bg-brand-800 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
