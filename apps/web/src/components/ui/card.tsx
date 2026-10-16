import { Card as RadixCard } from "@radix-ui/themes";
import { cn } from "@/lib/utils";

/**
 * Radix's Card with the app's spacing: no padding of its own (each card says it with `p-*`), and
 * it does not clip or contain what it holds unless asked (`overflow-hidden`), so popovers,
 * sticky headers and the run panel opened from inside a card keep working. `isolate` keeps the
 * stacking context that `contain` gave, so Radix's background layer stays inside the card.
 */
export function Card({ className, ...props }: React.ComponentProps<typeof RadixCard>) {
  return <RadixCard className={cn("isolate overflow-visible p-0 [contain:none]", className)} {...props}/>;
}
