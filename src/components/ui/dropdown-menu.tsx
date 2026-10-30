import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Circle } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuSubTrigger = DropdownPrimitive.SubTrigger;
export const DropdownMenuShortcut = ({ className, ...props }: React.ComponentProps<"span">) => (
    <span
        className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
        {...props}
    />
);
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
    return (
        <DropdownPrimitive.Portal>
            <DropdownPrimitive.Content
                data-slot="dropdown-menu-content"
                sideOffset={sideOffset}
                className={cn(
                    "z-[90] max-h-[min(var(--radix-dropdown-menu-content-available-height,320px),320px)] min-w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none",
                    className,
                )}
                {...props}
            />
        </DropdownPrimitive.Portal>
    );
}
export function DropdownMenuItem({ className, inset, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item> & { inset?: boolean }) {
    return (
        <DropdownPrimitive.Item
            data-slot="dropdown-menu-item"
            className={cn(
                "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4",
                inset && "pl-8",
                className,
            )}
            {...props}
        />
    );
}
export function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
    return (
        <DropdownPrimitive.CheckboxItem
            checked={checked}
            className={cn(
                "relative flex cursor-default items-center rounded-sm py-2 pl-8 pr-2 text-xs outline-none focus:bg-accent data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        >
            <span className="absolute left-2">
                <DropdownPrimitive.ItemIndicator>
                    <Check className="size-4" />
                </DropdownPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownPrimitive.CheckboxItem>
    );
}
export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DropdownPrimitive.RadioItem>) {
    return (
        <DropdownPrimitive.RadioItem
            className={cn(
                "relative flex cursor-default items-center gap-2 rounded-sm py-2 pl-8 pr-2 text-xs outline-none focus:bg-accent data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        >
            <span className="absolute left-2">
                <DropdownPrimitive.ItemIndicator>
                    <Circle className="size-2 fill-current" />
                </DropdownPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownPrimitive.RadioItem>
    );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Label>) {
    return (
        <DropdownPrimitive.Label
            className={cn("px-2 py-1.5 text-xs font-semibold", className)}
            {...props}
        />
    );
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Separator>) {
    return (
        <DropdownPrimitive.Separator
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            {...props}
        />
    );
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.SubContent>) {
    return (
        <DropdownPrimitive.SubContent
            className={cn("z-[95] min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl", className)}
            {...props}
        />
    );
}
