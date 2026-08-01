# Emotion Analysis Demo

This demo exposes the server-side emotion analyzer without running a full chat turn.
It uses the configured LLM when available and automatically falls back to the local,
deterministic sentiment mapping when the model is unavailable or returns invalid data.

## Run

```powershell
npm run dev
```

In another PowerShell window:

```powershell
$body = @{ message = "我今天有点担心" } | ConvertTo-Json
$utf8Body = [Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/emotion-demo `
  -ContentType "application/json" `
  -Body $utf8Body
```

The response contains:

- `source`: `llm` or `fallback`
- `userAnalysis`: the local NLU result used by strategy and rhythm modules
- `emotionEvent`: the validated and clamped event consumed by `AICoordinator`

The production chat path uses the same analyzer before strategy selection:

```text
user text -> emotion analyzer -> coordinator/state update -> prompt assembly -> AI response
```

Set `persona.dynamicEmotion` to `false` to keep analysis available for dialogue context
while disabling emotion-state mutation in the chat pipeline.
