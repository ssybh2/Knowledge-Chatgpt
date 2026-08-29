# Teddy Memory API Reference

Base URL:

```text
https://teddy-memory-api.3767174214.workers.dev
```

Private endpoints use HTTP Bearer authentication:

```http
Authorization: Bearer <MEMORY_API_KEY>
```

The actual key is intentionally not stored in this repository.

## 1. Health check

### `GET /v1/status`

Public endpoint. Confirms that the Worker and D1 database are online.

Example:

```http
GET /v1/status
```

Expected shape:

```json
{
  "service": "Teddy Memory API",
  "status": "online",
  "version": "0.4.0",
  "mode": "read-only",
  "database": "connected",
  "auth": "configured",
  "conversations": 757,
  "messages": 14546,
  "retrievable_messages": 14545
}
```

Counts may grow after future archive updates.

## 2. Authentication test

### `GET /v1/auth-test`

Private endpoint. Use this immediately after configuring credentials.

```http
GET /v1/auth-test
Authorization: Bearer <MEMORY_API_KEY>
```

Successful response:

```json
{
  "authenticated": true,
  "message": "Teddy Memory private API is accessible."
}
```

## 3. Search historical memory

### `POST /v1/search`

Use when discovering which old messages/conversations are relevant.

Headers:

```http
Authorization: Bearer <MEMORY_API_KEY>
Content-Type: application/json
```

Request:

```json
{
  "query": "我以前 EtherCAT 舵机怎么设计的？",
  "keywords": ["EtherCAT", "舵机"],
  "limit": 8
}
```

Fields:

- `query`: natural-language question; recommended.
- `keywords`: 2–8 concrete search terms; strongly recommended for Chinese/mixed-language searches.
- `limit`: 1–20, default 8.

Typical response item:

```json
{
  "id": "<archive-message-id>",
  "original_message_id": "<original-openai-message-id>",
  "conversation_id": "<conversation-id>",
  "role": "user",
  "content": "...",
  "create_time": 1780000000,
  "sequence_index": 5,
  "title": "查询舵机支持情况",
  "score": 12.25
}
```

## 4. Retrieve contextual memory

### `POST /v1/context`

This is the preferred endpoint for a new AI answering a history-dependent question.

It finds relevant historical messages and returns nearby messages from the same old conversations.

Request:

```json
{
  "query": "我以前关于 EtherCAT 舵机聊过什么？",
  "keywords": ["EtherCAT", "舵机"],
  "max_conversations": 4,
  "before": 2,
  "after": 3
}
```

Fields:

- `query`: current user question.
- `keywords`: concrete retrieval terms.
- `max_conversations`: 1–6, default 4.
- `before`: how many retrievable messages before the matched message, default 2.
- `after`: how many retrievable messages after the matched message, default 3.

Response structure:

```json
{
  "ok": true,
  "query": "...",
  "keywords": ["EtherCAT", "舵机"],
  "conversation_count": 2,
  "contexts": [
    {
      "conversation_id": "...",
      "title": "...",
      "matched_message_id": "...",
      "matched_sequence_index": 5,
      "messages": [
        {
          "role": "user",
          "content": "...",
          "sequence_index": 4
        },
        {
          "role": "assistant",
          "content": "...",
          "sequence_index": 5
        }
      ]
    }
  ]
}
```

## 5. Retrieve one complete old conversation

### `GET /v1/conversation/{conversation_id}`

Use after search/context identifies an important conversation.

Example:

```http
GET /v1/conversation/6a8f043e-32e4-83ec-8355-0bfc6bf1698e
Authorization: Bearer <MEMORY_API_KEY>
```

Optional query parameters:

```text
?limit=200&offset=0
```

- `limit`: 1–500, default 200.
- `offset`: pagination offset.

Response includes conversation metadata and messages ordered by `sequence_index`.

## 6. Migration verification

### `GET /v1/verify-migration`

Administrative read-only verification endpoint.

At the verified 2026-08-29 snapshot, expected values were:

```json
{
  "conversations": 757,
  "total_messages": 14546,
  "unique_archive_ids": 14546,
  "unique_original_message_ids": 14488,
  "retrievable_messages": 14545
}
```

The difference between total archive IDs and original OpenAI message IDs is intentional: 58 original message IDs appeared in more than one conversation, so Teddy Memory uses conversation-scoped archive IDs to preserve every record.

## 7. Recommended AI calling strategy

For a user request that references history:

```text
current question
    ↓
getContext
    ↓
Enough context? ── yes ──> answer
    │
    no
    ↓
searchMemory with alternate/broader keywords
    ↓
Need exact old dialogue? ── yes ──> getConversation
    │
    no
    ↓
answer
```

## 8. Chinese keyword guidance

The API's read-only search layer works best when the caller extracts meaningful keywords instead of sending only a long Chinese sentence.

Good:

```json
{
  "query": "我之前四足机器人站立训练的问题是什么？",
  "keywords": ["四足", "站立", "Isaac Lab", "Mastiff"]
}
```

Less reliable:

```json
{
  "query": "你还记不记得我们以前讨论的那个东西到底后来怎么样了"
}
```

Preserve exact repository names, motor model numbers, controller names, paper acronyms, and English technical tokens whenever they appear in the user's question.

## 9. Security / scope

This API is intended as a private personal-memory backend.

- Do not commit the Bearer key to this repository.
- Do not expose credentials in generated public files.
- Do not treat `/v1/status` as proof that private endpoints are authenticated; test `/v1/auth-test` after setup.
- Current API version is read-only for memory consumers. Import/migration tooling is intentionally not part of the normal consumer interface.
