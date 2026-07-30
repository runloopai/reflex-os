/**
 * Player avatar: the uploaded image when set, otherwise an initial on a
 * color derived from the user id (stable across sessions).
 */
const COLORS = [
  'bg-violet-600',
  'bg-emerald-600',
  'bg-sky-600',
  'bg-rose-600',
  'bg-amber-600',
  'bg-teal-600',
  'bg-fuchsia-600',
  'bg-indigo-600',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

export function Avatar({
  userId,
  name,
  avatar,
  size = 24,
}: {
  userId: string;
  name: string;
  avatar?: string;
  size?: number;
}) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={`${name}'s avatar`}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full text-[0.55em] font-bold text-white ${colorFor(userId)}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {(name[0] ?? '?').toUpperCase()}
    </span>
  );
}
