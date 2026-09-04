import { ActivityIcon, BookOpenIcon, Clock3Icon, ZapIcon } from "lucide-react"

import { SkillsTable } from "@/components/dashboard/DataPanels"
import { MetricCard } from "@/components/dashboard/MetricCard"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export function SkillsPage({
  data,
  rangeLabel,
}: {
  data: StatsResponse
  rangeLabel: string
}) {
  const { messages: t, format } = useI18n()
  const skillUses = data.skills.reduce((total, skill) => total + skill.uses, 0)
  const topSkill = data.skills.toSorted(
    (left, right) => right.uses - left.uses
  )[0]
  const topSkillShare = topSkill && skillUses ? topSkill.uses / skillUses : 0
  const lastUsedSkill = data.skills.toSorted((left, right) =>
    right.lastUsed.localeCompare(left.lastUsed)
  )[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t.activeSkills}
          value={format.number(data.skills.length)}
          detail={rangeLabel}
          icon={BookOpenIcon}
        />
        <MetricCard
          label={t.uses}
          value={format.compact(skillUses)}
          detail={t.skillUsageRule}
          icon={ActivityIcon}
        />
        <MetricCard
          label={t.topSkill}
          value={format.percent(topSkillShare)}
          detail={topSkill?.name ?? t.noActivity}
          icon={ZapIcon}
        />
        <MetricCard
          label={t.lastUsed}
          value={format.dateTime(lastUsedSkill?.lastUsed ?? "")}
          detail={lastUsedSkill?.name ?? t.noActivity}
          icon={Clock3Icon}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t.mostUsedSkills}</CardTitle>
          <CardDescription>{t.skillDetails}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <SkillsTable rows={data.skills} />
        </CardContent>
      </Card>
    </div>
  )
}
