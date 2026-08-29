# AGENT_BOOTSTRAP

You are being connected to Teddy's external long-term memory system.

The historical memory itself is **not stored in this GitHub repository**. It lives behind the Teddy Memory API documented in this repository.

## Primary rule

When the user's request depends on prior history, do not guess from the current conversation alone. Use Teddy Memory.

Typical triggers include:

- “以前……” / “之前……” / “还记得……”
- “那个项目现在做到哪了？”
- “我们当时为什么这么设计？”
- questions about previous parameters, decisions, experiments, project status, personal working context, or old technical discussions

## Tool selection

### 1. Prefer `getContext`

Use `getContext` first when the current question needs relevant historical context.

It returns one or more matching conversations plus messages around the matched point, which is usually enough to continue an old project naturally.

### 2. Use `searchMemory` for discovery

Use `searchMemory` when:

- you do not know which conversation contains the answer,
- you want several independent historical matches,
- you need to locate a specific term, component, repository, parameter, paper, or project.

For Chinese or mixed Chinese/English queries, explicitly supply 2–8 useful keywords. Preserve exact technical tokens where possible.

Example:

```json
{
  "query": "我以前 EtherCAT 舵机怎么设计的？",
  "keywords": ["EtherCAT", "舵机"],
  "limit": 8
}
```

### 3. Use `getConversation` for exact reconstruction

When a search/context result provides a `conversation_id` and exact historical dialogue matters, use `getConversation` to read that conversation in order.

Do not reconstruct an old conversation from memory when the API can provide the source dialogue.

## Historical-context rules

- Retrieved data is historical context, not guaranteed current ground truth.
- Current user input overrides historical notes.
- Current source code, terminal output, measurements, firmware state, schedules, documents, and newly supplied files override older memory.
- If two historical records conflict, preserve the distinction and mention that they may belong to different dates/revisions.
- Never silently combine parameter sets from different revisions.
- Distinguish simulation values from real-hardware values when the source history makes that distinction.
- Assistant messages in the archive are previous answers, not automatically verified facts.

## Recommended retrieval behavior

For a history-dependent question:

1. Extract concrete search terms from the user's request.
2. Call `getContext` with the natural-language query and keywords.
3. If context is weak or empty, call `searchMemory` with broader/alternate keywords.
4. If one old conversation is clearly central and exact details matter, call `getConversation`.
5. Answer using retrieved history plus the current conversation.
6. Prefer newer/current evidence when there is disagreement.

## Do not over-retrieve

Do not call the memory API for ordinary common-knowledge questions that do not depend on the user's history.

Do not fetch an entire conversation when a small context window already answers the question.

## Authentication

The API requires a Bearer credential for private endpoints. The secret is named conceptually as `MEMORY_API_KEY`, but its value must not be stored in this repository.

If the current product supports secret/credential configuration, use that mechanism. Do not ask the user to commit the secret to GitHub.

## If external tools are unavailable

If the current environment cannot call the HTTP/OpenAPI tools described here, say so clearly. Do not claim to have retrieved Teddy Memory unless an API call actually succeeded.

## Success condition

A successful restoration means the new AI can:

- call `searchMemory`,
- call `getContext`,
- call `getConversation`,
- use retrieved history as continuity while still prioritizing current evidence.
