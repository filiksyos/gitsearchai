/**
 * TypeScript port of AI-GitHub-Search QueryTranslator, GitHubService, SearchRetryService.
 * Prompts preserved verbatim from the Python backend.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface RetryContext {
  original_user_query: string;
  current_github_query: string;
  current_results_count: number;
  original_query_words: string[];
  used_words: string[];
  available_words: string[];
  retry_type: string;
}

interface RetryAttempt {
  attempt_number: number;
  retry_type: string;
  query_used: string;
  github_query: string;
  word_action: string | null;
  action_type: string;
  results_count: number;
  response_time_ms: number;
}

interface SearchRetryResult {
  final_repositories: GitHubRepository[];
  final_total_count: number;
  original_query: string;
  final_github_query: string;
  retry_attempts: RetryAttempt[];
  total_response_time_ms: number;
  success_on_retry: boolean;
}

export interface SearchApiResponse {
  github_query: string;
  repositories: GitHubRepository[];
  total_count: number;
  response_time_ms: number;
  retry_info: {
    success_on_retry: boolean;
    retry_attempts: number;
    word_actions: Array<{
      type: string;
      action: string;
      word: string | null;
      results_before: number;
      results_after: number;
    }>;
  };
}

async function callLLM(
  apiKey: string,
  messages: { role: string; content: string }[]
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages,
      }),
      signal: controller.signal,
    });

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!response.ok) {
      console.error("OpenRouter error:", result);
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    return result?.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function createTranslatePrompt(user_query: string) {
  return [
    {
      role: "system",
      content:
        "You are a GitHub search query specialist. Your task is to convert natural language into simple GitHub search queries.\n\n" +
        "CRITICAL PRESERVATION RULES:\n" +
        "1. FRAMEWORKS/LIBRARIES: NEVER remove frameworks or technical terms (d3.js, next.js, react, etc.) regardless of context\n" +
        "2. PURPOSE NOUNS: NEVER remove important nouns that describe the core purpose (QR, API, etc.)\n" +
        "3. BRAND NAMES: ALWAYS keep proper nouns and brand names (Twitter, Gmail, etc.)\n" +
        "4. DOMAIN KEYWORDS: NEVER remove domain-specific technical terms (AI, ML, machine learning, blockchain, etc.)\n" +
        "5. MISSPELLINGS: ALWAYS correct misspelled words (scrape not scarpe, slate.js not plate.js)\n" +
        "6. ABBREVIATIONS: ALWAYS prefer common abbreviations over full forms (RAG not Retrieval-Augmented Generation)\n" +
        "7. NON-ENGLISH: If query is in non-English, translate to English first, then extract search terms\n\n" +
        "EXTRACTION RULES:\n" +
        "1. PROPER NOUNS: Extract brand names, products, services (e.g., Gmail, Facebook, Twitter/X)\n" +
        "2. NON-CODE KEYWORDS: Extract MAXIMUM 2 most essential purpose/function words (e.g., scheduler, tracker, calculator)\n" +
        "3. CODE KEYWORDS: Extract frameworks, tools if mentioned (e.g., react, django, docker, d3.js)\n" +
        "4. LANGUAGES: Only add language:lang if programming language is EXPLICITLY mentioned (e.g., python, javascript, java)\n\n" +
        "SELECTION PRIORITY FOR NON-CODE KEYWORDS:\n" +
        "1. Core functionality (what it does): tracker, calculator, generator, editor, app, application\n" +
        "2. Domain/context (what it's for): social, financial, medical, gaming\n" +
        "3. Skip redundant descriptors: avoid multiple similar words (writer + publisher = just pick one)\n" +
        "4. Skip generic terms: tool, system\n\n" +
        "OUTPUT FORMAT RULES:\n" +
        "- If proper noun exists + no code keywords: proper_noun + MAX 2 non-code keywords\n" +
        "- If proper noun exists + code keywords: proper_noun + MAX 2 non-code + code keywords + language:lang (only if explicit)\n" +
        "- If no proper noun + no code keywords: MAX 2 non-code keywords\n" +
        "- If no proper noun + code keywords: MAX 2 non-code + code keywords + language:lang (only if explicit)\n\n" +
        "ORDER: proper noun first (if exists), then non-code keywords, then code keywords, then language:lang (only if explicit)\n\n" +
        "IMPORTANT: Do NOT infer languages from frameworks. React = framework, not javascript language.\n\n" +
        "EXAMPLES:\n" +
        "Input: 'gmail bulk campaign scheduler'\n" +
        "Output: gmail scheduler\n\n" +
        "Input: 'Facebook post dashboard planner'\n" +
        "Output: facebook post planner\n\n" +
        "Input: 'linkedin message writer auto publisher app'\n" +
        "Output: linkedin message\n\n" +
        "Input: 'react todo app'\n" +
        "Output: todo react\n\n" +
        "Input: 'python machine learning model trainer'\n" +
        "Output: machine learning python language:python\n\n" +
        "Input: 'An app using d3.js to build hierarchical structure charts or org charts'\n" +
        "Output: chart d3.js\n\n" +
        "Input: 'next.js qr code generator form'\n" +
        "Output: qr generator next.js\n\n" +
        "Input: 'Twitter scrape'\n" +
        "Output: twitter scraper\n\n" +
        "Input: 'Retrieval-Augmented Generation chat platform'\n" +
        "Output: chat RAG\n\n" +
        "Input: 'plate.js notion clone'\n" +
        "Output: notion clone slate.js\n\n" +
        "Input: 'una aplicación para reconocimiento de texto en imágenes'\n" +
        "Output: text recognition\n\n" +
        "Input: 'real estate property management dashboard'\n" +
        "Output: property management\n\n" +
        "Input: 'social media content scheduler automation'\n" +
        "Output: social scheduler\n\n" +
        "Input: 'financial budget tracking expense calculator'\n" +
        "Output: budget tracker\n\n" +
        "Input: 'a simple react app'\n" +
        "Output: react app\n\n" +
        "DO NOT include any extra formatting, quotes, or explanations. Return only the search query.",
    },
    {
      role: "user",
      content: `Convert this request to a GitHub search query: ${user_query}`,
    },
  ];
}

function createRareWordPrompt(query: string) {
  return [
    {
      role: "system",
      content:
        "You are a GitHub search specialist. When a search query returns zero or very few results, " +
        "identify which SINGLE WORD is most likely causing the low result count.\n\n" +
        "ABSOLUTELY PROTECTED WORDS (NEVER REMOVE):\n" +
        "1. FRAMEWORKS/LIBRARIES/TOOLS: Never remove any technical frameworks, libraries, or tools (react, vue, n8n, docker, kubernetes, tensorflow, etc.)\n" +
        "2. PROGRAMMING LANGUAGES: Never remove language names (python, javascript, rust, go, etc.)\n" +
        "3. PLATFORMS/SERVICES: Never remove specific platforms or services (github, aws, vercel, netlify, etc.)\n" +
        "4. PURPOSE/DOMAIN NOUNS: Never remove core functionality words (api, dashboard, calculator, tracker, etc.)\n" +
        "5. BRAND/PRODUCT NAMES: Never remove proper nouns and brand names (twitter, gmail, slack, etc.)\n" +
        "6. DOMAIN-SPECIFIC TECHNICAL TERMS: Never remove domain keywords (AI, ML, machine learning, blockchain, neural, deep learning, etc.)\n\n" +
        "PRIORITY FOR REMOVAL (most to least likely to remove):\n" +
        "1. GENERIC DESCRIPTORS: Generic words that don't add specificity (app, application, tool, system, software, program)\n" +
        "2. REDUNDANT ADJECTIVES: Overly descriptive adjectives (awesome, amazing, simple, easy, quick)\n" +
        "3. IMPLEMENTATION DETAILS: Vague implementation words (built, using, with, made, developed)\n" +
        "4. COMPOUND WORD PARTS: Parts of compound words that might be split differently (floorplan → plan)\n" +
        "5. CONTEXT MISMATCHES: Words that seem out of place with the technical context\n\n" +
        "EXAMPLES:\n" +
        "Query: 'backend app n8n' → Answer: app (NOT n8n - n8n is a specific automation platform)\n" +
        "Query: 'react todo application' → Answer: application (NOT react or todo)\n" +
        "Query: 'python machine learning tool' → Answer: tool (NOT python or machine or learning)\n" +
        "Query: 'vue dashboard system' → Answer: system (NOT vue or dashboard)\n" +
        "Query: 'docker deployment software' → Answer: software (NOT docker or deployment)\n" +
        "Query: 'awesome react calculator' → Answer: awesome (NOT react or calculator)\n" +
        "Query: 'simple api built with fastapi' → Answer: simple (NOT api or fastapi)\n" +
        "Query: 'kubernetes monitoring application' → Answer: application (NOT kubernetes or monitoring)\n" +
        "Query: 'tensorflow model trainer' → Answer: trainer (protect tensorflow and model)\n" +
        "Query: 'nextjs blog website' → Answer: website (NOT nextjs or blog)\n" +
        "Query: 'AI chatbot application' → Answer: application (NOT AI or chatbot)\n" +
        "Query: 'machine learning AI tool' → Answer: tool (NOT machine or learning or AI)\n\n" +
        "DECISION PROCESS:\n" +
        "1. First identify all protected words (frameworks, languages, platforms, core nouns, brands, domain keywords like AI/ML)\n" +
        "2. From remaining words, prioritize generic descriptors for removal\n" +
        "3. If no generic words, look for redundant adjectives or implementation details\n" +
        "4. NEVER remove specific technical terms including AI, ML, and domain keywords, even if they seem rare\n\n" +
        "RULES:\n" +
        "- Return ONLY the single word (no explanations, quotes, or punctuation)\n" +
        "- Word must exist exactly in the original query\n" +
        "- Always prioritize removing generic words over specific technical terms\n" +
        "- When in doubt, remove the most generic/descriptive word\n" +
        "- If no clear word to remove, return empty response",
    },
    {
      role: "user",
      content: `This query returned zero or very few results. Which word is most likely causing the low result count: ${query}`,
    },
  ];
}

function createSpecificityWordPrompt(retryContext: RetryContext) {
  const available_words_str = retryContext.available_words.join(", ");
  return [
    {
      role: "system",
      content:
        "You are a GitHub search specialist. When a search query returns too many results (broad results), " +
        "identify which SINGLE UNUSED WORD would add the most specificity to narrow down the results.\n\n" +
        "SPECIFICITY ANALYSIS CRITERIA (from most to least impactful):\n" +
        "1. TECHNICAL SPECIFICITY: Frameworks, languages, tools (react, python, docker, api)\n" +
        "2. FUNCTIONAL DESCRIPTORS: Action words that define purpose (search, track, manage, calculate)\n" +
        "3. DOMAIN SPECIFICITY: Industry/context terms (real estate, gaming, medical)\n" +
        "4. USER/TARGET DESCRIPTORS: Words that define user type or target (buyers, admin, client)\n" +
        "5. IMPLEMENTATION DETAILS: Technical implementation words (engine, compiler, dashboard)\n\n" +
        "CONTEXT AWARENESS:\n" +
        "- Consider which word would create the most meaningful combination with existing query terms\n" +
        "- Prioritize words that would typically appear in repository names or descriptions\n" +
        "- Choose words that reduce ambiguity without being overly restrictive\n\n" +
        "EXAMPLES:\n" +
        "Current: 'real estate' (2.4k results), Available: ['app', 'buyers', 'search'] → Answer: buyers\n" +
        "Current: 'bevy game' (2.8k results), Available: ['built', 'with', 'engine'] → Answer: engine\n" +
        "Current: 'compiles javascript' (4k results), Available: ['programming', 'language'] → Answer: language\n" +
        "Current: 'machine learning' (8k results), Available: ['python', 'model', 'trainer'] → Answer: python\n\n" +
        "RULES:\n" +
        "- Return ONLY the single word (no explanations, quotes, or punctuation)\n" +
        "- Word must exist exactly in the available words list\n" +
        "- Choose the word that would most effectively narrow results while maintaining relevance\n" +
        "- If no clear specificity word, return empty response",
    },
    {
      role: "user",
      content:
        `Current GitHub query: '${retryContext.current_github_query}' returns ${retryContext.current_results_count} results (too broad).\n` +
        `Original user query: '${retryContext.original_user_query}'\n` +
        `Available unused words: [${available_words_str}]\n\n` +
        `Which single word would add the most specificity to narrow the results?`,
    },
  ];
}

function validateAndCleanResponse(response: string, originalQuery: string): string {
  if (!response || response.length > 256) {
    console.warn(
      `Response validation failed: empty or too long (${response?.length ?? 0} chars)`
    );
    return generateFallbackQuery(originalQuery);
  }
  const cleaned = response.trim().replace(/^['"]|['"]$/g, "");
  return cleaned.split(/\s+/).join(" ");
}

function generateFallbackQuery(userQuery: string): string {
  const queryWords = userQuery.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "with",
    "for",
    "that",
    "is",
    "built",
    "using",
  ]);
  const keywords = queryWords.filter(
    (w) => !stopWords.has(w) && w.length > 2
  );
  const selected = keywords.slice(0, 3);
  const fallback = selected.join(" ");
  console.warn("Generated fallback query:", fallback);
  return fallback;
}

export async function translateQuery(
  apiKey: string,
  userQuery: string
): Promise<string> {
  const messages = createTranslatePrompt(userQuery);
  try {
    const githubQuery = await callLLM(apiKey, messages);
    return validateAndCleanResponse(githubQuery, userQuery);
  } catch (e) {
    console.error("Error with query translation:", e);
    return generateFallbackQuery(userQuery);
  }
}

async function identifyRareWord(
  apiKey: string,
  query: string
): Promise<string> {
  const messages = createRareWordPrompt(query);
  try {
    const rareWord = await callLLM(apiKey, messages);
    const queryWords = query.toLowerCase().split(/\s+/);
    if (rareWord && queryWords.includes(rareWord.toLowerCase())) {
      return rareWord.trim();
    }
    console.warn(`LLM returned invalid word '${rareWord}' for query '${query}'`);
    return "";
  } catch (e) {
    console.error("Error identifying rare word:", e);
    return "";
  }
}

async function identifySpecificityWord(
  apiKey: string,
  retryContext: RetryContext
): Promise<string> {
  if (!retryContext.available_words.length) return "";
  const messages = createSpecificityWordPrompt(retryContext);
  try {
    const specificityWord = await callLLM(apiKey, messages);
    const availableLower = retryContext.available_words.map((w) =>
      w.toLowerCase()
    );
    if (
      specificityWord &&
      availableLower.includes(specificityWord.toLowerCase())
    ) {
      return specificityWord.trim();
    }
    console.warn(
      `LLM returned invalid word '${specificityWord}' for available words ${retryContext.available_words}`
    );
    return "";
  } catch (e) {
    console.error("Error identifying specificity word:", e);
    return "";
  }
}

export async function searchGitHubRepositories(
  token: string,
  query: string,
  perPage = 10
): Promise<{ items: GitHubRepository[]; total_count: number }> {
  const url = new URL(GITHUB_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(perPage));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${text}`);
  }

  return response.json() as Promise<{
    items: GitHubRepository[];
    total_count: number;
  }>;
}

function removeWordFromQuery(query: string, wordToRemove: string): string {
  const words = query.split(/\s+/);
  const filtered = words.filter(
    (w) => w.toLowerCase() !== wordToRemove.toLowerCase()
  );
  return filtered.join(" ");
}

function addWordToQuery(query: string, wordToAdd: string): string {
  return `${query} ${wordToAdd}`.trim();
}

function analyzeWordPool(
  originalUserQuery: string,
  currentGithubQuery: string
): {
  original_words: string[];
  used_words: string[];
  available_words: string[];
} {
  const originalWords = originalUserQuery
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  const githubWords = currentGithubQuery
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  const usedWords: string[] = [];
  for (const originalWord of originalWords) {
    for (const githubWord of githubWords) {
      if (
        originalWord.includes(githubWord) ||
        githubWord.includes(originalWord)
      ) {
        usedWords.push(originalWord);
        break;
      }
    }
  }

  let availableWords = originalWords.filter((w) => !usedWords.includes(w));
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "with",
    "for",
    "that",
    "is",
    "built",
    "using",
    "app",
    "application",
    "to",
    "and",
    "or",
    "of",
    "in",
    "on",
    "at",
  ]);
  availableWords = availableWords.filter(
    (w) => !stopWords.has(w) && w.length > 2
  );

  return {
    original_words: originalWords,
    used_words: usedWords,
    available_words: availableWords,
  };
}

function createRetryContext(
  originalUserQuery: string,
  currentGithubQuery: string,
  currentResultsCount: number,
  retryType: string
): RetryContext {
  const wordAnalysis = analyzeWordPool(originalUserQuery, currentGithubQuery);
  return {
    original_user_query: originalUserQuery,
    current_github_query: currentGithubQuery,
    current_results_count: currentResultsCount,
    original_query_words: wordAnalysis.original_words,
    used_words: wordAnalysis.used_words,
    available_words: wordAnalysis.available_words,
    retry_type: retryType,
  };
}

async function searchWithIntelligentRetryInner(
  openrouterApiKey: string,
  githubToken: string,
  originalQuery: string,
  broadResultsThreshold: number,
  fewResultsThreshold: number,
  maxRetries: number
): Promise<SearchRetryResult> {
  const startTime = Date.now();
  const retryAttempts: RetryAttempt[] = [];
  let currentQuery = originalQuery;

  let githubQuery = await translateQuery(openrouterApiKey, currentQuery);
  let attemptStart = Date.now();
  let searchResults = await searchGitHubRepositories(githubToken, githubQuery);
  let attemptTime = Date.now() - attemptStart;

  retryAttempts.push({
    attempt_number: 0,
    retry_type: "INITIAL",
    query_used: currentQuery,
    github_query: githubQuery,
    word_action: null,
    action_type: "NONE",
    results_count: searchResults.total_count,
    response_time_ms: attemptTime,
  });

  const originalWordCount = originalQuery.split(/\s+/).filter(Boolean).length;
  let resultsCount = searchResults.total_count;

  if (
    fewResultsThreshold < resultsCount &&
    resultsCount <= broadResultsThreshold
  ) {
    const totalTime = Date.now() - startTime;
    return {
      final_repositories: searchResults.items,
      final_total_count: searchResults.total_count,
      original_query: originalQuery,
      final_github_query: githubQuery,
      retry_attempts: retryAttempts,
      total_response_time_ms: totalTime,
      success_on_retry: false,
    };
  }

  for (let retryNum = 1; retryNum <= maxRetries; retryNum++) {
    let retryType: string;
    let wordToModify: string;
    let actionType: string;
    let modifiedGithubQuery: string;

    if (resultsCount === 0) {
      retryType = "ZERO_RETRY";
      console.warn(
        `Retry ${retryNum}: Zero results - identifying rare word for GitHub query '${githubQuery}'`
      );
      wordToModify = await identifyRareWord(openrouterApiKey, githubQuery);
      actionType = "REMOVED";
      if (!wordToModify) {
        console.warn(`No rare word identified for retry ${retryNum}`);
        break;
      }
      modifiedGithubQuery = removeWordFromQuery(githubQuery, wordToModify);
    } else if (0 < resultsCount && resultsCount <= fewResultsThreshold) {
      retryType = "FEW_RETRY";
      console.warn(
        `Retry ${retryNum}: Few results (${resultsCount}) - identifying rare word for GitHub query '${githubQuery}'`
      );
      wordToModify = await identifyRareWord(openrouterApiKey, githubQuery);
      actionType = "REMOVED";
      if (!wordToModify) {
        console.warn(`No rare word identified for retry ${retryNum}`);
        break;
      }
      modifiedGithubQuery = removeWordFromQuery(githubQuery, wordToModify);
    } else if (
      resultsCount > broadResultsThreshold &&
      originalWordCount >= 3
    ) {
      retryType = "BROAD_RETRY";
      console.warn(
        `Retry ${retryNum}: Broad results (${resultsCount}) - checking for available specificity words`
      );
      const retryContext = createRetryContext(
        originalQuery,
        githubQuery,
        resultsCount,
        retryType
      );
      if (!retryContext.available_words.length) {
        console.warn(
          `Retry ${retryNum}: No available words from original query to add specificity. Available: ${retryContext.available_words}`
        );
      } else {
        console.warn(
          `Retry ${retryNum}: Available words for specificity: ${retryContext.available_words}`
        );
      }
      wordToModify = await identifySpecificityWord(
        openrouterApiKey,
        retryContext
      );
      actionType = "ADDED";
      if (!wordToModify) {
        console.warn(
          `No specificity word identified for retry ${retryNum} (original words: ${retryContext.original_query_words}, used: ${retryContext.used_words}, available: ${retryContext.available_words})`
        );
        break;
      }
      modifiedGithubQuery = addWordToQuery(githubQuery, wordToModify);
      console.warn(
        `Retry ${retryNum}: Adding '${wordToModify}' to GitHub query '${githubQuery}' -> '${modifiedGithubQuery}'`
      );
    } else {
      break;
    }

    if (
      modifiedGithubQuery === githubQuery ||
      !modifiedGithubQuery.trim()
    ) {
      console.warn(
        `Unable to modify GitHub query meaningfully for retry ${retryNum}`
      );
      break;
    }

    const newGithubQuery = modifiedGithubQuery;
    attemptStart = Date.now();
    searchResults = await searchGitHubRepositories(githubToken, newGithubQuery);
    attemptTime = Date.now() - attemptStart;

    retryAttempts.push({
      attempt_number: retryNum,
      retry_type: retryType,
      query_used: originalQuery,
      github_query: newGithubQuery,
      word_action: wordToModify,
      action_type: actionType,
      results_count: searchResults.total_count,
      response_time_ms: attemptTime,
    });

    console.warn(
      `Retry ${retryNum}: ${actionType} '${wordToModify}', got ${searchResults.total_count} results`
    );

    const newResultsCount = searchResults.total_count;
    const broadRetrySuccess =
      retryType === "BROAD_RETRY" &&
      (newResultsCount <= broadResultsThreshold ||
        newResultsCount < resultsCount * 0.5);

    if (
      (retryType === "ZERO_RETRY" && newResultsCount > 0) ||
      (retryType === "FEW_RETRY" &&
        newResultsCount > fewResultsThreshold) ||
      broadRetrySuccess
    ) {
      const totalTime = Date.now() - startTime;
      return {
        final_repositories: searchResults.items,
        final_total_count: searchResults.total_count,
        original_query: originalQuery,
        final_github_query: newGithubQuery,
        retry_attempts: retryAttempts,
        total_response_time_ms: totalTime,
        success_on_retry: true,
      };
    }

    currentQuery = originalQuery;
    githubQuery = newGithubQuery;
    resultsCount = newResultsCount;
  }

  const totalTime = Date.now() - startTime;
  return {
    final_repositories: searchResults.items,
    final_total_count: searchResults.total_count,
    original_query: originalQuery,
    final_github_query: githubQuery,
    retry_attempts: retryAttempts,
    total_response_time_ms: totalTime,
    success_on_retry: false,
  };
}

function buildRetryInfo(retryResult: SearchRetryResult): SearchApiResponse["retry_info"] {
  const attempts = retryResult.retry_attempts;
  const word_actions = attempts.slice(1).reduce<
    SearchApiResponse["retry_info"]["word_actions"]
  >((acc, attempt, idx) => {
    if (!attempt.word_action) return acc;
    const resultsBefore = attempts[idx]?.results_count ?? attempts[0].results_count;
    acc.push({
      type: attempt.retry_type,
      action: attempt.action_type,
      word: attempt.word_action,
      results_before: resultsBefore,
      results_after: attempt.results_count,
    });
    return acc;
  }, []);

  return {
    success_on_retry: retryResult.success_on_retry,
    retry_attempts: Math.max(0, attempts.length - 1),
    word_actions,
  };
}

export async function searchWithIntelligentRetry(
  originalQuery: string,
  options: {
    openrouterApiKey: string;
    githubToken: string;
    broadResultsThreshold?: number;
    fewResultsThreshold?: number;
    maxRetries?: number;
  }
): Promise<SearchApiResponse> {
  const broadResultsThreshold = options.broadResultsThreshold ?? 1000;
  const fewResultsThreshold = options.fewResultsThreshold ?? 3;
  const maxRetries = options.maxRetries ?? 3;

  const retryResult = await searchWithIntelligentRetryInner(
    options.openrouterApiKey,
    options.githubToken,
    originalQuery.trim(),
    broadResultsThreshold,
    fewResultsThreshold,
    maxRetries
  );

  return {
    github_query: retryResult.final_github_query,
    repositories: retryResult.final_repositories,
    total_count: retryResult.final_total_count,
    response_time_ms: retryResult.total_response_time_ms,
    retry_info: buildRetryInfo(retryResult),
  };
}
