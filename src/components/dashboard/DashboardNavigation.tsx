import {
  ActivityIcon,
  BotIcon,
  BookOpenIcon,
  CoinsIcon,
  TerminalSquareIcon,
  WrenchIcon,
} from "lucide-react"
import { NavLink } from "react-router"

import {
  dashboardPages,
  dashboardSearchForPage,
  type DashboardPageId,
} from "@/lib/dashboard-url"
import { cn } from "@/lib/utils"

const icons = {
  overview: ActivityIcon,
  costs: CoinsIcon,
  sessions: TerminalSquareIcon,
  models: BotIcon,
  tools: WrenchIcon,
  skills: BookOpenIcon,
}

interface DashboardNavigationProps {
  label: string
  labels: Record<DashboardPageId, string>
  search: string
}

export function DashboardNavigation({
  label,
  labels,
  search,
}: DashboardNavigationProps) {
  return (
    <nav aria-label={label} className="w-full overflow-x-auto pb-1 sm:w-fit">
      <div className="flex h-auto min-w-max items-center justify-start gap-3 text-muted-foreground sm:h-8 sm:gap-5">
        {dashboardPages.map(({ id, path }) => {
          const Icon = icons[id]
          return (
            <NavLink
              key={id}
              to={{
                pathname: path,
                search: dashboardSearchForPage(search, id),
              }}
              end={path === "/"}
              className={({ isActive }) =>
                cn(
                  "relative inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all after:absolute after:inset-x-0 after:bottom-[-5px] after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
                  isActive && "text-primary after:opacity-100"
                )
              }
            >
              <Icon aria-hidden="true" />
              {labels[id]}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
