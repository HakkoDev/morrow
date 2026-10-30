import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Shadcn-style native select: preserve the OS picker for compact desktop forms.
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
    return (
        <div
            data-slot="native-select-wrapper"
            className="relative inline-flex min-w-0 items-center"
        >
            <select
                data-slot="native-select"
                className={cn(
                    "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                    className,
                )}
                {...props}
            >
                {children}
            </select>
            <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground"
            />
        </div>
    );
}
