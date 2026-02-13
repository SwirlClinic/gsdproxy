// ── Top-level event discriminated union ──────────────────────────────────────

export type ClaudeStreamEvent =
  | SystemInitEvent
  | AssistantEvent
  | ResultEvent
  | StreamEvent;

// ── Session types ────────────────────────────────────────────────────────────

export type SessionState = "idle" | "processing" | "dead";

export interface SessionOptions {
  cwd: string;
  ipcPort: number;
  dangerouslySkipPermissions?: boolean;
}

// ── System ───────────────────────────────────────────────────────────────────

export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  cwd: string;
  tools: string[];
  model: string;
  mcp_servers?: string[];
  slash_commands?: string[];
}

// ── Stream events (partial / real-time) ──────────────────────────────────────

export interface StreamEvent {
  type: "stream_event";
  session_id: string;
  event:
    | ContentBlockStart
    | ContentBlockDelta
    | ContentBlockStop
    | MessageStart
    | MessageDelta
    | MessageStop;
}

// Content block lifecycle
export interface ContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block: TextBlock | ToolUseBlock;
}

export interface ContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta: TextDelta | InputJsonDelta;
}

export interface ContentBlockStop {
  type: "content_block_stop";
  index: number;
}

// Message lifecycle
export interface MessageStart {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
  };
}

export interface MessageDelta {
  type: "message_delta";
  delta: {
    stop_reason: string | null;
  };
  usage?: {
    output_tokens: number;
  };
}

export interface MessageStop {
  type: "message_stop";
}

// ── Delta types ──────────────────────────────────────────────────────────────

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface InputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

// ── Block types ──────────────────────────────────────────────────────────────

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ── Assistant (complete message) ─────────────────────────────────────────────

export interface AssistantEvent {
  type: "assistant";
  session_id: string;
  message: {
    role: "assistant";
    content: Array<TextBlock | ToolUseBlock>;
  };
}

// ── Result ───────────────────────────────────────────────────────────────────

export interface ResultEvent {
  type: "result";
  subtype: "success" | "error_max_turns" | string;
  session_id: string;
  is_error: boolean;
  duration_ms?: number;
  num_turns?: number;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

