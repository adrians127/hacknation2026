import { Badge } from "@/components/ui/badge";

export function TagList({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="h-auto max-w-full break-all whitespace-normal">
          {tag}
        </Badge>
      ))}
    </span>
  );
}
