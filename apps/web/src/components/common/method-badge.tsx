import { Badge } from "@radix-ui/themes";

type BadgeColor = React.ComponentProps<typeof Badge>["color"];
/** One fixed hue per HTTP method, the same on every screen. */
export const METHOD_COLOR: Record<string, BadgeColor> = { GET: "sky", POST: "jade", PUT: "amber", PATCH: "violet", DELETE: "ruby" };

export function MethodBadge({ method, className, size = "1" }: { method: string; className?: string; size?: "1" | "2" }) {
  return <Badge size={size} variant="soft" color={METHOD_COLOR[method] ?? "gray"} className={className}><span className="font-mono">{method}</span></Badge>;
}
