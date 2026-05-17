# AgentPhone + OpenAI Voice Integration

## Recommendation

Use AgentPhone webhook mode as the first integration.

AgentPhone should own telephony, phone numbers, call lifecycle, speech-to-text, text-to-speech, call events, retries, and recordings. Our app should own the agent logic, business state, tools, transcripts, and follow-up actions.

```text
Phone call
  -> AgentPhone number / agent
  -> AgentPhone STT + call handling
  -> our webhook receives agent.message voice transcript
  -> our app runs agent logic with OpenAI
  -> our webhook streams NDJSON text response
  -> AgentPhone TTS speaks it
```

## Why Not OpenAI SIP First

OpenAI recommends SIP for native Realtime phone agents: a SIP trunk points directly at OpenAI, OpenAI emits a `realtime.call.incoming` webhook, and our backend accepts the call with a configured Realtime session.

That is the right architecture when OpenAI Realtime owns the phone audio path end to end.

With AgentPhone, using OpenAI SIP at the same time would duplicate most of AgentPhone's value. AgentPhone already abstracts the phone transport and exposes a webhook interface for our agent. For this app, start with AgentPhone webhooks and only move to OpenAI SIP or raw Realtime audio if AgentPhone's abstraction becomes limiting.

## MVP Flow

1. Create an AgentPhone agent with webhook voice mode.

```json
{
  "name": "Gavel",
  "voiceMode": "webhook",
  "beginMessage": "Hi, how can I help?"
}
```

2. Attach an AgentPhone phone number to the agent.

3. Register our app webhook.

```text
POST /agentphone/webhook
```

4. For each `agent.message` event with `channel: "voice"`:

- verify the AgentPhone webhook signature
- load or create a call session by call ID
- append the caller transcript as a user turn
- run our OpenAI-backed agent logic
- stream an interim response quickly, then the final response

Example NDJSON response:

```json
{"text":"Let me check that.", "interim":true}
{"text":"I found the details. Your next appointment is Tuesday at 3 PM."}
```

5. For `agent.call_ended`:

- persist the full transcript
- store summary, sentiment, outcome, duration, and metadata
- trigger follow-up jobs, CRM updates, notifications, or human review

## OpenAI Model Choice

For this AgentPhone webhook architecture, start with a normal streaming OpenAI text or agent workflow behind the webhook. AgentPhone is already converting speech to text and text to speech, so a raw Realtime audio session is not required for the MVP.

Use `gpt-realtime-2` later if we need a long-lived Realtime session per call for lower latency, realtime-style session state, tool streaming, interruption handling, or more direct audio behavior.

## Practical Direction

Recommended:

```text
AgentPhone webhook mode + OpenAI text/agent streaming
```

Possible later:

```text
AgentPhone webhook mode + long-lived OpenAI Realtime session per call
```

Avoid unless there is a specific need:

```text
AgentPhone + OpenAI SIP at the same time
```

## Future App Shape

Likely Convex/backend pieces:

- `phoneAgents`: AgentPhone agent IDs, names, voice settings, prompt config
- `phoneNumbers`: AgentPhone number IDs, E.164 numbers, assigned agent IDs
- `voiceCalls`: call ID, status, caller/callee, started/ended timestamps, summary
- `voiceTurns`: per-turn caller transcript, assistant response, tool calls, timing
- `webhookDeliveries`: idempotency, raw event metadata, delivery/debug status

Likely env vars:

```text
AGENTPHONE_API_KEY=
AGENTPHONE_WEBHOOK_SECRET=
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2
```

## References Checked

- AgentPhone docs: `https://docs.agentphone.ai/`
- AgentPhone calls guide: `https://docs.agentphone.ai/documentation/guides/calls`
- AgentPhone webhooks guide: `https://docs.agentphone.ai/documentation/guides/webhooks`
- OpenAI Realtime overview: `https://developers.openai.com/api/docs/guides/realtime`
- OpenAI Realtime SIP guide: `https://developers.openai.com/api/docs/guides/realtime-sip`
- OpenAI Realtime WebSocket guide: `https://developers.openai.com/api/docs/guides/realtime-websocket`
- OpenAI voice agents guide: `https://developers.openai.com/api/docs/guides/voice-agents`
