import { useEffect, useState, type ReactNode } from "react";
import { CalendarRange, ListTodo, NotebookPen, Search as SearchIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { formatDateTime } from "@/lib/format";
import Organize from "./Organize";
import Search from "./Search";
import Weekly from "./Weekly";

type View =
  | { kind: "list" }
  | { kind: "loading" }
  | { kind: "detail"; note: Note }
  | { kind: "missing" }
  | { kind: "form" }
  | { kind: "organize" }
  | { kind: "search" };

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center">{children}</div>;
}

const PAGE_TITLE = "text-2xl font-semibold tracking-tight";

export default function App() {
  const [status, setStatus] = useState("서버 확인 중");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<"notes" | "todos" | "search" | "weekly">("notes");
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
    <Button type="button" variant="outline" onClick={() => setView({ kind: "list" })}>
      목록으로
    </Button>
  );

  const tabs = [
    { tab: "notes", label: "노트", icon: NotebookPen, onClick: showNotesTab },
    { tab: "todos", label: "할 일", icon: ListTodo, onClick: showTodosTab },
    {
      tab: "search",
      label: "찾기",
      icon: SearchIcon,
      onClick: () => {
        setTab("search");
        setView({ kind: "search" });
      },
    },
    {
      tab: "weekly",
      label: "주간 정리",
      icon: CalendarRange,
      onClick: () => {
        setTab("weekly");
        setView({ kind: "list" });
      },
    },
  ] as const;

  return (
    <div className="min-h-screen lg:flex">
      <aside className="bg-sidebar lg:w-56 lg:border-r">
        <div className="px-4 pt-4 lg:pt-6">
          <h1 className="text-lg font-semibold">Randomy</h1>
          <p className="text-xs text-muted-foreground">
            회의록·메모를 정리하고 할 일과 결정 사항을 찾아 주는 개인 업무 보조
          </p>
        </div>
        <div className="flex gap-1 px-4 py-3 lg:flex-col">
          {tabs.map(({ tab: key, label, icon: Icon, onClick }) => (
            <Button
              key={key}
              type="button"
              variant="ghost"
              size="sm"
              aria-current={tab === key ? "page" : undefined}
              className={`flex-1 px-2 lg:flex-none lg:justify-start ${
                tab === key ? "bg-accent font-medium text-accent-foreground" : ""
              }`}
              onClick={onClick}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
      </aside>
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-8">
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {status}
          </p>
          {tab === "weekly" && <Weekly onOpenNote={openOriginNote} />}
          {tab === "search" && <Search onOpenNote={openOriginNote} />}
          {tab === "todos" && (
            <div className="space-y-4">
              <h2 className={PAGE_TITLE}>할 일</h2>
              {todos !== null && todos.length === 0 && <EmptyState>할 일이 없습니다</EmptyState>}
              {todos !== null && todos.length > 0 && (
                <Card className="py-2">
                  <ul className="divide-y">
                    {todos.map((todo) => (
                      <li key={todo.id} className="flex flex-wrap items-center gap-2 px-6 py-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={todo.done}
                            onChange={() => toggleTodo(todo)}
                          />
                          {todo.done ? (
                            <s className="text-muted-foreground line-through">{todo.task}</s>
                          ) : (
                            <span>{todo.task}</span>
                          )}
                        </label>
                        {todo.owner !== null && (
                          <Badge variant="secondary">담당: {todo.owner}</Badge>
                        )}
                        {todo.due !== null && <Badge variant="secondary">기한: {todo.due}</Badge>}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          onClick={() => openOriginNote(todo.note_id)}
                        >
                          원본 노트
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
          {tab === "notes" && view.kind === "list" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className={PAGE_TITLE}>노트</h2>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={openForm}>
                    새 노트
                  </Button>
                  <Button type="button" onClick={() => setView({ kind: "organize" })}>
                    정리
                  </Button>
                </div>
              </div>
              {notes !== null && notes.length === 0 && (
                <EmptyState>저장된 노트가 없습니다</EmptyState>
              )}
              {notes !== null && notes.length > 0 && (
                <Card className="py-2">
                  <ul className="divide-y">
                    {notes.map((note) => (
                      <li key={note.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto w-full justify-between rounded-none px-6 py-3 hover:bg-accent"
                          onClick={() => openNote(note.id)}
                        >
                          <span className="font-medium">{note.title}</span>{" "}
                          <time
                            dateTime={note.created_at}
                            className="text-xs font-normal text-muted-foreground"
                          >
                            {formatDateTime(note.created_at)}
                          </time>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
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
            <Card className="p-6">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveNote();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="note-title">제목</Label>
                  <Input
                    id="note-title"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-body">본문</Label>
                  <Textarea
                    id="note-body"
                    className="min-h-48"
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                  />
                </div>
                {saveFailed && (
                  <Alert variant="destructive">
                    <AlertDescription>저장하지 못했습니다</AlertDescription>
                  </Alert>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setView({ kind: "list" })}>
                    취소
                  </Button>
                  <Button type="submit" disabled={draftBody.trim() === ""}>
                    저장
                  </Button>
                </div>
              </form>
            </Card>
          )}
          {tab === "notes" && view.kind === "detail" && (
            <article className="space-y-4">
              <div className="space-y-1">
                <h2 className={PAGE_TITLE}>{view.note.title}</h2>
                <time dateTime={view.note.created_at} className="text-xs text-muted-foreground">
                  {formatDateTime(view.note.created_at)}
                </time>
              </div>
              <Card className="p-6">
                <p className="whitespace-pre-wrap leading-7">{view.note.body}</p>
              </Card>
              {backButton}
            </article>
          )}
          {tab === "notes" && view.kind === "missing" && (
            <div className="space-y-4">
              <Card className="p-6">
                <p>노트를 찾을 수 없습니다</p>
              </Card>
              {backButton}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
