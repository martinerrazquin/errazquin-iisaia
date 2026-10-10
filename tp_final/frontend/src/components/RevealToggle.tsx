import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Eye button for blurred values: a toggle button, so the label stays fixed and aria-pressed carries the state. */
export function RevealToggle({ label, revealed, onToggle }: { label: string; revealed: boolean; onToggle: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={revealed} onClick={onToggle}>
      {revealed ? <EyeOff /> : <Eye />}
    </Button>
  )
}

/** Classes that hide a value on a shared or recorded screen while it stays in the page, so copying still works. */
export const BLURRED = 'text-transparent [text-shadow:0_0_7px_var(--color-muted-foreground)] select-none'
