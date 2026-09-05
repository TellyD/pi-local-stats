import { BookOpenIcon, BoxIcon, WrenchIcon } from "lucide-react"

import { useI18n } from "@/lib/i18n"

type EmptyKind = "model" | "session" | "tool" | "skill"

export function EmptyRows({ kind }: { kind: EmptyKind }) {
  const { messages: t } = useI18n()
  const Icon =
    kind === "tool" ? WrenchIcon : kind === "skill" ? BookOpenIcon : BoxIcon
  const title = {
    model: t.noRequests,
    session: t.noSessions,
    tool: t.noTools,
    skill: t.noSkills,
  }[kind]

  return (
    <div className="flex min-h-56 w-full flex-col items-center justify-center gap-2 rounded-xl p-6 text-center text-balance">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-4">
        <Icon />
      </div>
      <div className="font-heading text-sm font-medium tracking-tight">
        {title}
      </div>
      <div className="text-sm/relaxed text-muted-foreground">
        {t.filteredData}
      </div>
    </div>
  )
}
