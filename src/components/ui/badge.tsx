import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
    "inline-flex w-fit items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 [&>svg]:size-3",
    {
        variants: {
            variant: {
                default: "border-transparent bg-primary text-primary-foreground",
                secondary: "border-border bg-secondary text-secondary-foreground",
                destructive: "border-transparent bg-destructive text-destructive-foreground",
                outline: "border-border text-foreground",
            },
        },
        defaultVariants: { variant: "secondary" },
    },
);

export function Badge({
    className,
    variant,
    asChild = false,
    ...props
}: React.ComponentProps<"div"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : "div";
    return (
        <Comp
            data-slot="badge"
            className={cn(badgeVariants({ variant, className }))}
            {...props}
        />
    );
}
