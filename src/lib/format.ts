export interface Formatters {
  compact: (value: number) => string
  number: (value: number) => string
  currency: (value: number) => string
  percent: (value: number) => string
  duration: (value: number) => string
  dateTime: (value: string, seconds?: boolean) => string
  day: (value: string) => string
}

export function createFormatters(locale = "en-US"): Formatters {
  const compactNumber = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const preciseNumber = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  })
  const hours = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  })
  const days = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "day",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  })
  const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  })
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }
  const dateTime = new Intl.DateTimeFormat(locale, dateTimeOptions)
  const preciseDateTime = new Intl.DateTimeFormat(locale, {
    ...dateTimeOptions,
    second: "2-digit",
  })
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  })

  return {
    compact: (value) => compactNumber.format(value),
    number: (value) => preciseNumber.format(value),
    currency: (value) => currency.format(value),
    percent: (value) => percent.format(value),
    duration: (value) => {
      if (!Number.isFinite(value) || value <= 0) return "—"
      if (value < 1_000) return `${Math.round(value)} ms`
      if (value < 60_000) return `${preciseNumber.format(value / 1_000)} s`
      if (value < 3_600_000)
        return `${preciseNumber.format(value / 60_000)} min`
      if (value < 86_400_000) return hours.format(value / 3_600_000)
      return days.format(value / 86_400_000)
    },
    dateTime: (value, seconds = false) => {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return "—"
      const formatter = seconds ? preciseDateTime : dateTime
      return formatter.format(date)
    },
    day: (value) => {
      const date = new Date(`${value}T12:00:00`)
      return Number.isNaN(date.getTime()) ? value : day.format(date)
    },
  }
}
