import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/quiz";
import Avatar from "@/components/Avatar";
import BottomNav from "@/components/BottomNav";
import Chat from "@/components/Chat";
import JoinGroup from "@/components/JoinGroup";
import RequestActions from "@/components/RequestActions";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const group = await prisma.friendGroup.findUnique({
    where: { id: params.id },
    include: {
      memberships: { include: { user: true }, orderBy: { role: "asc" } },
      joinRequests: { where: { status: "pending" }, include: { user: true } },
    },
  });
  if (!group) notFound();

  const isMember = group.memberships.some((m) => m.userId === user.id);
  const myRequest = await prisma.groupJoinRequest.findUnique({
    where: { userId_groupId: { userId: user.id, groupId: group.id } },
  });

  return (
    <main className="px-5 py-8">
      <Link href="/groups" className="text-sm font-semibold text-brand-600">
        ‹ All groups
      </Link>

      <div className="mt-4 text-center">
        <span className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-50 text-5xl">
          {group.emoji}
        </span>
        <h1 className="mt-3 text-2xl font-extrabold">{group.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {group.memberships.length} members · {group.city}
          {group.open ? " · open to new members" : ""}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {parseJsonArray<string>(group.interests).map((tag) => (
            <span key={tag} className="chip border-brand-200 bg-brand-50 text-brand-700">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <p className="card mt-6 text-sm leading-relaxed text-neutral-600">{group.description}</p>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Members
        </h2>
        <div className="space-y-3">
          {group.memberships.map((m) => (
            <div key={m.id} className="card flex items-center gap-3 py-3">
              <Avatar emoji={m.user.avatarEmoji} color={m.user.avatarColor} size={40} />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">
                  {m.user.name}
                  {m.userId === user.id && (
                    <span className="ml-1.5 text-sm font-normal text-neutral-400">(you)</span>
                  )}
                </h3>
                {isMember && <p className="truncate text-sm text-neutral-500">{m.user.bio}</p>}
              </div>
              {m.role === "founder" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                  Founder
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {isMember ? (
        <>
          {group.joinRequests.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
                Join requests
              </h2>
              <div className="space-y-3">
                {group.joinRequests.map((r) => (
                  <div key={r.id} className="card">
                    <div className="flex items-center gap-3">
                      <Avatar emoji={r.user.avatarEmoji} color={r.user.avatarColor} size={40} />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">
                          {r.user.name}
                          <span className="ml-2 text-sm font-normal text-neutral-400">
                            {r.user.age}
                          </span>
                        </h3>
                        <p className="text-sm text-neutral-500">
                          {parseJsonArray<string>(r.user.interests).slice(0, 3).join(" · ")}
                        </p>
                      </div>
                    </div>
                    {r.message && (
                      <p className="mt-2 rounded-xl bg-neutral-50 p-3 text-sm text-neutral-600">
                        “{r.message}”
                      </p>
                    )}
                    <div className="mt-3">
                      <RequestActions groupId={group.id} requestId={r.id} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
              Group chat
            </h2>
            <Chat endpoint={`/api/groups/${group.id}/messages`} currentUserId={user.id} />
          </section>

          <div className="card mt-6 border-brand-100 bg-brand-50/50 text-center">
            <p className="text-sm text-neutral-600">
              Plan your next hangout —{" "}
              <Link href="/home" className="font-semibold text-brand-700">
                book a mixer together ›
              </Link>
            </p>
          </div>
        </>
      ) : (
        <div className="mt-6">
          {myRequest?.status === "pending" ? (
            <div className="card border-amber-200 bg-amber-50 text-center">
              <p className="text-3xl">⏳</p>
              <h3 className="mt-1 font-bold text-amber-800">Request sent</h3>
              <p className="mt-1 text-sm text-amber-700">
                The group will vote on your request — you'll see it here once you're in.
              </p>
            </div>
          ) : myRequest?.status === "declined" ? (
            <p className="card text-center text-sm text-neutral-500">
              This one didn't work out — but there are more groups waiting for you. 💜
            </p>
          ) : group.open ? (
            <JoinGroup groupId={group.id} />
          ) : (
            <p className="card text-center text-sm text-neutral-500">
              This group isn't taking new members right now.
            </p>
          )}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
