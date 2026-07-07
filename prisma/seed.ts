import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const CITY = "Austin";
const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const AVATARS: [string, string][] = [
  ["🦊", "#f59e0b"], ["🐥", "#10b981"], ["🐼", "#6366f1"], ["🦉", "#8b5cf6"],
  ["🐙", "#ec4899"], ["🦁", "#f97316"], ["🐧", "#0ea5e9"], ["🐨", "#64748b"],
  ["🦄", "#a855f7"], ["🐯", "#eab308"], ["🐸", "#22c55e"], ["🦋", "#06b6d4"],
  ["🐰", "#f43f5e"], ["🐻", "#926a3e"], ["🦈", "#3b82f6"], ["🐢", "#16a34a"],
  ["🦜", "#dc2626"], ["🐬", "#2563eb"], ["🦥", "#a16207"], ["🐝", "#ca8a04"],
];

const PEOPLE = [
  { name: "Maya", age: 27, interests: ["Hiking", "Foodie", "Travel"], personality: [4, 4, 3, 5, 3], bio: "New to Austin, always down for tacos." },
  { name: "Jordan", age: 29, interests: ["Board games", "Trivia", "Movies & TV"], personality: [2, 3, 2, 2, 3], bio: "Board game shelf is out of control." },
  { name: "Priya", age: 25, interests: ["Live music", "Dancing", "Art & museums"], personality: [5, 3, 4, 4, 4], bio: "Will drag you to a show on a Tuesday." },
  { name: "Diego", age: 31, interests: ["Fitness", "Sports", "Cooking"], personality: [4, 2, 4, 4, 5], bio: "Training for my third marathon." },
  { name: "Emma", age: 26, interests: ["Books", "Cooking", "Movies & TV"], personality: [1, 4, 2, 1, 2], bio: "Book club dropout, still reading." },
  { name: "Liam", age: 28, interests: ["Tech", "Board games", "Trivia"], personality: [2, 5, 2, 2, 2], bio: "Ask me about my mechanical keyboard." },
  { name: "Sofia", age: 24, interests: ["Photography", "Travel", "Art & museums"], personality: [3, 4, 4, 5, 3], bio: "Camera roll is 90% golden hour." },
  { name: "Noah", age: 30, interests: ["Hiking", "Fitness", "Photography"], personality: [3, 3, 5, 5, 4], bio: "Greenbelt regular. Dog dad." },
  { name: "Ava", age: 27, interests: ["Foodie", "Cooking", "Volunteering"], personality: [4, 3, 3, 3, 5], bio: "Hosting dinner parties is my love language." },
  { name: "Ethan", age: 33, interests: ["Sports", "Trivia", "Live music"], personality: [5, 2, 4, 3, 4], bio: "Fantasy football commissioner, sorry." },
  { name: "Zoe", age: 23, interests: ["Dancing", "Live music", "Fitness"], personality: [5, 1, 5, 4, 3], bio: "Yes I will teach you the dance." },
  { name: "Marcus", age: 35, interests: ["Books", "Tech", "Movies & TV"], personality: [2, 5, 1, 2, 3], bio: "Sci-fi and espresso enthusiast." },
  { name: "Lily", age: 26, interests: ["Art & museums", "Books", "Volunteering"], personality: [2, 4, 2, 3, 2], bio: "Museum member, gift shop weakness." },
  { name: "Omar", age: 29, interests: ["Foodie", "Travel", "Photography"], personality: [4, 4, 4, 5, 3], bio: "Eating my way around the world." },
  { name: "Grace", age: 28, interests: ["Hiking", "Volunteering", "Cooking"], personality: [3, 3, 3, 4, 4], bio: "Trail snacks connoisseur." },
  { name: "Tyler", age: 25, interests: ["Sports", "Fitness", "Board games"], personality: [4, 2, 5, 4, 4], bio: "Pickup basketball every Sunday." },
  { name: "Nina", age: 32, interests: ["Trivia", "Books", "Live music"], personality: [3, 5, 2, 3, 3], bio: "Reigning trivia champ, fight me." },
  { name: "Kai", age: 27, interests: ["Tech", "Photography", "Travel"], personality: [3, 4, 4, 4, 2], bio: "Remote worker collecting time zones." },
  { name: "Ruby", age: 24, interests: ["Movies & TV", "Dancing", "Foodie"], personality: [5, 2, 4, 3, 4], bio: "A24 apologist and queso expert." },
  { name: "Sam", age: 30, interests: ["Cooking", "Board games", "Hiking"], personality: [3, 3, 3, 3, 3], bio: "Equally happy indoors or outdoors." },
];

async function main() {
  console.log("Clearing existing data…");
  await prisma.message.deleteMany();
  await prisma.groupVote.deleteMany();
  await prisma.groupJoinRequest.deleteMany();
  await prisma.groupMembership.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.matchGroup.deleteMany();
  await prisma.friendGroup.deleteMany();
  await prisma.mixerEvent.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);

  console.log("Creating users…");
  const users = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    users.push(
      await prisma.user.create({
        data: {
          email: `${p.name.toLowerCase()}@example.com`,
          passwordHash,
          name: p.name,
          age: p.age,
          city: CITY,
          bio: p.bio,
          avatarEmoji: AVATARS[i][0],
          avatarColor: AVATARS[i][1],
          personality: JSON.stringify(p.personality),
          interests: JSON.stringify(p.interests),
          onboarded: true,
        },
      })
    );
  }

  const demo = await prisma.user.create({
    data: {
      email: "demo@mixer.app",
      passwordHash,
      name: "Demo",
      age: 28,
      city: CITY,
      bio: "Just here to make some friends!",
      avatarEmoji: "🌟",
      avatarColor: "#7c5cfc",
      personality: JSON.stringify([3, 4, 3, 4, 3]),
      interests: JSON.stringify(["Foodie", "Trivia", "Hiking"]),
      onboarded: true,
    },
  });

  console.log("Creating mixer events…");
  const dinner = await prisma.mixerEvent.create({
    data: {
      title: "Thursday Dinner Mixer",
      type: "dinner",
      emoji: "🍝",
      venue: "Via 313 · South Congress",
      city: CITY,
      startsAt: days(3),
      priceCents: 499,
      capacityPerGroup: 6,
      description:
        "Six strangers, one table, zero pressure. We match you with compatible people and reveal your table the day of dinner.",
    },
  });

  const eventsData = [
    { title: "Saturday Trivia Night", type: "activity", emoji: "🧠", venue: "Radio Coffee & Beer", startsAt: days(5), priceCents: 399, description: "Get matched into a trivia squad and battle it out. Winning team drinks free." },
    { title: "Sunday Hike & Coffee", type: "activity", emoji: "🥾", venue: "Barton Creek Greenbelt", startsAt: days(6), priceCents: 299, description: "Easy 4-mile morning hike with your matched crew, coffee after." },
    { title: "Wine & Paint Night", type: "activity", emoji: "🎨", venue: "The Painted Grape", startsAt: days(8), priceCents: 599, description: "No talent required. Paint something questionable with new friends." },
    { title: "Bowling Social", type: "activity", emoji: "🎳", venue: "Highland Lanes", startsAt: days(10), priceCents: 449, description: "Matched lanes of six. Gutter balls encouraged, bragging optional." },
  ];
  for (const e of eventsData) {
    await prisma.mixerEvent.create({ data: { ...e, city: CITY, capacityPerGroup: 6 } });
  }

  // Confirmed guests on the upcoming dinner so matching has a pool to work with.
  console.log("Reserving seats on the upcoming dinner…");
  for (const u of users.slice(0, 11)) {
    const r = await prisma.reservation.create({
      data: { userId: u.id, eventId: dinner.id, status: "confirmed" },
    });
    await prisma.payment.create({
      data: { userId: u.id, reservationId: r.id, amountCents: dinner.priceCents, cardLast4: "4242" },
    });
  }

  // A past dinner that was already matched — the demo user sat at Table 1.
  console.log("Creating past matched dinner…");
  const pastDinner = await prisma.mixerEvent.create({
    data: {
      title: "Last Thursday's Dinner",
      type: "dinner",
      emoji: "🌮",
      venue: "Suerte · East 6th",
      city: CITY,
      startsAt: days(-4),
      priceCents: 499,
      capacityPerGroup: 6,
      matched: true,
      description: "Tacos and new faces on East 6th.",
    },
  });
  const table1 = await prisma.matchGroup.create({
    data: { eventId: pastDinner.id, name: "Table 1" },
  });
  const tablemates = [users[0], users[1], users[13], users[16], users[19]]; // Maya, Jordan, Omar, Nina, Sam
  for (const u of [demo, ...tablemates]) {
    const r = await prisma.reservation.create({
      data: { userId: u.id, eventId: pastDinner.id, status: "attended", matchGroupId: table1.id },
    });
    await prisma.payment.create({
      data: { userId: u.id, reservationId: r.id, amountCents: pastDinner.priceCents, cardLast4: "4242" },
    });
  }
  const chat: [string, string][] = [
    [users[0].id, "Hey everyone! That was so fun last night 🌮"],
    [users[16].id, "Agreed!! Still thinking about that mole"],
    [users[1].id, "We should do a board game night next"],
    [users[13].id, "I'm in. I'll bring my camera too, that patio was gorgeous"],
    [users[19].id, "Count me in for games. My place has a big table"],
    [users[0].id, "Ok everyone vote to keep this group going so we can plan it!!"],
  ];
  for (const [senderId, body] of chat) {
    await prisma.message.create({ data: { senderId, matchGroupId: table1.id, body } });
  }
  // Two tablemates already voted to keep the group going — demo's vote can tip it.
  await prisma.groupVote.create({ data: { matchGroupId: table1.id, userId: users[0].id, keepGoing: true } });
  await prisma.groupVote.create({ data: { matchGroupId: table1.id, userId: users[1].id, keepGoing: true } });

  // A formed friend group the demo user belongs to.
  console.log("Creating friend groups…");
  const trivia = await prisma.friendGroup.create({
    data: {
      name: "Trivia Titans",
      emoji: "🧠",
      city: CITY,
      description: "Met at a Mixer trivia night, now we defend our title every other Tuesday.",
      interests: JSON.stringify(["Trivia", "Board games", "Foodie"]),
      open: false,
    },
  });
  await prisma.groupMembership.create({ data: { userId: demo.id, groupId: trivia.id, role: "member" } });
  await prisma.groupMembership.create({ data: { userId: users[5].id, groupId: trivia.id, role: "founder" } }); // Liam
  await prisma.groupMembership.create({ data: { userId: users[16].id, groupId: trivia.id } }); // Nina
  await prisma.groupMembership.create({ data: { userId: users[9].id, groupId: trivia.id } }); // Ethan
  const triviaChat: [string, string][] = [
    [users[5].id, "Team — Tuesday. Radio Coffee. 7pm. Be there."],
    [users[16].id, "We're going for the three-peat 🏆"],
    [users[9].id, "I've been studying world capitals all week"],
    [demo.id, "I'll cover the food & music rounds 🙋"],
  ];
  for (const [senderId, body] of triviaChat) {
    await prisma.message.create({ data: { senderId, friendGroupId: trivia.id, body } });
  }

  // Open friend groups people can browse and ask to join.
  const brunch = await prisma.friendGroup.create({
    data: {
      name: "The Brunch Bunch",
      emoji: "🥞",
      city: CITY,
      description: "Sunday brunch crew that grew out of a dinner mixer. We rotate spots weekly and always order too much.",
      interests: JSON.stringify(["Foodie", "Cooking", "Travel"]),
      open: true,
    },
  });
  await prisma.groupMembership.create({ data: { userId: users[8].id, groupId: brunch.id, role: "founder" } }); // Ava
  await prisma.groupMembership.create({ data: { userId: users[4].id, groupId: brunch.id } }); // Emma
  await prisma.groupMembership.create({ data: { userId: users[13].id, groupId: brunch.id } }); // Omar
  await prisma.groupMembership.create({ data: { userId: users[18].id, groupId: brunch.id } }); // Ruby
  await prisma.groupJoinRequest.create({
    data: { userId: users[2].id, groupId: brunch.id, message: "I make a mean mimosa and I'm always hungry 🍳", status: "pending" },
  });
  await prisma.message.create({ data: { senderId: users[8].id, friendGroupId: brunch.id, body: "New spot this Sunday — Bird Bird Biscuit. 10:30?" } });
  await prisma.message.create({ data: { senderId: users[18].id, friendGroupId: brunch.id, body: "Say less 🐔🧈" } });

  const trailblazers = await prisma.friendGroup.create({
    data: {
      name: "Weekend Trailblazers",
      emoji: "⛰️",
      city: CITY,
      description: "Hiking friend group looking for a couple more early risers. All paces welcome, coffee after is mandatory.",
      interests: JSON.stringify(["Hiking", "Fitness", "Photography"]),
      open: true,
    },
  });
  await prisma.groupMembership.create({ data: { userId: users[7].id, groupId: trailblazers.id, role: "founder" } }); // Noah
  await prisma.groupMembership.create({ data: { userId: users[14].id, groupId: trailblazers.id } }); // Grace
  await prisma.groupMembership.create({ data: { userId: users[3].id, groupId: trailblazers.id } }); // Diego

  console.log("Seed complete!");
  console.log("Demo login: demo@mixer.app / password123");
  console.log(`Seeded ${PEOPLE.length + 1} users, 6 events, 3 friend groups.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
