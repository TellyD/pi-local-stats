import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PaginationProps extends Omit<ComponentProps<"nav">, "children"> {
  page: number
  pageCount: number
  disabled?: boolean
  onPageChange: (page: number) => void
  labels: {
    navigation: string
    previous: string
    next: string
    page: (page: number, pageCount: number) => string
  }
}

function Pagination({
  page,
  pageCount,
  disabled = false,
  onPageChange,
  labels,
  className,
  ...props
}: PaginationProps) {
  if (pageCount <= 1) return null

  const currentPage = Math.min(Math.max(page, 1), pageCount)

  return (
    <nav
      {...props}
      aria-label={labels.navigation}
      className={cn("flex items-center justify-end gap-2 pt-3", className)}
    >
      <span className="mr-1 text-xs text-muted-foreground" aria-live="polite">
        {labels.page(currentPage, pageCount)}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={labels.previous}
        title={labels.previous}
        disabled={disabled || currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={labels.next}
        title={labels.next}
        disabled={disabled || currentPage === pageCount}
        onClick={() => onPageChange(currentPage + 1)}
      >
        <ChevronRightIcon />
      </Button>
    </nav>
  )
}

export { Pagination, type PaginationProps }
