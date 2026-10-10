import { CircleAlert, LockKeyhole } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function InsecureContext() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <LockKeyhole className="size-4" />
        </span>
        Chismoso
      </h1>
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>
          Este navegador no ofrece un contexto seguro con criptografía web (WebCrypto). Abrí Chismoso desde su
          dirección oficial (HTTPS) con un navegador actualizado.
        </AlertDescription>
      </Alert>
    </main>
  )
}
