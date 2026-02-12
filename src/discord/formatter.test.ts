import { describe, it, expect } from "vitest";
import { splitMessage, formatToolActivity } from "./formatter.js";

describe("splitMessage", () => {
  describe("basic cases", () => {
    it("returns empty array for empty string", () => {
      expect(splitMessage("")).toEqual([]);
    });

    it("returns single-element array for short message", () => {
      expect(splitMessage("short message")).toEqual(["short message"]);
    });

    it("returns single-element array when content equals maxLength", () => {
      const content = "a".repeat(1900);
      expect(splitMessage(content)).toEqual([content]);
    });

    it("does not split when total is under maxLength", () => {
      const content = "para1\n\npara2";
      expect(splitMessage(content)).toEqual(["para1\n\npara2"]);
    });
  });

  describe("splitting at paragraph boundaries", () => {
    it("splits at double newline when total exceeds maxLength", () => {
      const para1 = "a".repeat(1000);
      const para2 = "b".repeat(1000);
      const content = `${para1}\n\n${para2}`;
      const result = splitMessage(content);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(para1);
      expect(result[1]).toBe(para2);
    });
  });

  describe("splitting at line boundaries", () => {
    it("splits at single newline when no paragraph breaks exist", () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line${i} ${"x".repeat(80)}`);
      const content = lines.join("\n");
      const result = splitMessage(content, 500);
      expect(result.length).toBeGreaterThan(1);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
    });
  });

  describe("splitting at space boundaries", () => {
    it("splits at last space when no line breaks exist", () => {
      const words = Array.from({ length: 300 }, (_, i) => `word${i}`);
      const content = words.join(" ");
      const result = splitMessage(content, 100);
      expect(result.length).toBeGreaterThan(1);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("hard splitting", () => {
    it("hard splits when no natural break points exist", () => {
      const content = "a".repeat(5000);
      const result = splitMessage(content, 1000);
      expect(result.length).toBe(5);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe("code block preservation", () => {
    it("keeps short code blocks intact in one chunk", () => {
      const before = "some text before\n";
      const codeBlock = "```js\nconst x = 1;\nconst y = 2;\n```";
      const after = "\nsome text after";
      const content = before + codeBlock + after;
      const result = splitMessage(content);
      // The code block should not be split
      const chunkWithCode = result.find((c) => c.includes("```js"));
      expect(chunkWithCode).toBeDefined();
      expect(chunkWithCode).toContain("```js");
      expect(chunkWithCode).toContain("```");
      // Verify no orphaned code fences
      for (const chunk of result) {
        const fenceCount = (chunk.match(/```/g) || []).length;
        expect(fenceCount % 2).toBe(0);
      }
    });

    it("closes and reopens code blocks when they exceed maxLength", () => {
      const longCode = "x".repeat(300);
      const content = `text before\n\`\`\`js\n${longCode}\n\`\`\`\ntext after`;
      const result = splitMessage(content, 200);
      expect(result.length).toBeGreaterThan(1);
      // Every chunk must have balanced code fences
      for (const chunk of result) {
        const fenceCount = (chunk.match(/```/g) || []).length;
        expect(fenceCount % 2).toBe(0);
      }
      // First chunk with code should close the fence
      // Next chunk should reopen with the language tag
      const codeChunks = result.filter((c) => c.includes("```"));
      expect(codeChunks.length).toBeGreaterThanOrEqual(2);
    });

    it("never produces chunks exceeding maxLength", () => {
      const longCode = "console.log('hello');\n".repeat(200);
      const content = `intro\n\`\`\`js\n${longCode}\`\`\`\noutro`;
      const result = splitMessage(content, 500);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
    });

    it("preserves language tag when reopening code blocks", () => {
      const longCode = "y".repeat(400);
      const content = `\`\`\`typescript\n${longCode}\n\`\`\``;
      const result = splitMessage(content, 200);
      // The reopened code blocks should include the language tag
      const reopenedChunks = result.slice(1).filter((c) => c.includes("```"));
      for (const chunk of reopenedChunks) {
        if (chunk.startsWith("```")) {
          expect(chunk.startsWith("```typescript")).toBe(true);
        }
      }
    });
  });

  describe("chunk count cap", () => {
    it("caps at 10 chunks with truncation notice", () => {
      const content = "a".repeat(20000);
      const result = splitMessage(content, 1000);
      expect(result.length).toBe(10);
      expect(result[9]).toContain("(output truncated,");
      expect(result[9]).toContain("chars remaining)");
    });

    it("does not add truncation notice when under 10 chunks", () => {
      const content = "a".repeat(5000);
      const result = splitMessage(content, 1000);
      expect(result.length).toBeLessThanOrEqual(10);
      for (const chunk of result) {
        expect(chunk).not.toContain("(output truncated,");
      }
    });
  });

  describe("custom maxLength", () => {
    it("respects custom maxLength parameter", () => {
      const content = "a".repeat(200);
      const result = splitMessage(content, 50);
      expect(result.length).toBe(4);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(50);
      }
    });
  });

  describe("no orphaned code fences in any scenario", () => {
    it("handles nested-looking code fences", () => {
      const content = "text\n```\nsome code\n```\n\nmore text\n```python\nprint('hello')\n```";
      const result = splitMessage(content, 50);
      for (const chunk of result) {
        const fenceCount = (chunk.match(/```/g) || []).length;
        expect(fenceCount % 2).toBe(0);
      }
    });
  });
});

describe("formatToolActivity", () => {
  it("formats Read tool with file path", () => {
    expect(formatToolActivity("Read", { file_path: "/src/auth.ts" })).toBe(
      "*Reading /src/auth.ts...*"
    );
  });

  it("formats Glob tool with pattern", () => {
    expect(formatToolActivity("Glob", { pattern: "**/*.ts" })).toBe(
      "*Searching for **/*.ts...*"
    );
  });

  it("formats Grep tool with pattern", () => {
    expect(formatToolActivity("Grep", { pattern: "TODO" })).toBe(
      "*Searching for TODO...*"
    );
  });

  it("formats Bash tool with command", () => {
    expect(formatToolActivity("Bash", { command: "npm test" })).toBe(
      "*Running npm test...*"
    );
  });

  it("formats Write tool with file path", () => {
    expect(formatToolActivity("Write", { file_path: "/src/new.ts" })).toBe(
      "*Writing /src/new.ts...*"
    );
  });

  it("formats Edit tool with file path", () => {
    expect(formatToolActivity("Edit", { file_path: "/src/fix.ts" })).toBe(
      "*Editing /src/fix.ts...*"
    );
  });

  it("formats unknown tool with generic message", () => {
    expect(formatToolActivity("CustomTool")).toBe("*Using CustomTool...*");
  });

  it("formats unknown tool with no input", () => {
    expect(formatToolActivity("SomeTool", {})).toBe("*Using SomeTool...*");
  });
});
