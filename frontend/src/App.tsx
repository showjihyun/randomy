import { useEffect, useState } from "react";
import { fetchHealth, fetchNote, fetchNotes, type Note } from "./api";

type View =
  | { kind: "list" }
  | { kind: "loading" }
  | { kind: "detail"; note: Note }
  | { kind: "missing" };

export default function App() {
  const [status, setStatus] = useState("서버 확인 중");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });

  useEffect(() => {
    fetchHealth()
      .then((health) => setStatus(`서버 연결됨 (모델: ${health.model})`))
      .catch(() => setStatus("서버에 연결할 수 없습니다"));
  }, []);

  useEffect(() => {
    fetchNotes()
      .then((list) => setNotes(Array.isArray(list) ? list : []))
      .catch(() => setNotes([]));
  }, []);

  function openNote(id: number) {
    setView({ kind: "loading" });
    fetchNote(id)
      .then((note) => setView({ kind: "detail", note }))
      .catch(() => setView({ kind: "missing" }));
  }

  const backButton = (
    <button type="button" onClick={() => setView({ kind: "list" })}>
      목록으로
    </button>
  );

  return (
    <main>
      <h1>Randomy</h1>
      <p>회의록·메모를 정리하고 할 일과 결정 사항을 찾아 주는 개인 업무 보조</p>
      <p role="status">{status}</p>
      {view.kind === "list" && notes !== null && notes.length === 0 && (
        <p>저장된 노트가 없습니다</p>
      )}
      {view.kind === "list" && notes !== null && notes.length > 0 && (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" onClick={() => openNote(note.id)}>
                <span>{note.title}</span> <time dateTime={note.created_at}>{note.created_at}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.kind === "detail" && (
        <article>
          <h2>{view.note.title}</h2>
          <time dateTime={view.note.created_at}>{view.note.created_at}</time>
          <p>{view.note.body}</p>
          {backButton}
        </article>
      )}
      {view.kind === "missing" && (
        <div>
          <p>노트를 찾을 수 없습니다</p>
          {backButton}
        </div>
      )}
    </main>
  );
}
