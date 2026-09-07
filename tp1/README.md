# TP1 - Weirdle

Reversión del juego *Wordle* con variantes para volver loca a la gente. En particular:

* No se puede elegir la letra de forma tradicional, hay que apretar un botón en el momento correcto.
* No se puede borrar una letra, equivocarse implica tener que resetear la palabra.
* Las pistas (colores verde, amarillo y gris) sobre letras de cada intento solo se muestran por un tiempo reducido.

Aunque parecen pocas variaciones, la experiencia suele ser sumamente frustrante.

Se proporciona el siguiente material:

* `prompts.md`: secuencia de prompts en orden, con razonamiento y contexto del desarrollo.
* `screenshots/`: directorio con capturas de pantalla donde se requiera.
* `versions/`: directorio con HTML de versiones preliminares. Permite, entre otras cosas, comparar el código fuente entre versiones.
* `index.html`: archivo con la versión final de Weirdle (v4).

El juego se realizó en una sola conversación de Gemini Canvas.

## Decisiones de diseño

* Tipo de juego.
* Formato para generar frustración en el jugador (incluyendo valores default).
* Opciones de configuración, previendo intentos de cambio ya con el juego "hecho".
* Dada la fama del juego Wordle, no sobreespecificar el estilado y estructura ya que muy probablemente se encuentre en el training set en alguna forma.
* Limitar la lista inicial de palabras posibles para mantener el contexto lo más corto posible.
* Verificación posterior entre versiones vía diffs

## Qué salió mal y cómo se corrigió

Fue prácticamente un one-shot. Hubo dos limitaciones sobre la v1:

* Styling no completaba la pantalla en ancho: corregido en v2.
* Lista de palabras no suficientemente grande: autoimpuesto, corregido en v3.

Además, se encontró un error por el cual una palabra de la lista original no tenía exactamente 5 letras. Para evitar errores futuros en v3 también se agregó un filter por largo de 5 caracteres.

Por último, a raíz de que la lista final no es tan extensiva, se agregó un glosario de palabras incluidas.