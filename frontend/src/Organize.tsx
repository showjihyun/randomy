import { useState } from "react";
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
    <section>
      <textarea aria-label="원문" value={raw} onChange={(e) => setRaw(e.target.value)} />
      <button type="button" disabled={raw.trim() === "" || busy} onClick={runOrganize}>
        정리
      </button>
      {error !== null && (
        <div role="alert">
          <p>{error.head}</p>
          {error.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {edit !== null && (
        <div>
          <input aria-label="제목" value={edit.title} onChange={(e) => patch({ title: e.target.value })} />
          <textarea aria-label="요약" value={edit.summary} onChange={(e) => patch({ summary: e.target.value })} />
          <h3>결정 사항</h3>
          {edit.decisions.length === 0 && <p>없음</p>}
          {edit.decisions.map((d, i) => (
            <div key={i}>
              <input
                aria-label={`결정 ${i + 1}`}
                value={d}
                onChange={(e) =>
                  patch({ decisions: edit.decisions.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <button
                type="button"
                onClick={() => patch({ decisions: edit.decisions.filter((_, j) => j !== i) })}
              >
                {`결정 ${i + 1} 삭제`}
              </button>
            </div>
          ))}
          <button type="button" onClick={() => patch({ decisions: [...edit.decisions, ""] })}>
            결정 추가
          </button>
          <h3>할 일</h3>
          {edit.todos.length === 0 && <p>없음</p>}
          {edit.todos.map((t, i) => (
            <div key={i}>
              <input aria-label={`할 일 ${i + 1}`} value={t.task} onChange={(e) => patchTodo(i, { task: e.target.value })} />
              <input aria-label={`담당 ${i + 1}`} value={t.owner} onChange={(e) => patchTodo(i, { owner: e.target.value })} />
              <input aria-label={`기한 ${i + 1}`} value={t.due} onChange={(e) => patchTodo(i, { due: e.target.value })} />
              <button type="button" onClick={() => patch({ todos: edit.todos.filter((_, j) => j !== i) })}>
                {`할 일 ${i + 1} 삭제`}
              </button>
            </div>
          ))}
          <button type="button" onClick={() => patch({ todos: [...edit.todos, { task: "", owner: "", due: "" }] })}>
            할 일 추가
          </button>
          <button type="button" disabled={saving} onClick={save}>
            저장
          </button>
        </div>
      )}
    </section>
  );
}
