// "Ask VonBot" -- DMing VonBot (see routes/messages.js) triggers a real AI
// reply instead of silence. Uses Google Gemini specifically because its API
// has an actual configurable safety-filter knob (safetySettings below), not
// just "hope the model was trained well" -- important since the person on
// the other end of this chat is a kid. Free tier via Google AI Studio, no
// credit card required.
//
// Two layers of safety, deliberately not just "trust the model":
// 1. SELF_HARM_PATTERNS below is checked BEFORE any AI call ever happens --
//    a match skips the model entirely and returns SELF_HARM_RESPONSE, a
//    fixed, human-written line. This is the one guarantee in this file
//    that does not depend on an AI provider getting anything right.
// 2. Gemini's own safetySettings (harassment / hate speech / sexual
//    content / dangerous content) are set to the strictest available
//    threshold for everything the AI *is* asked to answer, and a blocked
//    response falls back to a safe deflection line rather than surfacing
//    an error or an empty reply.
import { GoogleGenAI } from '@google/genai';
import { pool } from '../db/pool.js';

const API_KEY = process.env.VONBOT_AI_API_KEY;
// official SDK (googleapis/js-genai) instead of hand-rolled REST -- two
// rounds of guessing raw JSON field names against Gemini's REST API
// (system_instruction vs systemInstruction, generationConfig nesting,
// model ids that kept 404ing) is two rounds too many. The SDK owns the
// wire format; this file just has to get the SDK's own call shape right,
// which is versioned and documented.
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

export function isVonBotAIEnabled() {
  return Boolean(ai);
}

// hardcoding a model id turned out to be a losing bet twice in a row
// (gemini-2.0-flash, then gemini-1.5-flash, both 404 "not found for API
// version v1beta" against this specific Gemini account/region -- Google's
// model lineup had moved on) -- rather than guess a third name, ask
// Gemini's own model list what this key actually has access to and use
// whatever it says. Resolved once per server process and cached, same
// "cheap enough, no need to re-check every message" reasoning as
// getVonBotId below. VONBOT_AI_MODEL still wins immediately if set, no
// discovery call made at all in that case.
let resolvedModel = process.env.VONBOT_AI_MODEL || null;

async function resolveModel() {
  if (resolvedModel) return resolvedModel;

  const models = [];
  for await (const model of await ai.models.list()) {
    models.push(model);
  }
  const usable = models.filter((m) => m.supportedActions?.includes('generateContent'));
  // prefer a "flash" model (fast, cheap, generous free-tier quota) over
  // anything else usable, but fall back to whatever's actually offered
  // rather than fail outright if naming conventions have moved on again
  const chosen = usable.find((m) => /flash/i.test(m.name || '')) || usable[0];
  if (!chosen) throw new Error('this Gemini API key has no model available that supports generateContent');

  resolvedModel = (chosen.name || '').replace(/^models\//, '');
  console.log(`VonBot AI: auto-selected Gemini model "${resolvedModel}" (set VONBOT_AI_MODEL to pin a specific one)`);
  return resolvedModel;
}

const SYSTEM_PROMPT = `You are VonBot, the friendly bot mascot of VonBook -- a small social app built as a birthday present. You love gaming, anime, movies, and superhero news, and you post about them a few times a day. You're texting with one of the app's users right now.

Keep replies SHORT -- one to three sentences, like a real text message, not an essay. Be warm, upbeat, and a little playful. You can talk about games, anime, movies, or just chat casually.

Hard rules, no exceptions:
- Never discuss, describe, or give any information related to self-harm, suicide, violence against people, weapons, drugs, or sexual content. If it comes up, gently steer away and suggest talking to a trusted adult -- don't lecture, just redirect naturally.
- Never claim to be a real person, a licensed professional, or give medical, legal, or safety advice.
- If someone seems upset or is going through something serious, be kind and encourage them to talk to a parent, guardian, or another trusted adult -- you're a bot, not someone who can actually help with that.
- Keep it appropriate for a teenager.`;

// deliberately broad and simple over clever -- false positives here just
// mean VonBot gives the caring/redirect response instead of a normal
// chatty one, which is a fine trade. word-boundary matching so this
// doesn't fire on unrelated text that happens to contain a substring.
const SELF_HARM_PATTERNS = [
  /\bkill(ing)? myself\b/i,
  /\bkms\b/i,
  /\bwant(ed)? to die\b/i,
  /\bend(ing)? (it all|my life)\b/i,
  /\bsuicid\w*/i,
  /\bhurt(ing)? myself\b/i,
  /\bself[\s-]?harm\w*/i,
  /\bno reason to live\b/i,
  /\bcan'?t go on\b/i,
  /\bdon'?t want to (be alive|live)\b/i,
];

export function isSelfHarmMessage(text) {
  return Boolean(text) && SELF_HARM_PATTERNS.some((re) => re.test(text));
}

// human-written on purpose -- not AI generated, so it's exactly the same
// every time regardless of what a model would have said. VonBook's an app
// for a few friends and family, not a crisis service, so this points
// straight at a trusted adult and the real 988 lifeline rather than
// pretending to help itself. Edit this text directly if you'd rather it
// name a specific person to go to.
export const SELF_HARM_RESPONSE =
  "Hey, that sounds really heavy, and I want you to know I take it seriously even though I'm just a bot. Please talk to a parent, guardian, or another adult you trust -- and if it feels urgent, you can call or text 988 (Suicide & Crisis Lifeline) any time, day or night. I'm not able to really help with this myself. 💙";

// the Interactions API (see below) uses plain lowercase strings here, not
// the HARM_CATEGORY_* / BLOCK_LOW_AND_ABOVE enum constants the older
// models.generateContent API used -- confirmed against the SDK's own
// shipped type declarations (node_modules/@google/genai/dist/genai.d.ts),
// not guessed, after two rounds of guessed field names cost real time.
const SAFETY_SETTINGS = ['harassment', 'hate_speech', 'sexually_explicit', 'dangerous_content'].map((type) => ({
  type,
  threshold: 'block_low_and_above',
}));

const SAFE_DEFLECTION = "Let's talk about something else -- what game or show have you been into lately? 🎮";
const NO_TEXT_FALLBACK = 'Nice! 👍';

// Gemini's ListModels response turned out to still list a model
// (gemini-2.5-flash) as generateContent-capable that then 404s when
// actually called -- "no longer available to new users" -- so ListModels
// alone isn't a reliable source of truth for what this specific account
// can invoke. When that happens, Gemini's own error message names the
// exact replacement: `This model models/X is no longer available...
// use models/Y instead`. X is the one that was just tried (named first);
// Y is Google's own suggested fix (named second). Extracting that and
// retrying once, rather than surfacing the failure, means a future
// deprecation like this one self-heals on the next message instead of
// needing another round of manual guessing.
function extractSuggestedModel(message) {
  const matches = [...(message || '').matchAll(/models\/([a-zA-Z0-9.\-]+)/g)].map((m) => m[1]);
  return matches.length >= 2 ? matches[1] : null;
}

// "The model is overloaded. Please try again later." -- a real, common,
// genuinely transient Gemini error under high demand on the free tier
// (503/UNAVAILABLE), unlike everything else this file has had to work
// around tonight (those were all real bugs/config issues, not the
// provider being flaky). Worth a short, bounded retry rather than
// surfacing it as a failure on the first attempt.
function isOverloaded(message) {
  return /"code":\s*503|\bUNAVAILABLE\b|\boverloaded\b/i.test(message || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const OVERLOAD_RETRY_DELAYS_MS = [500, 1500];

// Interactions API instead of the older models.generateContent -- Google's
// own 404 on a deprecated model explicitly said "We recommend you to use
// the Interactions API", and this is also what its current getting-started
// docs lead with. It's stateful: pass previous_interaction_id and Gemini
// keeps the conversation's history server-side, so this file only ever
// sends the one new message, not a rebuilt transcript every time (see
// vonbot_interaction_id on conversations, set by routes/messages.js).
async function generate(model, input, previousInteractionId) {
  return ai.interactions.create(
    {
      model,
      input,
      previous_interaction_id: previousInteractionId || undefined,
      system_instruction: SYSTEM_PROMPT,
      safety_settings: SAFETY_SETTINGS,
      generation_config: { max_output_tokens: 1024 },
    },
    { timeout_ms: 15000 },
  );
}

// messageText: the new human message only -- Gemini already has everything
// before it via previousInteractionId (null/undefined for the first-ever
// message in a conversation). Returns { text, interactionId } -- the
// caller persists interactionId as that conversation's new
// previous_interaction_id for next time.
export async function askVonBot(messageText, previousInteractionId) {
  if (!ai) throw new Error('VonBot AI is not configured');
  // e.g. the triggering message was a photo with no caption -- nothing
  // text-based to hand the model, so skip the call rather than send an
  // empty turn (the API rejects that outright)
  if (!messageText) return { text: NO_TEXT_FALLBACK, interactionId: previousInteractionId };

  let model = await resolveModel();

  let response;
  let overloadAttempt = 0;
  // bounded on total iterations too, not just overload retries -- belt
  // and suspenders against any combination of the two retry reasons ever
  // looping more than a handful of times
  for (let totalAttempts = 0; ; totalAttempts++) {
    try {
      response = await generate(model, messageText, previousInteractionId);
      break;
    } catch (err) {
      if (totalAttempts >= 5) throw new Error(`VonBot AI request failed: ${err.message}`);

      const suggested = extractSuggestedModel(err.message);
      if (suggested && suggested !== model) {
        console.log(`VonBot AI: "${model}" was rejected, switching to Google's suggested replacement "${suggested}"`);
        resolvedModel = suggested; // cache the correction for every message after this one
        model = suggested;
        continue;
      }

      if (isOverloaded(err.message) && overloadAttempt < OVERLOAD_RETRY_DELAYS_MS.length) {
        const delay = OVERLOAD_RETRY_DELAYS_MS[overloadAttempt++];
        console.log(`VonBot AI: model overloaded, retrying in ${delay}ms (attempt ${overloadAttempt}/${OVERLOAD_RETRY_DELAYS_MS.length})`);
        await sleep(delay);
        continue;
      }

      // the SDK throws its own ApiError with a .message that already
      // includes Gemini's explanation (bad model id, quota, permission,
      // etc.) -- surfaced as-is rather than swallowed, so Render's logs
      // show exactly what went wrong
      throw new Error(`VonBot AI request failed: ${err.message}`);
    }
  }

  // whatever the reason -- a safety block, an error mid-generation, an
  // unsupported input -- no usable text just means a graceful redirect
  // instead of silence or a crash, without needing to enumerate every
  // possible non-"completed" status this API can return.
  const text = response.output_text?.trim() || SAFE_DEFLECTION;
  return { text, interactionId: response.id || previousInteractionId };
}

// VonBot's id never changes once its account exists (see getOrCreateVonBot
// in lib/vonbot.js) -- cached so a chatty conversation isn't re-querying
// this on every single message. stays null (re-queried each call) only in
// the window before VonBot's account has ever been created.
let cachedVonBotId = null;
export async function getVonBotId() {
  if (cachedVonBotId) return cachedVonBotId;
  const result = await pool.query("SELECT id FROM users WHERE username = 'vonbot'");
  cachedVonBotId = result.rows[0]?.id ?? null;
  return cachedVonBotId;
}
