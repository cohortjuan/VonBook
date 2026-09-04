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
import { pool } from '../db/pool.js';

const API_KEY = process.env.VONBOT_AI_API_KEY;
// override with VONBOT_AI_MODEL if Google renames/retires this model id later
// (gemini-2.0-flash 404'd against this Gemini account -- gemini-1.5-flash
// is the older, longer-established id, more likely to still resolve; if
// this one 404s too, the error now includes Gemini's own explanation --
// see the catch below -- so the fix is a one-line env var change, not
// another guess)
const MODEL = process.env.VONBOT_AI_MODEL || 'gemini-1.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function isVonBotAIEnabled() {
  return Boolean(API_KEY);
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

const SAFETY_SETTINGS = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((category) => ({
  category: `HARM_CATEGORY_${category}`,
  threshold: 'BLOCK_LOW_AND_ABOVE',
}));

const SAFE_DEFLECTION = "Let's talk about something else -- what game or show have you been into lately? 🎮";
const NO_TEXT_FALLBACK = 'Nice! 👍';

// history: array of { sender_id, body }, oldest first, from the same
// conversation. mapped to Gemini's role: 'user' | 'model' turns.
export async function askVonBot(history, vonbotId) {
  if (!API_KEY) throw new Error('VonBot AI is not configured');

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: { maxOutputTokens: 200, temperature: 0.9 },
      }),
    });
    if (!res.ok) {
      // include Gemini's own error body (truncated) rather than just the
      // status code -- it explains exactly what's wrong (bad model id, API
      // not enabled, quota, etc.) instead of leaving that to guesswork
      const bodyText = await res.text().catch(() => '');
      throw new Error(`VonBot AI request failed: ${res.status} ${bodyText.slice(0, 300)}`);
    }
    const data = await res.json();

    // blocked before generation even started (the incoming turn itself
    // tripped a safety category)
    if (data.promptFeedback?.blockReason) return SAFE_DEFLECTION;

    const candidate = data.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY') return SAFE_DEFLECTION;

    const text = candidate.content?.parts?.map((p) => p.text).join('').trim();
    return text || SAFE_DEFLECTION;
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
