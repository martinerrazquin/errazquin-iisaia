import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Página no encontrada</h1>
      <Button asChild variant="outline">
        <Link to="/">
          <ArrowLeft />
          Volver al inicio
        </Link>
      </Button>
    </section>
  )
}
