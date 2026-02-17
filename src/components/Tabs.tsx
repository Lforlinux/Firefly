import { createContext, useContext, useState, type ReactNode } from 'react'

type TabsContextValue = { value: string; setValue: (v: string) => void }
export const TabsContext = createContext<TabsContextValue | null>(null)

export function Tabs({
  defaultValue,
  children,
}: {
  defaultValue: string
  children: ReactNode
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className="space-y-4">{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4">
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  children,
  className = '',
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  const ctx = useContext(TabsContext)
  if (!ctx) return null
  const isActive = ctx.value === value
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  const ctx = useContext(TabsContext)
  if (!ctx || ctx.value !== value) return null
  return <div>{children}</div>
}
