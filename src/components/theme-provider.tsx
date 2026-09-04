import { useEffect, useState, type ReactNode } from "react"

const STORAGE_KEY = "pi-stats-theme"
type Theme = "dark" | "light"

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark"
    } catch {
      return "dark"
    }
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.classList.toggle("light", theme === "light")
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* Storage can be unavailable. */
    }
  }, [theme])

  useEffect(() => {
    const toggleTheme = (event: KeyboardEvent) => {
      const target = event.target
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== "d" ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            Boolean(target.closest("input, textarea, select"))))
      )
        return
      setTheme((current) => (current === "dark" ? "light" : "dark"))
    }
    window.addEventListener("keydown", toggleTheme)
    return () => window.removeEventListener("keydown", toggleTheme)
  }, [])

  return children
}
