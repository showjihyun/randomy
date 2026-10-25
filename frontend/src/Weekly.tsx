import { useEffect, useState } from "react";
import { fetchWeekly, type WeeklyResult } from "./api";

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export default function Weekly({ onOpenNote }: { onOpenNote: (id: number) => void }) {
  const [week, setWeek] = useState<WeeklyResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchWeekly(request)
      .then((result) => {
        if (active) {
          setFailed(false);
          setWeek(result);
        }
      })
      .catch(() => {
        if (active) {
          setWeek(null);
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [request]);

  if (failed) {
    return <p role="alert">주간 정리를 불러오지 못했습니다</p>;
  }
  if (week === null) {
    return null;
  }

  return (
    <div>
      <div>
        <button type="button" onClick={() => setRequest(shiftDate(week.start, -7))}>
          지난주
        </button>
        <span>{`${week.start} ~ ${week.end}`}</span>
        <button type="button" onClick={() => setRequest(shiftDate(week.start, 7))}>
          다음 주
        </button>
      </div>
      <section aria-label="이번 주 노트">
        <h2>이번 주 노트</h2>
        {week.notes.length === 0 ? (
          <p>없음</p>
        ) : (
          <ul>
            {week.notes.map((note) => (
              <li key={note.id}>
                <button type="button" onClick={() => onOpenNote(note.id)}>
                  <span>{note.title}</span>
                  {note.summary !== null && <span> {note.summary}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="결정 사항">
        <h2>결정 사항</h2>
        {week.decisions.length === 0 ? (
          <p>없음</p>
        ) : (
          <div>
            {week.decisions.map((decision) => (
              <div key={decision.id}>
                <button type="button" onClick={() => onOpenNote(decision.note_id)}>
                  <span>{decision.text}</span> <span>{decision.note_title}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section aria-label="남은 할 일">
        <h2>남은 할 일</h2>
        {week.open_todos.length === 0 ? (
          <p>없음</p>
        ) : (
          <ul>
            {week.open_todos.map((todo) => (
              <li key={todo.id}>
                <span>{todo.task}</span>
                {todo.owner !== null && <span> 담당: {todo.owner}</span>}
                {todo.due !== null && <span> 기한: {todo.due}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
