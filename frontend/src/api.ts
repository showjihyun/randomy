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
