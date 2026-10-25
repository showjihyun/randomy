import { useState } from "react";
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
  const [failure, setFailure] = useState<Failure | null>(null);

  function runSearch() {
    if (q.trim() === "") {
      return;
    }
    setFailure(null);
    search(q)
      .then((data) => setResult(data))
      .catch((error: unknown) => {
        setResult(null);
        setFailure(toFailure("검색하지 못했습니다", error));
      });
  }

  function runAsk() {
    if (question.trim() === "") {
      return;
    }
    setFailure(null);
    ask(question)
      .then((data) => setAnswer(data))
      .catch((error: unknown) => {
        setAnswer(null);
        setFailure(toFailure("질문하지 못했습니다", error));
      });
  }

  const noteCount = result?.notes.length ?? 0;
  const decisionCount = result?.decisions.length ?? 0;

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <label>
          검색어
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" disabled={q.trim() === ""}>
          검색
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runAsk();
        }}
      >
        <label>
          질문
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button type="submit" disabled={question.trim() === ""}>
          질문
        </button>
      </form>
      {failure !== null && (
        <div role="alert">
          <p>{failure.title}</p>
          {failure.message !== "" && <p>{failure.message}</p>}
          {failure.problems.length > 0 && (
            <ul>
              {failure.problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result !== null && noteCount === 0 && decisionCount === 0 && <p>없음</p>}
      {result !== null && (noteCount > 0 || decisionCount > 0) && (
        <>
          <section aria-label="노트 결과">
            {noteCount === 0 ? (
              <p>없음</p>
            ) : (
              <ul>
                {result.notes.map((note) => (
                  <li key={note.id}>
                    <button type="button" onClick={() => onOpenNote(note.id)}>
                      <span>{note.title}</span> <span>{note.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="결정 사항 결과">
            {decisionCount === 0 ? (
              <p>없음</p>
            ) : (
              <ul>
                {result.decisions.map((decision) => (
                  <li key={decision.id}>
                    <button type="button" onClick={() => onOpenNote(decision.note_id)}>
                      <span>{decision.text}</span> <span>{decision.note_title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {answer !== null && (
        <section aria-label="답변">
          <p>{answer.answer}</p>
          {answer.sources.length > 0 &&
            answer.sources.map((source) => (
              <button key={source.id} type="button" onClick={() => onOpenNote(source.id)}>
                {source.title}
              </button>
            ))}
        </section>
      )}
    </div>
  );
}
