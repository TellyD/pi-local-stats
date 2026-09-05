/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { createFormatters, type Formatters } from "@/lib/format"

const english = {
  pageTitle: "Usage stats · Pi",
  metaDescription: "Local statistics for Pi sessions",
  language: "Language",
  usageLog: "Usage log",
  indexed: (date: string) => `Indexed ${date}`,
  indexPending: "Index pending",
  refresh: "Refresh",
  sync: "Sync",
  period: "Period",
  today: "Today",
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  last90Days: "Last 90 days",
  allTime: "All time",
  allProjects: "All projects",
  allProviders: "All providers",
  allModels: "All models",
  indexSummary: (sessions: string, sessionCount: number) =>
    `${sessions} ${sessionCount === 1 ? "session" : "sessions"}`,
  readingIndex: "Reading index…",
  statsUnavailable: "Statistics unavailable",
  sectionsNavigation: "Statistics sections",
  overview: "Overview",
  costs: "Costs",
  requests: "Requests",
  models: "Models",
  tools: "Tools",
  skills: "Skills",
  errors: "Errors",
  apiEquivalent: "API equivalent",
  perRequest: (value: string) =>
    `${value} per request · excluding subscription`,
  requestCount: (value: string, count: number) =>
    `${value} ${count === 1 ? "request" : "requests"}`,
  tokensRead: (value: string, count: number) =>
    `${value} ${count === 1 ? "token" : "tokens"} read`,
  averageDuration: "Average duration",
  errorPercentage: (value: string) => `${value} errors`,
  activitySignal: "Activity signal",
  dailyRequests: "Daily requests over the selected period.",
  modelFootprint: "Model footprint",
  tokensByModel: "Tokens consumed by model.",
  activeProjects: "Active projects",
  projectDistribution: "Distribution of sessions and API equivalent.",
  sessionsAndTokens: (
    sessions: string,
    sessionCount: number,
    tokens: string,
    tokenCount: number
  ) =>
    `${sessions} ${sessionCount === 1 ? "session" : "sessions"} · ${tokens} ${tokenCount === 1 ? "token" : "tokens"}`,
  mostUsedSkills: "Most used skills",
  skillUsageRule: "At most one use per skill and session.",
  providers: "Providers",
  trafficDistribution: "Distribution of traffic and API equivalent.",
  requestsAndTokens: (
    requests: string,
    requestCount: number,
    tokens: string,
    tokenCount: number
  ) =>
    `${requests} ${requestCount === 1 ? "request" : "requests"} · ${tokens} ${tokenCount === 1 ? "token" : "tokens"}`,
  catalogRates: "Catalog rates over the period",
  averagePerActiveDay: "Average per active day",
  activeDays: (days: string, count: number) =>
    `${days} ${count === 1 ? "day" : "days"} with activity`,
  dailyPeak: "Daily peak",
  noActivity: "No activity",
  apiEquivalentPerDay: "API equivalent per day",
  costEstimate:
    "Estimate based on model catalog rates, excluding subscription.",
  costBySession: "API equivalent by session",
  averageRequestsPerSession: "Requests per session",
  averageTokensPerSession: "Tokens per session",
  averageCostPerSession: "Cost per session",
  sessionCostDetails:
    "Sessions over the selected period. Select a column to sort.",
  activeModels: "Active models",
  providerCount: (value: string, count: number) =>
    `${value} ${count === 1 ? "provider" : "providers"}`,
  topTokens: "Top tokens",
  topCost: "Highest cost",
  modelDetails: "Consumption, cache, and cost by model.",
  hideModel: (model: string) => `Hide ${model}`,
  confirmHideModel: (model: string, provider: string) =>
    `Hide ${model} (${provider}) from global statistics?\n\nIts indexed data will be preserved.`,
  hideModelFailed: "Could not hide the model.",
  showModel: (model: string) => `Show ${model}`,
  showModelFailed: "Could not show the model.",
  hiddenFromStats: "Hidden from global statistics",
  activeTools: "Active tools",
  averageCallsPerTool: (value: string) => `${value} calls on average per tool`,
  topTool: "Top tool",
  errorCount: (value: string, count: number) =>
    `${value} ${count === 1 ? "error" : "errors"}`,
  toolDetails: "Calls observed in sessions and their results.",
  activeSkills: "Active skills",
  topSkill: "Top skill",
  skillDetails: "Actual SKILL.md file reads, deduplicated by session.",
  noRequests: "No requests",
  noSessions: "No sessions",
  unnamedSession: "Unnamed session",
  openSessionTrace: (session: string) => `Analyze ${session}`,
  backToSessions: "Back to sessions",
  sessionTrace: "Session analysis",
  traceScope:
    "Full session · hidden models excluded · metadata only, no message or tool content.",
  showRawTrace: (count: number) =>
    `Show timeline · ${count} ${count === 1 ? "event" : "events"}`,
  hideRawTrace: "Hide timeline",
  evidenceTimeline: "Timeline",
  traceDescription:
    "Select an agent’s bar, an activity group, or a lane’s event count to inspect its events.",
  traceErrorsByType: "Failures by event type",
  traceRequestErrors: (count: number) =>
    `${count} failed ${count === 1 ? "request" : "requests"}`,
  traceToolErrors: (count: number) =>
    `${count} failed tool ${count === 1 ? "call" : "calls"}`,
  traceFailedAgents: (count: number) =>
    `${count} failed ${count === 1 ? "agent" : "agents"}`,
  traceShowAll: "Show all events",
  traceSelectedEvents: (count: number) => `${count} selected events`,
  traceEventList: "Events in selection",
  traceScrollableTimeline: "Scrollable timeline",
  traceLaneEvents: (label: string, count: number) =>
    `Inspect ${count} events in ${label}`,
  traceLaneCost: (label: string, cost: string, share: string | null) =>
    `Cost accounted to ${label}: ${cost}${share ? ` (${share} of the total)` : ""}`,
  traceLaneCostUnknown: (label: string) =>
    `${label} reports tokens but no priced cost; it counts as zero in the session total`,
  traceCostCoverage: (count: number, tokens: string) =>
    `The session total excludes ${count} ${count === 1 ? "agent" : "agents"} with ${tokens} tokens but no priced cost, so shares of the total are not shown.`,
  traceUntimedEvents: (count: number) => `${count} events without timing`,
  traceGap: "Gap without timed events; may be a pause or missing timing data",
  traceLegend: "Timeline legend",
  mainSession: "Pi session",
  idleTimeCompressed:
    "Unobserved gaps are compressed to keep activity readable",
  showMoreAgents: (count: number) =>
    `Show ${count} more ${count === 1 ? "agent" : "agents"}`,
  showFewerAgents: "Show fewer agents",
  activityBucket: (requests: number, tools: number, errors: number) => {
    const activity = `${requests} ${requests === 1 ? "request" : "requests"} · ${tools} ${tools === 1 ? "tool" : "tools"}`
    if (!errors) return activity
    return `${activity} · ${errors} ${errors === 1 ? "error" : "errors"}`
  },
  traceRequest: "Request",
  traceTool: "Tool",
  traceError: "Error",
  traceAgentFailed: "Failed",
  traceNotAccounted: "Not included in the session total",
  traceDetails: "Selected event",
  traceNoEvents: "No visible events for this session.",
  timingUnavailable: "Timing unavailable",
  includedInTotal: "Included in the session total",
  started: "Started",
  status: "Status",
  observedDuration: "Observed duration",
  observedDurationDetail:
    "Elapsed time between the first and last observed event.",
  requestMetricDetail: "Model requests recorded in this session.",
  tokenMetricDetail: "Tokens accounted to this session.",
  costMetricDetail: "API-equivalent estimate from recorded usage.",
  sortBy: (column: string) => `Sort by ${column}`,
  showAgentCosts: (session: string) => `Show agent costs for ${session}`,
  hideAgentCosts: (session: string) => `Hide agent costs for ${session}`,
  showAgents: "Show agents",
  hideAgents: "Hide agents",
  showAccountingDetails: "Show accounting details",
  hideAccountingDetails: "Hide accounting details",
  agent: "Agent",
  tokenCount: (value: string, count: number) =>
    `${value} ${count === 1 ? "token" : "tokens"}`,
  agentUsageUnavailable: "Usage details unavailable",
  agentCostUnavailable: "Cost unavailable",
  agentPrecisionExact: "Exact",
  agentPrecisionReported: "Reported",
  agentPrecisionEstimated: "Estimated",
  agentPrecisionPartial: "Partial",
  agentPrecisionUnknown: "Unknown",
  unassignedAgentUsage: (tokens: string, cost: string) =>
    `Unassigned agent usage: ${tokens} tokens · ${cost}`,
  pagination: "Pagination",
  previousPage: "Previous page",
  nextPage: "Next page",
  pageStatus: (page: number, pageCount: number) =>
    `Page ${page} of ${pageCount}`,
  noTools: "No tools",
  noSkills: "No skills",
  noProject: "No project",
  filteredData: "Data matching the filters will appear here.",
  model: "Model",
  session: "Session",
  date: "Date",
  project: "Project",
  tokens: "Tokens",
  provider: "Provider",
  cache: "Cache",
  tool: "Tool",
  calls: "Calls",
  errorRate: "Error rate",
  uses: "Uses",
  sessions: "Sessions",
  lastUsed: "Last used",
  requestFailed: (status: number) => `Request failed (${status})`,
  syncFailed: "Synchronization failed.",
} as const

type Messages = {
  [Key in keyof typeof english]: (typeof english)[Key] extends (
    ...args: infer Args
  ) => string
    ? (...args: Args) => string
    : string
}

const french: Messages = {
  pageTitle: "Statistiques d’usage · Pi",
  metaDescription: "Statistiques locales des sessions Pi",
  language: "Langue",
  usageLog: "Journal d’usage",
  indexed: (date) => `Indexé ${date}`,
  indexPending: "Index en attente",
  refresh: "Actualiser",
  sync: "Synchroniser",
  period: "Période",
  today: "Aujourd’hui",
  last7Days: "7 derniers jours",
  last30Days: "30 derniers jours",
  last90Days: "90 derniers jours",
  allTime: "Depuis le début",
  allProjects: "Tous les projets",
  allProviders: "Tous les providers",
  allModels: "Tous les modèles",
  indexSummary: (sessions, sessionCount) =>
    `${sessions} session${sessionCount === 1 ? "" : "s"}`,
  readingIndex: "Lecture de l’index…",
  statsUnavailable: "Statistiques indisponibles",
  sectionsNavigation: "Sections des statistiques",
  overview: "Vue d’ensemble",
  costs: "Coûts",
  requests: "Requêtes",
  models: "Modèles",
  tools: "Outils",
  skills: "Skills",
  errors: "Erreurs",
  apiEquivalent: "Équivalent API",
  perRequest: (value) => `${value} par requête · hors abonnement`,
  requestCount: (value, count) => `${value} requête${count === 1 ? "" : "s"}`,
  tokensRead: (value, count) =>
    `${value} token${count === 1 ? " relu" : "s relus"}`,
  averageDuration: "Durée moyenne",
  errorPercentage: (value) => `${value} d’erreurs`,
  activitySignal: "Signal d’activité",
  dailyRequests: "Requêtes quotidiennes sur la période sélectionnée.",
  modelFootprint: "Empreinte des modèles",
  tokensByModel: "Tokens consommés par modèle.",
  activeProjects: "Projets actifs",
  projectDistribution: "Répartition des sessions et de l’équivalent API.",
  sessionsAndTokens: (sessions, sessionCount, tokens, tokenCount) =>
    `${sessions} session${sessionCount === 1 ? "" : "s"} · ${tokens} token${tokenCount === 1 ? "" : "s"}`,
  mostUsedSkills: "Skills les plus utilisés",
  skillUsageRule: "Une utilisation maximum par skill et par session.",
  providers: "Providers",
  trafficDistribution: "Répartition du trafic et de l’équivalent API.",
  requestsAndTokens: (requests, requestCount, tokens, tokenCount) =>
    `${requests} requête${requestCount === 1 ? "" : "s"} · ${tokens} token${tokenCount === 1 ? "" : "s"}`,
  catalogRates: "Tarifs catalogue sur la période",
  averagePerActiveDay: "Moyenne par jour actif",
  activeDays: (days, count) =>
    `${days} jour${count === 1 ? "" : "s"} avec activité`,
  dailyPeak: "Pic journalier",
  noActivity: "Aucune activité",
  apiEquivalentPerDay: "Équivalent API par jour",
  costEstimate:
    "Estimation fondée sur les tarifs catalogue des modèles, hors abonnement.",
  costBySession: "Équivalent API par session",
  averageRequestsPerSession: "Requêtes par session",
  averageTokensPerSession: "Tokens par session",
  averageCostPerSession: "Coût par session",
  sessionCostDetails:
    "Sessions sur la période sélectionnée. Sélectionnez une colonne pour trier.",
  activeModels: "Modèles actifs",
  providerCount: (value, count) => `${value} provider${count === 1 ? "" : "s"}`,
  topTokens: "Top tokens",
  topCost: "Coût maximal",
  modelDetails: "Consommation, cache et coût par modèle.",
  hideModel: (model) => `Masquer ${model}`,
  confirmHideModel: (model, provider) =>
    `Masquer ${model} (${provider}) des statistiques globales ?\n\nSes données indexées seront conservées.`,
  hideModelFailed: "Impossible de masquer le modèle.",
  showModel: (model) => `Réafficher ${model}`,
  showModelFailed: "Impossible de réafficher le modèle.",
  hiddenFromStats: "Masqué des statistiques globales",
  activeTools: "Outils actifs",
  averageCallsPerTool: (value) => `${value} appels en moyenne par outil`,
  topTool: "Outil principal",
  errorCount: (value, count) => `${value} erreur${count === 1 ? "" : "s"}`,
  toolDetails: "Appels observés dans les sessions et résultats associés.",
  activeSkills: "Skills actifs",
  topSkill: "Skill principal",
  skillDetails:
    "Consultations réelles de fichiers SKILL.md, dédupliquées par session.",
  noRequests: "Aucune requête",
  noSessions: "Aucune session",
  unnamedSession: "Session sans nom",
  openSessionTrace: (session) => `Analyser ${session}`,
  backToSessions: "Retour aux sessions",
  sessionTrace: "Analyse de session",
  traceScope:
    "Session entière · modèles masqués exclus · métadonnées seules, sans contenu des messages ou outils.",
  showRawTrace: (count) =>
    `Afficher la chronologie · ${count} événement${count === 1 ? "" : "s"}`,
  hideRawTrace: "Masquer la chronologie",
  evidenceTimeline: "Chronologie",
  traceDescription:
    "Sélectionnez la barre d’un agent, un groupe d’activité ou le compteur d’une ligne pour consulter ses événements.",
  traceErrorsByType: "Échecs par type d’événement",
  traceRequestErrors: (count) =>
    `${count} requête${count === 1 ? "" : "s"} en erreur`,
  traceToolErrors: (count) =>
    `${count} appel${count === 1 ? "" : "s"} d’outil en erreur`,
  traceFailedAgents: (count) =>
    `${count} agent${count === 1 ? "" : "s"} en échec`,
  traceShowAll: "Tout afficher",
  traceSelectedEvents: (count) => `${count} événements sélectionnés`,
  traceEventList: "Événements de la sélection",
  traceScrollableTimeline: "Chronologie défilante",
  traceLaneEvents: (label, count) =>
    `Consulter ${count} événements de ${label}`,
  traceLaneCost: (label, cost, share) =>
    `Coût comptabilisé pour ${label} : ${cost}${share ? ` (${share} du total)` : ""}`,
  traceLaneCostUnknown: (label) =>
    `${label} rapporte des tokens mais aucun coût chiffré ; il compte pour zéro dans le total de la session`,
  traceCostCoverage: (count, tokens) =>
    `Le total de la session exclut ${count} agent${count === 1 ? "" : "s"} avec ${tokens} tokens mais sans coût chiffré ; les parts du total ne sont donc pas affichées.`,
  traceUntimedEvents: (count) => `${count} événements sans timing`,
  traceGap:
    "Intervalle sans événement chronométré : pause possible ou données temporelles manquantes",
  traceLegend: "Légende de la chronologie",
  mainSession: "Session Pi",
  idleTimeCompressed:
    "Les intervalles non observés sont compressés pour garder l’activité lisible",
  showMoreAgents: (count) =>
    `Afficher ${count} agent${count === 1 ? "" : "s"} de plus`,
  showFewerAgents: "Afficher moins d’agents",
  activityBucket: (requests, tools, errors) => {
    const activity = `${requests} requête${requests === 1 ? "" : "s"} · ${tools} outil${tools === 1 ? "" : "s"}`
    if (!errors) return activity
    return `${activity} · ${errors} erreur${errors === 1 ? "" : "s"}`
  },
  traceRequest: "Requête",
  traceTool: "Outil",
  traceError: "Erreur",
  traceAgentFailed: "Échec",
  traceNotAccounted: "Non inclus dans le total de la session",
  traceDetails: "Événement sélectionné",
  traceNoEvents: "Aucun événement visible pour cette session.",
  timingUnavailable: "Timing indisponible",
  includedInTotal: "Inclus dans le total de la session",
  started: "Début",
  status: "Statut",
  observedDuration: "Durée observée",
  observedDurationDetail:
    "Temps écoulé entre le premier et le dernier événement observé.",
  requestMetricDetail: "Requêtes modèle enregistrées dans cette session.",
  tokenMetricDetail: "Tokens comptabilisés dans cette session.",
  costMetricDetail: "Estimation équivalente API issue de l’usage enregistré.",
  sortBy: (column) => `Trier par ${column}`,
  showAgentCosts: (session) => `Afficher le coût des agents de ${session}`,
  hideAgentCosts: (session) => `Masquer le coût des agents de ${session}`,
  showAgents: "Afficher les agents",
  hideAgents: "Masquer les agents",
  showAccountingDetails: "Afficher les détails comptables",
  hideAccountingDetails: "Masquer les détails comptables",
  agent: "Agent",
  tokenCount: (value, count) => `${value} token${count === 1 ? "" : "s"}`,
  agentUsageUnavailable: "Détails d’usage indisponibles",
  agentCostUnavailable: "Coût indisponible",
  agentPrecisionExact: "Exact",
  agentPrecisionReported: "Déclaré",
  agentPrecisionEstimated: "Estimé",
  agentPrecisionPartial: "Partiel",
  agentPrecisionUnknown: "Inconnu",
  unassignedAgentUsage: (tokens, cost) =>
    `Usage agent non attribué : ${tokens} tokens · ${cost}`,
  pagination: "Pagination",
  previousPage: "Page précédente",
  nextPage: "Page suivante",
  pageStatus: (page, pageCount) => `Page ${page} sur ${pageCount}`,
  noTools: "Aucun outil",
  noSkills: "Aucun skill",
  noProject: "Sans projet",
  filteredData: "Les données correspondant aux filtres apparaîtront ici.",
  model: "Modèle",
  session: "Session",
  date: "Date",
  project: "Projet",
  tokens: "Tokens",
  provider: "Provider",
  cache: "Cache",
  tool: "Outil",
  calls: "Appels",
  errorRate: "Taux d’erreur",
  uses: "Utilisations",
  sessions: "Sessions",
  lastUsed: "Dernière utilisation",
  requestFailed: (status) => `La requête a échoué (${status})`,
  syncFailed: "La synchronisation a échoué.",
}

export const DEFAULT_LANGUAGE = "en" as const
export const catalogs = {
  en: { label: "English", locale: "en-US", messages: english },
  fr: { label: "Français", locale: "fr-FR", messages: french },
} satisfies Record<
  string,
  { label: string; locale: string; messages: Messages }
>

export type Language = keyof typeof catalogs

export function resolveLanguage(value: string | null): Language {
  return value && Object.hasOwn(catalogs, value)
    ? (value as Language)
    : DEFAULT_LANGUAGE
}

const STORAGE_KEY = "pi-stats-language"

interface I18nValue {
  language: Language
  setLanguage: (language: Language) => void
  messages: Messages
  format: Formatters
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return resolveLanguage(window.localStorage.getItem(STORAGE_KEY))
    } catch {
      return DEFAULT_LANGUAGE
    }
  })
  const catalog = catalogs[language]
  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      messages: catalog.messages,
      format: createFormatters(catalog.locale),
    }),
    [catalog, language]
  )

  useEffect(() => {
    document.documentElement.lang = language
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", catalog.messages.metaDescription)
    try {
      window.localStorage.setItem(STORAGE_KEY, language)
    } catch {
      /* Storage can be unavailable. */
    }
  }, [catalog, language])

  return <I18nContext value={value}>{children}</I18nContext>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n must be used inside I18nProvider")
  return value
}
