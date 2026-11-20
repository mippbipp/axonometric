import { cn } from "@axonometric/ui/lib/utils";
import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsPanel as TabsPanelPrimitive,
  TabsTab as TabsTabPrimitive,
} from "@ui-sdk/react/tabs";
import type { ComponentProps } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/**
 * Layered sections, one shown at a time. Pass `value` and `onValueChange` to
 * keep the chosen tab yourself. The arrow keys, Home and End move between
 * tabs, and the tab list is one Tab stop.
 */
function Tabs<Value extends string>({
  className,
  ...props
}: WithClassName<ComponentProps<typeof TabsPrimitive<Value>>>) {
  return (
    <TabsPrimitive<Value>
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: WithClassName<ComponentProps<typeof TabsListPrimitive>>) {
  return (
    <TabsListPrimitive
      className={cn(
        "inline-flex w-fit items-center justify-center rounded-none bg-muted p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8",
        className
      )}
      {...props}
    />
  );
}

function TabsTab({
  className,
  ...props
}: WithClassName<ComponentProps<typeof TabsTabPrimitive>>) {
  return (
    <TabsTabPrimitive
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-none border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/60 transition-all outline-none select-none hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground",
        className
      )}
      {...props}
    />
  );
}

function TabsPanel({
  className,
  ...props
}: WithClassName<ComponentProps<typeof TabsPanelPrimitive>>) {
  return (
    <TabsPanelPrimitive
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTab };
