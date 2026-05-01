/// <reference types="vite/client" />

declare global {
  interface Window {
    cowork?: {
      callMcpTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>
      askClaude(prompt: string, data?: unknown[]): Promise<string>
      runScheduledTask(taskId: string): Promise<void>
    }
  }
}

export {}
