import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group className="scroll-my-1 p-1" {...props} />
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className="flex min-w-0 flex-1 truncate text-left"
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Trigger.Props, "className"> & { className?: string }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-8 w-full max-w-full cursor-pointer items-center justify-between gap-1.5 overflow-hidden rounded-lg border border-input bg-background px-2.5 text-sm whitespace-nowrap text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="text-muted-foreground" />}
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  align = "start",
  ...props
}: Omit<SelectPrimitive.Popup.Props, "className"> &
  Pick<SelectPrimitive.Positioner.Props, "align"> & { className?: string }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        sideOffset={4}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          className={cn(
            "relative max-h-(--available-height) w-(--anchor-width) min-w-36 overflow-x-hidden overflow-y-auto rounded-lg bg-card text-card-foreground shadow-md ring-1 ring-foreground/10",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Item.Props, "className"> & { className?: string }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-pointer items-center rounded-md py-1 pr-8 pl-1.5 text-sm outline-none select-none focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectScrollUpButton(
  props: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>
) {
  return (
    <SelectPrimitive.ScrollUpArrow
      className="sticky top-0 z-10 flex w-full cursor-pointer items-center justify-center bg-card py-1"
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton(
  props: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>
) {
  return (
    <SelectPrimitive.ScrollDownArrow
      className="sticky bottom-0 z-10 flex w-full cursor-pointer items-center justify-center bg-card py-1"
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
}
