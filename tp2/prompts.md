# Prompts TP 2

## 1) Prompt inicial
```
Provide an openapi.yaml (version 3.2) for a simple messaging app.

resources:
  Conversation {id, title?, participant_ids, created_at, last_message_at?}

  Message {id, conversation_id, sender_id, content, created_at}

  Event {event, data}

endpoints:
  GET    /v1/conversations
    -> 200 list of conversations

  POST   /v1/conversations 
    -> 201 conversation created
    / 400 invalid request or participants

  GET    /v1/conversations/{conversationId}
    -> 200 conversation
    / 404 conversation does not exist or is inaccessible

  GET    /v1/conversations/{conversationId}/messages
    -> 200 paginated message history
    / 400 invalid pagination parameters
    / 404 conversation does not exist or is inaccessible

  POST   /v1/conversations/{conversationId}/messages
    -> 201 message created
    / 400 invalid message
    / 404 conversation does not exist or is inaccessible

  GET    /v1/events
    -> 200 SSE event stream


Other notes:
- All chats are group chats, hence all have a participant_ids

- All endpoints require authentication, failure to do so gives 401 unauthorized

- For events, there's only 2 kinds: `conversation.created` and `message.created`

- For `GET .../messages` there's 2 query parameters, `limit` (default 50, max 100) and cursor (simple paging oldest to newest, response returns next_cursor for retrieving older messages)
```

**Qué intentaba lograr:** un one-shot de la API. Notar la versión 3.2 en vez de 3.1 para soporte de SSE.

**Qué devolvió:** one-shot correcto.

**Cómo seguir:** se agrega funcionalidad para incorporar más usuarios a una conversación y que cada uno pueda salir de una. Esto es solo a fines de que el TP tenga más de un prompt, el one-shot era correcto.

## 2) Incorporación y eliminación de usuarios en conversación preexistente

```
Now we add a way of adding and eliminating user ids from an existing conversation
- Add users: POST /conversations/{conv_id}/members  with body with a list of new participant_ids. Returns 200 if all ok, some error (409?) if there's at least one that is already in conversation (all must be new), (400?) if empty.
- Eliminate users: only self-deletion, but could be reversed by someone re-adding. DELETE /conversations/{conv_id}. 204 on success, 404 if not joined the conversation or it doesnt exist.

Modify resources accordingly if needed.
```

**Qué intentaba lograr:** agregado de usuarios por parte de cualquier miembro de la conversación, auto-eliminación de una conversación. Al agregar un usuario este simplemente se vuelve parte de la misma y puede leer desde el inicio. Se dieron algunas libertades en forma intencional.

**Qué devolvió:** edición correcta. Todas las fuentes de incertidumbre las cubrió correctamente. Recomendó cambiar el endpoint de DELETE por `DELETE /v1/conversations/{conversationId}/members/me` para ser más explícito sobre que no se borra la conversación sino que uno sale de ella.

## 3) Aceptación de cambio propuesto

```
ok modify the endpoint to `DELETE /v1/conversations/{conversationId}/members/me`. Dont change anything else.
```

**Qué devolvió:** versión final correcta. En particular notar adherencia a no cambiar otras cosas, notado vía `diff -u v2.yaml v3.yaml`:

```diff
--- v2.yaml	2026-10-10 04:17:14.738558104 -0300
+++ v3.yaml	2026-10-10 04:21:43.379544415 -0300
@@ -77,22 +77,6 @@
         '404':
           description: Conversation does not exist or is inaccessible to the caller.
 
-    delete:
-      tags: [Conversations]
-      operationId: leaveConversation
-      summary: Leave a conversation
-      description: |-
-        Removes the authenticated user from the conversation's participant list.
-        This does not delete the conversation or remove any other participants.
-        Another participant may add the user again later.
-      responses:
-        '204':
-          description: The authenticated user has left the conversation.
-        '401':
-          $ref: '#/components/responses/Unauthorized'
-        '404':
-          description: Conversation does not exist or the authenticated user is not a participant.
-
   /v1/conversations/{conversationId}/members:
     parameters:
       - $ref: '#/components/parameters/ConversationId'
@@ -126,6 +110,25 @@
         '409':
           description: At least one requested participant is already a member; no changes were made.
 
+  /v1/conversations/{conversationId}/members/me:
+    parameters:
+      - $ref: '#/components/parameters/ConversationId'
+    delete:
+      tags: [Conversations]
+      operationId: leaveConversation
+      summary: Leave a conversation
+      description: |-
+        Removes the authenticated user from the conversation's participant list.
+        This does not delete the conversation or remove any other participants.
+        Another participant may add the user again later.
+      responses:
+        '204':
+          description: The authenticated user has left the conversation.
+        '401':
+          $ref: '#/components/responses/Unauthorized'
+        '404':
+          description: Conversation does not exist or the authenticated user is not a participant.
+
   /v1/conversations/{conversationId}/messages:
     parameters:
       - $ref: '#/components/parameters/ConversationId'
```

**Observaciones:** el prompt inicial funcionó muy mal con los modelos de Gemini, proveían yaml malformados y utilizaban la versión 3.1 de OpenAPI en vez de 3.2. Con los de ChatGPT funcionó perfecto desde el inicio.
