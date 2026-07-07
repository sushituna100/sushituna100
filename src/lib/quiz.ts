// Personality quiz — 5 dimensions, Timeleft-style. Answers are 1–5.
export const QUIZ_QUESTIONS = [
  {
    dimension: "Social energy",
    question: "At a party with people you don't know, you usually…",
    low: "Find one person and go deep",
    high: "Work the whole room",
  },
  {
    dimension: "Conversation style",
    question: "Your ideal dinner conversation is…",
    low: "Light, funny and easygoing",
    high: "Big ideas and deep debates",
  },
  {
    dimension: "Spontaneity",
    question: "A friend texts 'free in an hour?' — you…",
    low: "Need plans a week ahead",
    high: "Are already out the door",
  },
  {
    dimension: "Adventure",
    question: "Your perfect weekend looks like…",
    low: "Cozy — books, movies, brunch",
    high: "Out exploring something new",
  },
  {
    dimension: "Group role",
    question: "In a group of friends you tend to be…",
    low: "The listener who keeps everyone close",
    high: "The planner who rallies everyone",
  },
] as const;

export const INTEREST_TAGS = [
  "Hiking",
  "Board games",
  "Live music",
  "Foodie",
  "Fitness",
  "Movies & TV",
  "Books",
  "Travel",
  "Art & museums",
  "Cooking",
  "Sports",
  "Tech",
  "Photography",
  "Volunteering",
  "Trivia",
  "Dancing",
] as const;

export function parseJsonArray<T = string>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
