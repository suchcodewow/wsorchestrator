import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { listGuidesForPicker } from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";
import { WorkshopEditor } from "../workshop-editor";

export const metadata: Metadata = {
  title: "New workshop",
  robots: { index: false, follow: false },
};

export default async function NewWorkshopPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Not a redirect: for anyone below manager this page simply isn't there, and
  // saying "forbidden" would only advertise it.
  if (!canManageLabGuides(session.user.siteRole)) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/labs"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        All workshops
      </Link>

      <h1 className="mt-6 mb-8 text-2xl font-medium tracking-tight">
        New workshop
      </h1>

      <WorkshopEditor guides={await listGuidesForPicker()} />
    </div>
  );
}
