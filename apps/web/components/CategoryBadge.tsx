import { categoryColor, categoryTextColor } from "@/lib/aqi";

export function CategoryBadge({
  category,
  className = "",
}: {
  category: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold leading-tight ${className}`}
      style={{
        backgroundColor: categoryColor(category),
        color: categoryTextColor(category),
      }}
    >
      {category}
    </span>
  );
}
