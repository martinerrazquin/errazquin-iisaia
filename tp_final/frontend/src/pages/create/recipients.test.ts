import { describe, expect, it } from 'vitest'
import { parseRecipients } from './recipients'

describe('parseRecipients', () => {
  it('splits on commas, semicolons and whitespace, trimming and lowercasing', () => {
    expect(parseRecipients(' BGonzalez, csaul;dlopez\nefuseneco  ')).toEqual({
      ok: true,
      recipients: ['bgonzalez', 'csaul', 'dlopez', 'efuseneco'],
    })
  })

  it.each([
    ['empty', '', 'al menos un destinatario'],
    ['only separators', ' , ; ', 'al menos un destinatario'],
    ['email', 'bgonzalez@corp.example', 'no direcciones de correo'],
    ['duplicate after normalization', 'bgonzalez, BGONZALEZ', 'repetido'],
    ['invalid syntax', 'b!gonzalez', 'no es un nombre de usuario válido'],
  ])('rejects %s', (_name, input, message) => {
    const result = parseRecipients(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })
})
