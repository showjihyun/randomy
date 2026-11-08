import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiError, ask, search, type AskResult, type SearchResult } from "./api";

type Props = { onOpenNote: (id: number) => void };

type Failure = { title: string; message: string; problems: string[] };

function toFailure(title: string, error: unknown): Failure {
  if (error instanceof ApiError) {
    return { title, message: error.message, problems: error.problems };
  }
  return { title, message: "", problems: [] };
}

export default function Search({ onOpenNote }: Props) {
  const [q, setQ] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [searchFailure, setSearchFailure] = useState<Failure | null>(null);
  const [askFailure, setAskFailure] = useState<Failure | null>(null);
  const [searching, setSearching] = useState(false);
  const [asking, setAsking] = useState(false);
  const searchSeq = useRef(0);
  const askSeq = useRef(0);

  function runSearch() {
    if (q.trim() === "") {
      return;
    }
    const seq = ++searchSeq.current;
    setSearchFailure(null);
    setResult(null);
    setSearching(true);
    search(q)
      .then((data) => {
        if (seq === searchSeq.current) {
          setResult(data);
          setSearching(false);
        }
      })
      .catch((error: unknown) => {
        if (seq === searchSeq.current) {
          setSearchFailure(toFailure("검색하지 못했습니다", error));
          setSearching(false);
        }
      });
  }

  function runAsk() {
    if (question.trim() === "") {
      return;
    }
    const seq = ++askSeq.current;
    setAskFailure(null);
    setAnswer(null);
    setAsking(true);
    ask(question)
      .then((data) => {
        if (seq === askSeq.current) {
          setAnswer(data);
          setAsking(false);
        }
      })
      .catch((error: unknown) => {
        if (seq === askSeq.current) {
          setAskFailure(toFailure("질문하지 못했습니다", error));
          setAsking(false);
        }
      });
  }

  function renderFailure(failure: Failure | null) {
    if (failure === null) {
      return null;
    }
    return (
      <Alert variant="destructive">
        <AlertTitle>{failure.title}</AlertTitle>
        <AlertDescription>
          {failure.message !== "" && <p>{failure.message}</p>}
          {failure.problems.length > 0 && (
            <ul>
              {failure.problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  function renderEmpty() {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">없음</p>
      </div>
    );
  }

  function renderRow(key: number, title: string, detail: string, noteId: number) {
    return (
      <li key={key}>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-4 py-3 text-left"
          onClick={() => onOpenNote(noteId)}
        >
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{detail}</span>
        </Button>
      </li>
    );
  }

  const noteCount = result?.notes.length ?? 0;
  const decisionCount = result?.decisions.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Card className="px-6">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <Label htmlFor="search-q">검색어</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="search-q" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" disabled={q.trim() === "" || searching}>
              {searching && <Loader2 className="animate-spin" />}
              검색
            </Button>
          </div>
        </form>
        <Separator />
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runAsk();
          }}
        >
          <Label htmlFor="search-question">질문</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="search-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button type="submit" disabled={question.trim() === "" || asking}>
              {asking && <Loader2 className="animate-spin" />}
              질문
            </Button>
          </div>
        </form>
      </Card>
      {searching && <p className="text-sm text-muted-foreground">검색 중…</p>}
      {asking && <p className="text-sm text-muted-foreground">답변을 만드는 중…</p>}
      {renderFailure(searchFailure)}
      {renderFailure(askFailure)}
      {result !== null && noteCount === 0 && decisionCount === 0 && renderEmpty()}
      {result !== null && (noteCount > 0 || decisionCount > 0) && (
        <>
          <section aria-label="노트 결과">
            <Card className={noteCount === 0 ? "px-2" : "gap-0 py-0"}>
              {noteCount === 0 ? (
                renderEmpty()
              ) : (
                <ul className="divide-y">
                  {result.notes.map((note) => renderRow(note.id, note.title, note.snippet, note.id))}
                </ul>
              )}
            </Card>
          </section>
          <section aria-label="결정 사항 결과">
            <Card className={decisionCount === 0 ? "px-2" : "gap-0 py-0"}>
              {decisionCount === 0 ? (
                renderEmpty()
              ) : (
                <ul className="divide-y">
                  {result.decisions.map((decision) =>
                    renderRow(decision.id, decision.text, decision.note_title, decision.note_id),
                  )}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
      {answer !== null && (
        <section aria-label="답변">
          <Card className="px-6">
            <p
              className={
                answer.sources.length > 0
                  ? "text-sm leading-7"
                  : "text-sm leading-7 text-muted-foreground"
              }
            >
              {answer.answer}
            </p>
            {answer.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">근거</span>
                {answer.sources.map((source) => (
                  <Button
                    key={source.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenNote(source.id)}
                  >
                    {source.title}
                  </Button>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
