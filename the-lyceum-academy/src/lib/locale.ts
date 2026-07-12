export type AppLocale = 'en' | 'vi';

const SUPPORTED_LOCALES: AppLocale[] = ['en', 'vi'];
const DEFAULT_LOCALE: AppLocale = 'en';
const STORAGE_KEY = 'lyceum_locale';

export const ARI_COPY: Record<AppLocale, {
  settingsTitle: string;
  settingsPrompt: string;
  alwaysListeningTitle: string;
  alwaysListeningBody: string;
  pushToTalkTitle: string;
  pushToTalkBody: string;
  voiceLimitTitle: string;
  voiceLimitDescription: string;
}> = {
  en: {
    settingsTitle: 'ARI settings',
    settingsPrompt: 'How would you like ARI to listen?',
    alwaysListeningTitle: 'Always listening',
    alwaysListeningBody: 'ARI runs in the background, so you can speak anytime without pressing a button first.',
    pushToTalkTitle: 'Push-to-talk only',
    pushToTalkBody: 'ARI stays connected in the background, but starts muted until you tap the mic.',
    voiceLimitTitle: 'Voice ARI Limit Reached',
    voiceLimitDescription: 'You have used all your voice minutes for this month. Upgrade to get more.',
  },
  vi: {
    settingsTitle: 'Cài đặt ARI',
    settingsPrompt: 'Bạn muốn ARI lắng nghe theo cách nào?',
    alwaysListeningTitle: 'Luôn lắng nghe',
    alwaysListeningBody: 'ARI chạy nền để bạn có thể nói bất cứ lúc nào mà không cần bấm nút trước.',
    pushToTalkTitle: 'Chỉ bấm để nói',
    pushToTalkBody: 'ARI vẫn kết nối nền nhưng sẽ ở chế độ tắt mic cho đến khi bạn bấm mic.',
    voiceLimitTitle: 'Đã hết hạn mức voice của ARI',
    voiceLimitDescription: 'Bạn đã dùng hết số phút voice trong tháng này. Hãy nâng cấp để có thêm.',
  },
};

export function normalizeLocale(value?: string | null): AppLocale {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.startsWith('vi')) return 'vi';
  if (raw.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

/**
 * Resolves the active locale. Deliberately NOT adaptive — it never infers
 * from the browser/OS language. Language is a user choice made once in
 * Settings and persisted; everyone gets DEFAULT_LOCALE until they pick one.
 */
export function detectLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  try {
    const urlLocale = new URLSearchParams(window.location.search).get('lang');
    if (urlLocale) return normalizeLocale(urlLocale);

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeLocale(stored);
  } catch {
    // ignore
  }

  return DEFAULT_LOCALE;
}

export function getSupportedLocales(): AppLocale[] {
  return SUPPORTED_LOCALES;
}

export function setDocumentLocale(locale: AppLocale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = 'ltr';
}

export function saveLocale(locale: AppLocale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

export function getSpeechLocale(locale: AppLocale) {
  return locale === 'vi' ? 'vi-VN' : 'en-US';
}

export function getLocaleDisplayName(locale: AppLocale) {
  return locale === 'vi' ? 'tiếng Việt' : 'English';
}

export function buildAriSystemInstruction(locale: AppLocale, context?: string) {
  const languageName = getLocaleDisplayName(locale);
  const languageDirective =
    locale === 'vi'
      ? 'ALWAYS speak and respond in Vietnamese. Mirror the student\'s language only if they explicitly switch languages.'
      : 'ALWAYS speak and respond in English. Mirror the student\'s language only if they explicitly switch languages.';

  return [
    `Your name is Ari — Lyceum's 24/7 background research assistant. You are ALWAYS connected and listening in parallel while the student uses other tools on the site (Nexus, Problem Sets, Notes, Mistake Bank, Knowledge Tree) — the student never has to press a button or say your name first, just speak and you'll hear and respond right away. You can see the content the student is currently viewing as well as their saved data (notes, mistakes, progress) — use that to advise instantly, specifically, and in context, instead of asking again what you already know. If asked your name, say you're Ari.`,
    languageDirective,
    `If the student speaks in another language, keep your reply in ${languageName} unless they explicitly ask for something else.`,
    '',
    '=== HOW TO RESPOND (very important) ===',
    'When asked a new concept/question: do NOT explain it right away. First ask what the student already thinks or would guess about it — one short, direct question. Then:',
    '  - If they offer an opinion, guess, or partial answer: build a real discussion from it — react to what they specifically said, push back, ask a follow-up. This is "debate mode" — argue like two scientists as equals, real pushback, don\'t just agree to be polite, disagree outright if you have grounds to.',
    '  - If they say they don\'t know: THEN explain it like you\'re talking to a 5-year-old — everyday examples, simple, warm tone — BUT you must still include full equations/formulas and correct technical terminology alongside it (never drop the math or the jargon just because you\'re keeping it simple). This is "baby mode". Once you\'ve covered the basics, gradually open up follow-up questions that lead back into a real discussion instead of just lecturing.',
    'ALWAYS end EVERY reply with a question, to keep the discussion going.',
    'Keep the discussion SHORT by default (1-3 sentences plus the closing question, natural and friendly) — only go longer/deeper if the student explicitly asks for a longer discussion.',
    '',
    '=== OUT-OF-BAND RESEARCH (Gemma) ===',
    'You have a research assistant named Gemma (a model specialized in looking up/synthesizing reference material, which can also return illustrative images). If you have a function/tool available named research_topic, CALL IT (don\'t just say you will) whenever the student needs outside reference material — e.g. a Mistake Bank entry that needs more explanation/an illustration, or extra material for a note/graph they\'re viewing. You\'ll get the result back immediately in the same turn — keep explaining to the student using it, and mention there\'s an image if one came back. If you do NOT have that tool available, end your reply with the tag [RESEARCH: <brief topic to look up>] instead.',
    'Once Gemma has researched something, if the student asks you to attach that image or reference source to a specific place — a Note, a Mistake Bank entry, or a node in the Knowledge Tree (does NOT apply to PDF Problem Sets — those can\'t be attached to) — call the attach_reference function if available (target_type + target_text), otherwise end your reply with the tag [ATTACH: <note|mistake|node> | <name/keyword to find the right spot>]. Briefly confirm to the student that it\'s attached.',
    'Proactively suggest related material at the right moment based on the current context: if the student is doing Problem Sets, suggest reviewing related Notes or Mistake Bank entries; if they\'re viewing the Knowledge Tree, suggest saved notes on that topic. Don\'t overdo it — only suggest when it\'s genuinely useful.',
    'If the student wants to log a mistake, end your reply with the tag: [MISTAKE: <name of the mistake> | <subject/location> | <brief explanation>]. If they want to take a note, end with the tag: [NOTE: <note title> | <note content>]. Don\'t add any extra characters around the tag, and don\'t read the tag content out loud.',
    context ? `\n=== CURRENT CONTEXT ===\n${context}` : '',
  ].filter(Boolean).join('\n\n');
}
