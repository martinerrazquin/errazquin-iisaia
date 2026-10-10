# TP2 - API de app de mensajería simple

Un `openapi.yaml` que describe una API donde los usuarios crean conversaciones y envían mensajes. Todas las conversaciones son grupales, se pueden sumar nuevos miembros pero solo cada uno puede auto-eliminarse de una conversación.

## Cómo se lee

Pegar el contenido de [openapi.yaml](openapi.yaml) en [editor.swagger.io](https://editor.swagger.io). Aparece la documentación navegable del lado derecho, con cada endpoint desplegable.


## Qué hice

Se proporciona el siguiente material:

* `prompts.md`: secuencia de prompts en orden, con razonamiento y contexto del desarrollo.
* `versions/`: directorio con yaml de versiones preliminares. Permite, entre otras cosas, comparar el fuente entre versiones.
* `openapi.yaml`: archivo con la versión final de la especificación.

El juego se realizó en una sola conversación de OpenAI ChatGPT.

## Qué me propuse construir

Una API simple basada en REST para poder describir una app de mensajería que no se base sobre WebSocket. La idea inicial se implementó correctamente sobre el prompt inicial, por lo que se agregó funcionalidad extra para que la conversación no sea un solo mensaje.

## Decisiones de diseño

* Mensajería basada en endpoints tipo REST, sin WebSocket como suele estilarse para este tipo de aplicaciones.
* Uso de SSE para recibir notificaciones, ya que la versión 3.2 de OpenAPI soporta SSE.
* Todas las conversaciones son grupales.
* Cualquier miembro de una conversación puede agregar personas, pero no eliminar: eso lo decide cada uno.

## Qué salió mal y cómo lo corregí

El primer prompt fue muy cuidado, pero en Gemini Canvas no funcionó: no respetaba la versión de OpenAPI (daba 3.1) y el yaml quedaba malformado con texto inyectado como `STREAMING_CHUNK...` sin respetar formato. Ninguna de todas las versiones de Gemini disponibles (3.1 Pro, 3.5 y 3.6 Flash) lo resolvieron. OpenAI ChatGPT (GPT-6 Luna Thinking) hizo la tarea desde el primer prompt, sin errores.