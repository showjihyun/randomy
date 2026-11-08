import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWeekly, type WeeklyResult } from "./api";

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export default function Weekly({ onOpenNote }: { onOpenNote: (id: number) => void }) {
  const [week, setWeek] = useState<WeeklyResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState<{ date: string | undefined }>({ date: undefined });
  const [settled, setSettled] = useState<object | null>(null);
  const loading = settled !== request;

  useEffect(() => {
    let active = true;
    fetchWeekly(request.date)
      .then((result) => {
        if (active) {
          setFailed(false);
          setSettled(request);
          setWeek(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setSettled(request);
        }
      });
    return () => {
      active = false;
    };
  }, [request]);

  const status = (
    <>
      {loading && (
        <div className="flex flex-col gap-2">
          <p>불러오는 중…</p>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      )}
      {failed && !loading && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>주간 정리를 불러오지 못했습니다</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRequest({ date: request.date })}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  );

  const empty = (
    <div className="border border-dashed rounded-lg p-8 text-center">
      <p>없음</p>
    </div>
  );

  const heading = (text: string) => (
    <CardHeader>
      <h2 className="text-base font-semibold">{text}</h2>
    </CardHeader>
  );

  if (week === null) {
    return status;
  }

  return (
    <div className="flex flex-col gap-6">
      {status}
      <div className="flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => setRequest({ date: shiftDate(week.start, -7) })}
        >
          <ChevronLeft />
          지난주
        </Button>
        <span className="font-medium">{`${week.start} ~ ${week.end}`}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => setRequest({ date: shiftDate(week.start, 7) })}
        >
          다음 주
          <ChevronRight />
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="이번 주 노트">
          <Card>
            {heading("이번 주 노트")}
            <CardContent>
              {week.notes.length === 0 ? (
                empty
              ) : (
                <ul className="flex flex-col gap-1">
                  {week.notes.map((note) => (
                    <li key={note.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start whitespace-normal break-words text-left"
                        onClick={() => onOpenNote(note.id)}
                      >
                        <span>{note.title}</span>
                        {note.summary !== null && <span> {note.summary}</span>}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
        <section aria-label="결정 사항">
          <Card>
            {heading("결정 사항")}
            <CardContent>
              {week.decisions.length === 0 ? (
                empty
              ) : (
                <div className="flex flex-col gap-1">
                  {week.decisions.map((decision) => (
                    <div key={decision.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start whitespace-normal break-words text-left"
                        onClick={() => onOpenNote(decision.note_id)}
                      >
                        <span>{decision.text}</span> <span>{decision.note_title}</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
      <section aria-label="남은 할 일">
        <Card>
          {heading("남은 할 일")}
          <CardContent>
            {week.open_todos.length === 0 ? (
              empty
            ) : (
              <ul className="flex flex-col gap-1">
                {week.open_todos.map((todo) => (
                  <li key={todo.id} className="break-words">
                    <span>{todo.task}</span>
                    {todo.owner !== null && <span> 담당: {todo.owner}</span>}
                    {todo.due !== null && <span> 기한: {todo.due}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
