const MAX_CHUNKS = 10;
const DEFAULT_MAX_LENGTH = 1900;
const MIN_CHUNK_RATIO = 0.5;
const FENCE_REGEX = /^```(\w*)\s*$/gm;

/**
 * Split a long message into chunks that fit within Discord's message limit.
 * Splits at natural boundaries (paragraph, line, space) and never breaks
 * code blocks mid-fence. Each chunk has balanced code fences.
 */
export function splitMessage(
  content: string,
  maxLength: number = DEFAULT_MAX_LENGTH
): string[] {
  if (!content) return [];
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  let remaining = content;
  let inCodeBlock = false;
  let codeBlockLang = "";

  while (remaining.length > 0) {
    if (chunks.length === MAX_CHUNKS - 1) {
      chunks.push(buildFinalChunk(remaining, maxLength, inCodeBlock));
      break;
    }

    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const splitIndex = findSplitPoint(remaining, maxLength, inCodeBlock);
    let chunk = remaining.slice(0, splitIndex);
    remaining = remaining.slice(splitIndex);

    const fenceState = trackCodeBlockState(chunk, inCodeBlock, codeBlockLang);

    if (fenceState.isInCodeBlock) {
      chunk += "\n```";
      inCodeBlock = true;
      codeBlockLang = fenceState.lang;
      remaining = "```" + codeBlockLang + "\n" + remaining.trimStart();
    } else {
      inCodeBlock = false;
      codeBlockLang = "";
    }

    chunks.push(chunk);

    if (!inCodeBlock) {
      remaining = remaining.trimStart();
    }
  }

  return chunks;
}

/**
 * Build the final (10th) chunk, adding truncation notice if content exceeds maxLength.
 */
function buildFinalChunk(
  remaining: string,
  maxLength: number,
  inCodeBlock: boolean
): string {
  if (remaining.length <= maxLength) return remaining;

  const closingFence = inCodeBlock ? "\n```" : "";
  const totalRemaining = remaining.length;

  // Calculate how much content we can fit before the truncation notice
  // We need to figure out the notice length, which depends on chars remaining
  // Use an estimate first, then adjust
  const estimatedNotice = `${closingFence}\n... (output truncated, ${totalRemaining} chars remaining)`;
  const available = maxLength - estimatedNotice.length;
  const contentSlice = remaining.slice(0, Math.max(0, available));
  const charsLeft = totalRemaining - contentSlice.length;
  const notice = `${closingFence}\n... (output truncated, ${charsLeft} chars remaining)`;

  return contentSlice + notice;
}

/**
 * Find the best split point within content, respecting natural boundaries
 * and code blocks.
 */
function findSplitPoint(
  content: string,
  maxLength: number,
  inCodeBlock: boolean
): number {
  const minLength = Math.floor(maxLength * MIN_CHUNK_RATIO);

  if (!inCodeBlock) {
    const fenceMatch = findFirstCodeFence(content, maxLength);
    if (fenceMatch !== null) {
      const closingFence = content.indexOf("```", fenceMatch.end);
      if (closingFence !== -1) {
        const blockEnd =
          closingFence + 3 + (content[closingFence + 3] === "\n" ? 1 : 0);
        if (blockEnd <= maxLength) {
          return findNaturalBreak(content, maxLength, minLength, blockEnd);
        }
        if (fenceMatch.start > minLength) {
          return fenceMatch.start;
        }
      }
    }
  }

  return findNaturalBreak(content, maxLength, minLength, 0);
}

/**
 * Find a natural break point (paragraph, line, space) in content.
 * Prefers paragraph > line > space > hard split.
 */
function findNaturalBreak(
  content: string,
  maxLength: number,
  minLength: number,
  afterIndex: number
): number {
  const breakPoints = [
    content.lastIndexOf("\n\n", maxLength),
    content.lastIndexOf("\n", maxLength),
    content.lastIndexOf(" ", maxLength),
  ];

  for (const bp of breakPoints) {
    if (bp >= minLength && bp >= afterIndex) return bp;
  }

  return maxLength;
}

/**
 * Find the first opening code fence within the given range.
 */
function findFirstCodeFence(
  content: string,
  maxLength: number
): { start: number; end: number; lang: string } | null {
  const regex = new RegExp(FENCE_REGEX.source, FENCE_REGEX.flags);
  const match = regex.exec(content);

  if (match && match.index < maxLength) {
    return {
      start: match.index,
      end: match.index + match[0].length,
      lang: match[1],
    };
  }

  return null;
}

/**
 * Track code block state (open/closed) after processing content.
 * Toggles state on each fence encountered.
 */
function trackCodeBlockState(
  content: string,
  initiallyInBlock: boolean,
  initialLang: string
): { isInCodeBlock: boolean; lang: string } {
  let inBlock = initiallyInBlock;
  let lang = initialLang;
  const regex = new RegExp(FENCE_REGEX.source, FENCE_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (inBlock) {
      inBlock = false;
      lang = "";
    } else {
      inBlock = true;
      lang = match[1];
    }
  }

  return { isInCodeBlock: inBlock, lang };
}

/**
 * Format a tool activity message for display in Discord.
 * Produces italic status text describing what Claude is doing.
 */
export function formatToolActivity(
  toolName: string,
  input?: Record<string, unknown>
): string {
  const toolFormats: Record<string, { key: string; verb: string }> = {
    Read: { key: "file_path", verb: "Reading" },
    Glob: { key: "pattern", verb: "Searching for" },
    Grep: { key: "pattern", verb: "Searching for" },
    Bash: { key: "command", verb: "Running" },
    Write: { key: "file_path", verb: "Writing" },
    Edit: { key: "file_path", verb: "Editing" },
  };

  const format = toolFormats[toolName];
  if (format && input?.[format.key]) {
    return `*${format.verb} ${input[format.key]}...*`;
  }

  return `*Using ${toolName}...*`;
}
