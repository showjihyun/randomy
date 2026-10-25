import { useRef, useState } from "react";
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
    );
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
        <button type="submit" disabled={q.trim() === "" || searching}>
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
        <button type="submit" disabled={question.trim() === "" || asking}>
          질문
        </button>
      </form>
      {searching && <p>검색 중…</p>}
      {asking && <p>답변을 만드는 중…</p>}
      {renderFailure(searchFailure)}
      {renderFailure(askFailure)}
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
