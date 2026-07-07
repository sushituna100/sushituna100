import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/quiz";
import BottomNav from "@/components/BottomNav";

export const dynamic = "force-dynamic";

function GroupCard({
  group,
  memberCount,
  badge,
}: {
  group: { id: string; name: string; emoji: string; description: string; interests: string };
  memberCount: number;
  badge?: string;
}) {
  return (
    <Link
      href={`/groups/${group.id}`}
      className="card flex items-center gap-4 transition hover:border-brand-200 hover:shadow-md"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-3xl">
        {group.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{group.name}</h3>
          {badge && (
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              {badge}
            </span>
          )}
        </div>
        <p className="truncate text-sm text-neutral-500">{group.description}</p>
        <p className="mt-0.5 text-sm text-neutral-400">
          {memberCount} members · {parseJsonArray<string>(group.interests).slice(0, 3).join(" · ")}
        </p>
      </div>
      <span className="text-neutral-300">›</span>
    </Link>
  );
}

export default async function GroupsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const myInterests = parseJsonArray<string>(user.interests);

  const [myGroups, openGroups] = await Promise.all([
    prisma.friendGroup.findMany({
      where: { memberships: { some: { userId: user.id } } },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.friendGroup.findMany({
      where: { open: true, memberships: { none: { userId: user.id } } },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Surface groups that share your interests first.
  const sortedOpen = [...openGroups].sort((a, b) => {
    const overlap = (g: (typeof openGroups)[number]) =>
      parseJsonArray<string>(g.interests).filter((t) => myInterests.includes(t)).length;
    return overlap(b) - overlap(a);
  });

  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-extrabold">Friend groups</h1>
      <p className="text-sm text-neutral-500">
        The whole point of Mixer — tables that turned into something more.
      </p>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Your groups
        </h2>
        {myGroups.length === 0 ? (
          <div className="card text-center">
            <p className="text-3xl">🫂</p>
            <p className="mt-2 text-sm text-neutral-500">
              No groups yet. Go to a mixer and vote to keep your table going — or ask to join an
              open group below.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {myGroups.map((g) => (
              <GroupCard key={g.id} group={g} memberCount={g._count.memberships} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Open groups looking for members
        </h2>
        {sortedOpen.length === 0 ? (
          <p className="card text-center text-sm text-neutral-500">
            No open groups right now — check back soon!
          </p>
        ) : (
          <div className="space-y-3">
            {sortedOpen.map((g) => {
              const shared = parseJsonArray<string>(g.interests).filter((t) =>
                myInterests.includes(t)
              ).length;
              return (
                <GroupCard
                  key={g.id}
                  group={g}
                  memberCount={g._count.memberships}
                  badge={shared > 0 ? `${shared} shared interest${shared > 1 ? "s" : ""}` : undefined}
                />
              );
            })}
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
