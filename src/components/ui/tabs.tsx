import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";
import { cn } from "@/lib/utils";
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)}
            {...props}
        />
    );
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (
        <TabsPrimitive.Trigger
            data-slot="tabs-trigger"
            className={cn(
                "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground",
                className,
            )}
            {...props}
        />
    );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            data-slot="tabs-content"
            className={cn("min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
            {...props}
        />
    );
}
