import { notFound } from "next/navigation";
import { readRootSnapshotHtml } from "@/lib/rootSnapshots";

export const dynamic = "force-dynamic";

export default async function RootCatchAllPage({
  params,
}: {
  params: { path: string[] };
}) {
  // `/blog/**` is handled by the dedicated `/blog` routes.
  if (params.path?.[0] === "blog") notFound();

  const html = await readRootSnapshotHtml(params.path);
  if (!html) notFound();

  // Root snapshots are treated as trusted static HTML snapshots of the legacy site.
  return <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}

