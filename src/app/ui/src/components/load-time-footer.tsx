'use client'

import { useState, useEffect } from 'react'

/**
 * LoadTimeFooter - Displays dashboard load time in milliseconds
 *
 * AC-1: Display load time in milliseconds in the footer
 * AC-2: Load time measures from navigation start to page interactive
 * AC-3: Style matches existing footer design (app theme)
 */
export function LoadTimeFooter() {
  // AC-1: State for load time in milliseconds
  const [loadTime, setLoadTime] = useState<number | null>(null)

  useEffect(() => {
    // AC-2: Measure from navigation start to page interactive
    const measureLoadTime = () => {
      // Use modern PerformanceNavigationTiming API
      const navigationEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]

      if (navigationEntries.length > 0) {
        const navTiming = navigationEntries[0]
        // domInteractive: when the document becomes interactive
        // startTime: navigation start (typically 0)
        const loadTimeMs = Math.round(navTiming.domInteractive - navTiming.startTime)
        setLoadTime(loadTimeMs)
      }
    }

    // Measure after the component mounts (page is already interactive at this point)
    // Use requestAnimationFrame to ensure we're measuring after paint
    requestAnimationFrame(() => {
      measureLoadTime()
    })
  }, [])

  // Don't render until we have a measurement
  if (loadTime === null) {
    return null
  }

  // AC-3: Style matches existing app design (dark theme, muted text, subtle border)
  return (
    <footer className="flex-shrink-0 border-t border-border bg-background px-4 py-2">
      <div className="flex items-center justify-center">
        <span className="text-xs font-mono text-muted-foreground">
          Load time: {loadTime}ms
        </span>
      </div>
    </footer>
  )
}
