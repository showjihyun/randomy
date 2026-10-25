import { useEffect, useState } from "react";
import {
  createNote,
  fetchHealth,
  fetchNote,
  fetchNotes,
  fetchTodos,
  updateTodoDone,
  type Note,
  type Todo,
} from "./api";
import Organize from "./Organize";

type View =
  | { kind: "list" }
  | { kind: "loading" }
  | { kind: "detail"; note: Note }
  | { kind: "missing" }
  | { kind: "form" }
  | { kind: "organize" };

export default function App() {
  const [status, setStatus] = useState("서버 확인 중");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<"notes" | "todos">("notes");
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);

  function openForm() {
    setDraftTitle("");
    setDraftBody("");
    setSaveFailed(false);
    setView({ kind: "form" });
  }

  function saveNote() {
    if (draftBody.trim() === "") {
      return;
    }
    setSaveFailed(false);
    createNote(draftTitle, draftBody)
      .then((note) => {
        setNotes((prev) => [note, ...(prev ?? [])]);
        setView({ kind: "detail", note });
      })
      .catch(() => setSaveFailed(true));
  }

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

  function loadTodos() {
    fetchTodos()
      .then((list) => setTodos(Array.isArray(list) ? list : []))
      .catch(() => setTodos([]));
  }

  function showTodosTab() {
    setTab("todos");
    setView({ kind: "list" });
    loadTodos();
  }

  function showNotesTab() {
    setTab("notes");
    setView({ kind: "list" });
  }

  function toggleTodo(todo: Todo) {
    updateTodoDone(todo.id, !todo.done)
      .then(loadTodos)
      .catch(loadTodos);
  }

  function openOriginNote(id: number) {
    setTab("notes");
    openNote(id);
  }

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
      <div>
        <button type="button" onClick={showNotesTab}>
          노트
        </button>
        <button type="button" onClick={showTodosTab}>
          할 일
        </button>
      </div>
      {tab === "todos" && todos !== null && todos.length === 0 && <p>할 일이 없습니다</p>}
      {tab === "todos" && todos !== null && todos.length > 0 && (
        <ul>
          {todos.map((todo) => (
            <li key={todo.id}>
              <label>
                <input type="checkbox" checked={todo.done} onChange={() => toggleTodo(todo)} />
                {todo.done ? <s>{todo.task}</s> : <span>{todo.task}</span>}
              </label>
              {todo.owner !== null && <span> 담당: {todo.owner}</span>}
              {todo.due !== null && <span> 기한: {todo.due}</span>}{" "}
              <button type="button" onClick={() => openOriginNote(todo.note_id)}>
                원본 노트
              </button>
            </li>
          ))}
        </ul>
      )}
      {tab === "notes" && view.kind === "list" && (
        <button type="button" onClick={openForm}>
          새 노트
        </button>
      )}
      {tab === "notes" && view.kind === "list" && (
        <button type="button" onClick={() => setView({ kind: "organize" })}>
          정리
        </button>
      )}
      {tab === "notes" && view.kind === "organize" && (
        <Organize
          onSaved={(note) => {
            setNotes((prev) => [note, ...(prev ?? [])]);
            openNote(note.id);
          }}
        />
      )}
      {tab === "notes" && view.kind === "form" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveNote();
          }}
        >
          <label>
            제목
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
          </label>
          <label>
            본문
            <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
          </label>
          {saveFailed && <p>저장하지 못했습니다</p>}
          <button type="submit" disabled={draftBody.trim() === ""}>
            저장
          </button>
          <button type="button" onClick={() => setView({ kind: "list" })}>
            취소
          </button>
        </form>
      )}
      {tab === "notes" && view.kind === "list" && notes !== null && notes.length === 0 && (
        <p>저장된 노트가 없습니다</p>
      )}
      {tab === "notes" && view.kind === "list" && notes !== null && notes.length > 0 && (
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
      {tab === "notes" && view.kind === "detail" && (
        <article>
          <h2>{view.note.title}</h2>
          <time dateTime={view.note.created_at}>{view.note.created_at}</time>
          <p>{view.note.body}</p>
          {backButton}
        </article>
      )}
      {tab === "notes" && view.kind === "missing" && (
        <div>
          <p>노트를 찾을 수 없습니다</p>
          {backButton}
        </div>
      )}
    </main>
  );
}
