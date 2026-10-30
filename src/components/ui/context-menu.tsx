import * as ContextPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
export const ContextMenu = ContextPrimitive.Root;
export const ContextMenuTrigger = ContextPrimitive.Trigger;
export const ContextMenuGroup = ContextPrimitive.Group;
export const ContextMenuSub = ContextPrimitive.Sub;
export const ContextMenuRadioGroup = ContextPrimitive.RadioGroup;
export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.Content>) {
    return (
        <ContextPrimitive.Portal>
            <ContextPrimitive.Content
                data-slot="context-menu-content"
                className={cn(
                    "z-[100] max-h-[70vh] min-w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none",
                    className,
                )}
                {...props}
            />
        </ContextPrimitive.Portal>
    );
}
export function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.Item>) {
    return (
        <ContextPrimitive.Item
            data-slot="context-menu-item"
            className={cn(
                "flex cursor-default select-none items-center gap-2 rounded-sm px-3 py-2 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:size-4",
                className,
            )}
            {...props}
        />
    );
}
export function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.Separator>) {
    return (
        <ContextPrimitive.Separator
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            {...props}
        />
    );
}
export function ContextMenuLabel({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.Label>) {
    return (
        <ContextPrimitive.Label
            className={cn("px-3 py-1.5 text-[10px] font-medium text-muted-foreground", className)}
            {...props}
        />
    );
}
export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof ContextPrimitive.SubTrigger>) {
    return (
        <ContextPrimitive.SubTrigger
            className={cn("flex cursor-default items-center gap-2 rounded-sm px-3 py-2 text-xs outline-none focus:bg-accent", className)}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto size-4" />
        </ContextPrimitive.SubTrigger>
    );
}
export function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextPrimitive.SubContent>) {
    return (
        <ContextPrimitive.SubContent
            className={cn("z-[110] min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl", className)}
            {...props}
        />
    );
}
export function ContextMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof ContextPrimitive.CheckboxItem>) {
    return (
        <ContextPrimitive.CheckboxItem
            className={cn("relative flex items-center gap-2 rounded-sm py-2 pl-8 pr-2 text-xs outline-none focus:bg-accent", className)}
            {...props}
        >
            <span className="absolute left-2">
                <ContextPrimitive.ItemIndicator>
                    <Check className="size-4" />
                </ContextPrimitive.ItemIndicator>
            </span>
            {children}
        </ContextPrimitive.CheckboxItem>
    );
}
