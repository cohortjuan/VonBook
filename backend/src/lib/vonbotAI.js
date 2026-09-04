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
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, FinishReason } from '@google/genai';
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

const SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE }));

const SAFE_DEFLECTION = "Let's talk about something else -- what game or show have you been into lately? 🎮";
const NO_TEXT_FALLBACK = 'Nice! 👍';

// history: array of { sender_id, body }, oldest first, from the same
// conversation. mapped to Gemini's role: 'user' | 'model' turns.
export async function askVonBot(history, vonbotId) {
  if (!ai) throw new Error('VonBot AI is not configured');

  const contents = history
    .filter((m) => m.body)
    .map((m) => ({
      role: m.sender_id === vonbotId ? 'model' : 'user',
      parts: [{ text: m.body }],
    }));
  // e.g. the triggering message was a photo with no caption -- nothing
  // text-based to hand the model, so skip the call rather than send an
  // empty turn (the API rejects that outright)
  if (contents.length === 0) return NO_TEXT_FALLBACK;

  const model = await resolveModel();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          safetySettings: SAFETY_SETTINGS,
          maxOutputTokens: 200,
          temperature: 0.9,
          abortSignal: controller.signal,
        },
      });
    } catch (err) {
      // the SDK throws its own ApiError with a .message that already
      // includes Gemini's explanation (bad model id, quota, permission,
      // etc.) -- surfaced as-is rather than swallowed, so Render's logs
      // show exactly what went wrong
      throw new Error(`VonBot AI request failed: ${err.message}`);
    }

    // blocked before generation even started (the incoming turn itself
    // tripped a safety category)
    if (response.promptFeedback?.blockReason) return SAFE_DEFLECTION;

    const candidate = response.candidates?.[0];
    if (!candidate || candidate.finishReason === FinishReason.SAFETY) return SAFE_DEFLECTION;

    return response.text?.trim() || SAFE_DEFLECTION;
  } finally {
    clearTimeout(timeout);
  }
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
