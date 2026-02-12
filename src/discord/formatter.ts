const MAX_CHUNKS = 10;
const DEFAULT_MAX_LENGTH = 1900;
const MIN_CHUNK_RATIO = 0.5;

/**
 * Split a long message into chunks that fit within Discord's message limit.
 * Splits at natural boundaries (paragraph, line, space) and never breaks
 * code blocks mid-fence.
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
    // Check chunk cap
    if (chunks.length === MAX_CHUNKS - 1) {
      // This is the last allowed chunk
      if (remaining.length > maxLength) {
        const truncated = remaining.slice(0, maxLength);
        const charsLeft = remaining.length - maxLength;
        // If we're in a code block, close it before the truncation notice
        let finalChunk = truncated;
        if (inCodeBlock) {
          // Reserve space for closing fence + truncation notice
          const notice = `\n\`\`\`\n... (output truncated, ${charsLeft + (maxLength - truncated.length)} chars remaining)`;
          const available = maxLength - notice.length;
          finalChunk =
            remaining.slice(0, Math.max(0, available)) +
            notice;
        } else {
          const notice = `\n... (output truncated, ${charsLeft} chars remaining)`;
          const available = maxLength - notice.length;
          finalChunk = remaining.slice(0, Math.max(0, available)) + notice;
        }
        chunks.push(finalChunk);
      } else {
        chunks.push(remaining);
      }
      break;
    }

    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point
    const splitIndex = findSplitPoint(
      remaining,
      maxLength,
      inCodeBlock,
      codeBlockLang
    );

    let chunk = remaining.slice(0, splitIndex);
    remaining = remaining.slice(splitIndex);

    // Track code block state through the chunk
    const { isInCodeBlock, lang } = trackCodeBlockState(
      chunk,
      inCodeBlock,
      codeBlockLang
    );

    // If we end the chunk inside a code block, close it and reopen in next chunk
    if (isInCodeBlock) {
      chunk = chunk + "\n```";
      inCodeBlock = true;
      codeBlockLang = lang;
      // Prepend reopening fence to remaining content
      remaining = "```" + lang + "\n" + remaining.trimStart();
    } else {
      inCodeBlock = false;
      codeBlockLang = "";
    }

    chunks.push(chunk);

    // Trim leading whitespace from remaining (but not if inside code block)
    if (!inCodeBlock) {
      remaining = remaining.trimStart();
    }
  }

  return chunks;
}

/**
 * Find the best split point within content, respecting natural boundaries
 * and code blocks.
 */
function findSplitPoint(
  content: string,
  maxLength: number,
  inCodeBlock: boolean,
  _codeBlockLang: string
): number {
  const minLength = Math.floor(maxLength * MIN_CHUNK_RATIO);

  // If we're not in a code block, try to avoid splitting into one
  if (!inCodeBlock) {
    // Check if there's a code fence within the maxLength range
    const fenceMatch = findCodeFenceInRange(content, maxLength);
    if (fenceMatch !== null) {
      // There's an opening fence. Find its closing fence.
      const closingFence = content.indexOf("```", fenceMatch.end);
      if (closingFence !== -1) {
        const blockEnd =
          closingFence + 3 + (content[closingFence + 3] === "\n" ? 1 : 0);
        // If the entire code block fits, include it
        if (blockEnd <= maxLength) {
          // Try to split after the code block
          return findNaturalBreak(content, maxLength, minLength, blockEnd);
        }
        // Code block doesn't fit -- split before it if possible
        if (fenceMatch.start > minLength) {
          return fenceMatch.start;
        }
        // Can't split before it (too close to start) -- we'll split inside
        // Fall through to natural break logic, code block state tracking will handle it
      }
    }
  }

  return findNaturalBreak(content, maxLength, minLength, 0);
}

/**
 * Find a natural break point (paragraph, line, space) in content.
 */
function findNaturalBreak(
  content: string,
  maxLength: number,
  minLength: number,
  afterIndex: number
): number {
  // Try paragraph boundary (double newline)
  const paraBreak = content.lastIndexOf("\n\n", maxLength);
  if (paraBreak >= minLength && paraBreak >= afterIndex) {
    return paraBreak;
  }

  // Try line boundary
  const lineBreak = content.lastIndexOf("\n", maxLength);
  if (lineBreak >= minLength && lineBreak >= afterIndex) {
    return lineBreak;
  }

  // Try space boundary
  const spaceBreak = content.lastIndexOf(" ", maxLength);
  if (spaceBreak >= minLength && spaceBreak >= afterIndex) {
    return spaceBreak;
  }

  // Hard split at maxLength
  return maxLength;
}

/**
 * Find the first code fence (``` with optional language) in the content
 * within the given range.
 */
function findCodeFenceInRange(
  content: string,
  maxLength: number
): { start: number; end: number; lang: string } | null {
  const fenceRegex = /^```(\w*)\s*$/gm;
  let match: RegExpExecArray | null;
  let openFence: { start: number; end: number; lang: string } | null = null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index >= maxLength) break;

    if (openFence === null) {
      // This is an opening fence
      openFence = {
        start: match.index,
        end: match.index + match[0].length,
        lang: match[1],
      };
      return openFence;
    }
  }

  return null;
}

/**
 * Track whether we're inside a code block after processing some content.
 * Returns the final state.
 */
function trackCodeBlockState(
  content: string,
  initiallyInBlock: boolean,
  initialLang: string
): { isInCodeBlock: boolean; lang: string } {
  let inBlock = initiallyInBlock;
  let lang = initialLang;

  const fenceRegex = /^```(\w*)\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (inBlock) {
      // This is a closing fence
      inBlock = false;
      lang = "";
    } else {
      // This is an opening fence
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
  if (input) {
    switch (toolName) {
      case "Read":
        if (input.file_path) return `*Reading ${input.file_path}...*`;
        break;
      case "Glob":
        if (input.pattern) return `*Searching for ${input.pattern}...*`;
        break;
      case "Grep":
        if (input.pattern) return `*Searching for ${input.pattern}...*`;
        break;
      case "Bash":
        if (input.command) return `*Running ${input.command}...*`;
        break;
      case "Write":
        if (input.file_path) return `*Writing ${input.file_path}...*`;
        break;
      case "Edit":
        if (input.file_path) return `*Editing ${input.file_path}...*`;
        break;
    }
  }

  return `*Using ${toolName}...*`;
}
