export default function Avatar({
  emoji,
  color,
  size = 44,
}: {
  emoji: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}22`,
        border: `2px solid ${color}55`,
        fontSize: size * 0.5,
      }}
    >
      {emoji}
    </span>
  );
}
