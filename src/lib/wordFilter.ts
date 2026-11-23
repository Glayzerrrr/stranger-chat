// ---------------------------------------------------------
// Lightweight client-side word / spam filter.
//
// This runs on the SENDER's browser before broadcast so the
// stranger never sees raw spam.  It is NOT a moderation
// system — real moderation happens via reports + review.
// ---------------------------------------------------------

const SPAM_KEYWORDS = [
  // Messaging app spam
  'telegram', 'whatsapp', 'kik', 'snapchat', 'discord.gg',
  // Common scam phrases
  'send me money', 'cashapp', 'venmo me', 'crypto invest',
  'make money fast', 'click this link', 'free nudes',
];

const URL_REGEX = /https?:\/\/[^\s]+/gi;

/**
 * Checks a message for spam keywords and URLs.
 * Returns the (possibly cleaned) text and a flag.
 */
export function filterMessage(text: string): {
  filtered: string;
  clean: boolean;
} {
  let filtered = text;
  let clean = true;

  // Strip URLs
  if (URL_REGEX.test(filtered)) {
    filtered = filtered.replace(URL_REGEX, '[link removed]');
    clean = false;
  }

  // Check for spam keywords (case-insensitive)
  const lower = filtered.toLowerCase();
  for (const keyword of SPAM_KEYWORDS) {
    if (lower.includes(keyword)) {
      clean = false;
      break;
    }
  }

  return { filtered, clean };
}
