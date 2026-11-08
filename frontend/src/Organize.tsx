import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, organize, saveOrganized, type Note } from "./api";

type TodoRow = { task: string; owner: string; due: string };
type Edit = { title: string; summary: string; decisions: string[]; todos: TodoRow[] };

function errorText(prefix: string, error: unknown): { head: string; lines: string[] } {
  if (error instanceof ApiError) {
    return { head: prefix, lines: [...(error.message ? [error.message] : []), ...error.problems] };
  }
  return { head: prefix, lines: [] };
}

export default function Organize({ onSaved }: { onSaved: (note: Note) => void }) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState<{ head: string; lines: string[] } | null>(null);

  function runOrganize() {
    if (raw.trim() === "" || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    organize(raw)
      .then((result) => {
        setEdit((prev) => ({
          title: prev?.title ?? "",
          summary: result.summary,
          decisions: result.decisions,
          todos: result.todos.map((t) => ({ task: t.task, owner: t.owner ?? "", due: t.due ?? "" })),
        }));
      })
      .catch((e: unknown) => setError(errorText("정리하지 못했습니다", e)))
      .finally(() => setBusy(false));
  }

  function save() {
    if (edit === null || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    saveOrganized({
      title: edit.title,
      body: raw,
      summary: edit.summary,
      decisions: edit.decisions,
      todos: edit.todos.map((t) => ({
        task: t.task,
        owner: t.owner === "" ? null : t.owner,
        due: t.due === "" ? null : t.due,
      })),
    })
      .then((saved) => onSaved(saved.note))
      .catch((e: unknown) => {
        setSaving(false);
        setError(errorText("저장하지 못했습니다", e));
      });
  }

  function patch(change: Partial<Edit>) {
    setEdit((prev) => (prev === null ? prev : { ...prev, ...change }));
  }

  function patchTodo(i: number, change: Partial<TodoRow>) {
    if (edit !== null) {
      patch({ todos: edit.todos.map((t, j) => (j === i ? { ...t, ...change } : t)) });
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <Textarea aria-label="원문" className="min-h-56" value={raw} onChange={(e) => setRaw(e.target.value)} />
      <div className="flex justify-end">
        <Button type="button" disabled={raw.trim() === "" || busy} onClick={runOrganize}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          정리
        </Button>
      </div>
      {error !== null && (
        <Alert variant="destructive">
          <AlertTitle>{error.head}</AlertTitle>
          <AlertDescription>
            {error.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}
      {edit !== null && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Input aria-label="제목" value={edit.title} onChange={(e) => patch({ title: e.target.value })} />
            <Textarea aria-label="요약" value={edit.summary} onChange={(e) => patch({ summary: e.target.value })} />
            <Separator />
            <h3 className="text-base font-semibold">결정 사항</h3>
            {edit.decisions.length === 0 && <p className="text-sm text-muted-foreground">없음</p>}
            {edit.decisions.map((d, i) => (
              <div key={i} className="flex items-start gap-2">
                <Input
                  aria-label={`결정 ${i + 1}`}
                  value={d}
                  onChange={(e) =>
                    patch({ decisions: edit.decisions.map((x, j) => (j === i ? e.target.value : x)) })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ decisions: edit.decisions.filter((_, j) => j !== i) })}
                >
                  {`결정 ${i + 1} 삭제`}
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ decisions: [...edit.decisions, ""] })}
              >
                결정 추가
              </Button>
            </div>
            <Separator />
            <h3 className="text-base font-semibold">할 일</h3>
            {edit.todos.length === 0 && <p className="text-sm text-muted-foreground">없음</p>}
            {edit.todos.map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                  <Input aria-label={`할 일 ${i + 1}`} value={t.task} onChange={(e) => patchTodo(i, { task: e.target.value })} />
                  <Input aria-label={`담당 ${i + 1}`} value={t.owner} onChange={(e) => patchTodo(i, { owner: e.target.value })} />
                  <Input aria-label={`기한 ${i + 1}`} value={t.due} onChange={(e) => patchTodo(i, { due: e.target.value })} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ todos: edit.todos.filter((_, j) => j !== i) })}
                >
                  {`할 일 ${i + 1} 삭제`}
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ todos: [...edit.todos, { task: "", owner: "", due: "" }] })}
              >
                할 일 추가
              </Button>
            </div>
            <div className="flex justify-end">
              <Button type="button" disabled={saving} onClick={save}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                저장
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
