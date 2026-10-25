export type Health = { status: string; model: string };
export type Note = { id: number; title: string; body: string; created_at: string };

export async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`health ${response.status}`);
  }
  return (await response.json()) as Health;
}

export async function fetchNotes(): Promise<Note[]> {
  const response = await fetch("/api/notes");
  if (!response.ok) {
    throw new Error(`notes ${response.status}`);
  }
  return (await response.json()) as Note[];
}

export async function fetchNote(id: number): Promise<Note> {
  const response = await fetch(`/api/notes/${id}`);
  if (!response.ok) {
    throw new Error(`note ${response.status}`);
  }
  return (await response.json()) as Note;
}

export async function createNote(title: string, body: string): Promise<Note> {
  const response = await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  if (!response.ok) {
    throw new Error(`create note ${response.status}`);
  }
  return (await response.json()) as Note;
}

export type Todo = {
  id: number;
  note_id: number;
  task: string;
  owner: string | null;
  due: string | null;
  done: boolean;
  created_at: string;
};

export async function fetchTodos(): Promise<Todo[]> {
  const response = await fetch("/api/todos");
  if (!response.ok) {
    throw new Error(`todos ${response.status}`);
  }
  return (await response.json()) as Todo[];
}

export type OrganizeTodo = { task: string; owner: string | null; due: string | null };
export type OrganizeResult = { summary: string; decisions: string[]; todos: OrganizeTodo[] };
export type OrganizedPayload = {
  title: string;
  body: string;
  summary: string;
  decisions: string[];
  todos: OrganizeTodo[];
};
export type OrganizedSaved = {
  note: Note;
  summary: string;
  decisions: { id: number; note_id: number; text: string; created_at: string }[];
  todos: Todo[];
};

export class ApiError extends Error {
  problems: string[];
  constructor(message: string, problems: string[]) {
    super(message);
    this.problems = problems;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let message = "";
  let problems: string[] = [];
  try {
    const data = (await response.json()) as { detail?: unknown };
    const detail = data.detail;
    if (detail !== null && typeof detail === "object" && !Array.isArray(detail)) {
      const d = detail as { message?: unknown; problems?: unknown };
      if (typeof d.message === "string") {
        message = d.message;
      }
      if (Array.isArray(d.problems)) {
        problems = d.problems.map((p) => String(p));
      }
    }
  } catch {
    // 본문이 JSON이 아니면 상태 코드만 남긴다.
  }
  return new ApiError(message, problems);
}

async function postJson(path: string, payload: unknown): Promise<Response> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response;
}

export async function organize(text: string): Promise<OrganizeResult> {
  const response = await postJson("/api/organize", { text });
  return (await response.json()) as OrganizeResult;
}

export async function saveOrganized(payload: OrganizedPayload): Promise<OrganizedSaved> {
  const response = await postJson("/api/organized", payload);
  return (await response.json()) as OrganizedSaved;
}

export type SearchNote = { id: number; title: string; snippet: string; created_at: string };
export type SearchDecision = {
  id: number;
  note_id: number;
  note_title: string;
  text: string;
  created_at: string;
};
export type SearchResult = { notes: SearchNote[]; decisions: SearchDecision[] };
export type AskSource = { id: number; title: string; created_at: string };
export type AskResult = { answer: string; sources: AskSource[] };

export async function search(q: string): Promise<SearchResult> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as SearchResult;
}

export async function ask(question: string): Promise<AskResult> {
  const response = await postJson("/api/ask", { question });
  return (await response.json()) as AskResult;
}

export async function updateTodoDone(id: number, done: boolean): Promise<Todo> {
  const response = await fetch(`/api/todos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (!response.ok) {
    throw new Error(`todo ${response.status}`);
  }
  return (await response.json()) as Todo;
}
