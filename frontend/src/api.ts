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
