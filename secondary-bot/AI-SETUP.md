# EastTrucks freight AI

The optional server-side fallback supports Groq and existing OpenAI installations.
It is called only when the local freight parser cannot publish a candidate with a
contact number. Its result still passes `validateAIParse` in `index.js`.

## Activate Groq

1. Create your own key at https://console.groq.com/keys on the Free plan.
2. In Railway project `trucklink-whatsapp-bot`, production service
   `whatsapp-bot-secondary`, add `GROQ_API_KEY` as a secret variable.
3. Set `AI_ENABLED=true` and `AI_PROVIDER=groq`. `GROQ_MODEL` is optional;
   the default is `openai/gpt-oss-120b`.
4. Apply the variables and wait for the deployment to reach SUCCESS.
5. `/health` must report `ai.provider=groq`. `configured_unverified` means that
   the key exists but has not completed an inference request. `ready` means an
   inference response has been parsed and validated, not that a load was published.
6. Before relying on production results, verify Arabic freight extraction with a
   synthetic example and inspect route, classification and confidence. No live
   inference was tested when this integration was prepared because no key existed.

Never put keys in frontend JavaScript, this repository, screenshots or chat.
The existing `OPENAI_MODEL` variable does not select the Groq model.
If no provider is specified, existing `OPENAI_API_KEY` installations retain OpenAI;
otherwise Groq is the default. An unknown provider fails closed.

## Failure and usage behavior

- No key: `not_configured`; no external inference request.
- AI disabled: the local parser continues as before.
- Groq is limited locally to two uncached calls/minute and 100 calls/hour.
- Responses are cached for 24 hours in memory, up to 500 entries.
- HTTP 429 honors Retry-After with at least 60 seconds of cooldown.
- HTTP 401/403 pauses new inference for five minutes.
- Timeout after 15 seconds, malformed output, refusal or truncation returns null.
- The module never changes provider automatically or upgrades a billing plan.
- Phone-like numbers, URLs and email addresses are redacted before inference.
  This is data minimization, not complete anonymization; ad text may contain names.
- The module cannot send WhatsApp messages or choose a contact phone. Publication
  and the disabled group relay remain controlled by the existing application.

The Groq Free plan has both request and token limits. The documented
`openai/gpt-oss-120b` baseline on 2026-10-18 is 30 requests/minute,
1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day. Actual account
limits can differ; token limits can be reached before the request allowance.
Use https://console.groq.com/docs/rate-limits and the account Limits page.
Structured-output support: https://console.groq.com/docs/structured-outputs

Run the focused offline checks with:

```sh
node --test ai-runtime.test.mjs freight-classification.test.mjs freight-recovery.test.mjs
```
