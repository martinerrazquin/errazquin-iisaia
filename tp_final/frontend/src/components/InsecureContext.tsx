export function InsecureContext() {
  return (
    <main>
      <h1>Chismoso</h1>
      <p role="alert" className="error">
        Este navegador no ofrece un contexto seguro con criptografía web (WebCrypto). Abrí Chismoso desde su
        dirección oficial (HTTPS) con un navegador actualizado.
      </p>
    </main>
  )
}
