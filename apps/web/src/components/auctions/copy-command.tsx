'use client'

import { CopyIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

// A shell command to run locally, with a copy button.
export function CopyCommand({ command }: { command: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success('Copied the command')
    } catch {
      toast.error('Copying is blocked in this browser.')
    }
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted py-1 pr-1 pl-3 font-mono text-xs">
      <code className="min-w-0 truncate">{command}</code>
      <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={`Copy ${command}`}>
        <CopyIcon aria-hidden="true" />
      </Button>
    </span>
  )
}
