import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs",
};

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Docs</h1>
      <p className="mt-4 text-sm text-muted">
        The documentation route is coming. It lands here, inside the app, with a
        sidebar and search.
      </p>
    </div>
  );
}
