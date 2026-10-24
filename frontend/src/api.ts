export type Health = { status: string; model: string };

export async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`health ${response.status}`);
  }
  return (await response.json()) as Health;
}
