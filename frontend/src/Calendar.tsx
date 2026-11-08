import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchCalendar, type CalendarResult } from "./api";

type Day = CalendarResult["days"][number];

const WEEKDAY_HEADERS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("ko-KR", { weekday: "short" });

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthGrid(month: string): string[] {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(year, index, 1));
  const last = new Date(Date.UTC(year, index + 1, 0));
  const lead = (first.getUTCDay() + 6) % 7;
  const tail = 6 - ((last.getUTCDay() + 6) % 7);
  const total = lead + last.getUTCDate() + tail;
  const dates: string[] = [];
  for (let i = 0; i < total; i += 1) {
    dates.push(isoOf(new Date(Date.UTC(year, index, 1 - lead + i))));
  }
  return dates;
}

function shiftMonth(month: string, delta: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return isoOf(date).slice(0, 7);
}

function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}

function weekdayOf(date: string): string {
  return WEEKDAY_FORMAT.format(
    new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
  );
}

function firstTitle(day: Day | undefined): string | null {
  if (day === undefined) {
    return null;
  }
  if (day.notes.length > 0) {
    return day.notes[0].title;
  }
  if (day.decisions.length > 0) {
    return day.decisions[0].text;
  }
  if (day.todos.length > 0) {
    return day.todos[0].task;
  }
  return null;
}

const ROW_CLASS = "h-auto w-full justify-start whitespace-normal break-words text-left px-4 py-3";

export default function Calendar({ onOpenNote }: { onOpenNote: (id: number) => void }) {
  const today = localToday();
  const [request, setRequest] = useState<{ month: string }>(() => ({ month: today.slice(0, 7) }));
  const [selected, setSelected] = useState(today);
  const [settled, setSettled] = useState<{
    request: object;
    result: CalendarResult | null;
  } | null>(null);
  const month = request.month;
  const loading = settled?.request !== request;
  const result = !loading ? (settled?.result ?? null) : null;

  useEffect(() => {
    let active = true;
    fetchCalendar(request.month)
      .then((data) => {
        if (active) {
          setSettled({ request, result: data });
        }
      })
      .catch(() => {
        if (active) {
          setSettled({ request, result: null });
        }
      });
    return () => {
      active = false;
    };
  }, [request]);

  function goMonth(target: string, date: string) {
    setRequest({ month: target });
    setSelected(date);
  }

  const nav = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const target = shiftMonth(month, -1);
            goMonth(target, `${target}-01`);
          }}
        >
          <ChevronLeft />
          이전 달
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const target = shiftMonth(month, 1);
            goMonth(target, `${target}-01`);
          }}
        >
          다음 달
          <ChevronRight />
        </Button>
      </div>
      <h2 className="text-lg font-semibold">{`${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`}</h2>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const now = localToday();
          goMonth(now.slice(0, 7), now);
        }}
      >
        오늘
      </Button>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {nav}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  if (result === null) {
    return (
      <div className="flex flex-col gap-4">
        {nav}
        <Alert variant="destructive">
          <AlertDescription>
            <p>캘린더를 불러오지 못했습니다</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRequest({ month })}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const byDate = new Map<string, Day>(result.days.map((day) => [day.date, day]));
  const selectedDay = byDate.get(selected);
  const isEmptyDay =
    selectedDay === undefined ||
    (selectedDay.notes.length === 0 &&
      selectedDay.decisions.length === 0 &&
      selectedDay.todos.length === 0);

  const none = <p className="px-4 py-2 text-sm text-muted-foreground">없음</p>;

  return (
    <div className="flex flex-col gap-4">
      {nav}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card className="flex-1 p-2">
          <div className="grid grid-cols-7">
            {WEEKDAY_HEADERS.map((name) => (
              <div key={name} className="py-1 text-center text-xs text-muted-foreground">
                {name}
              </div>
            ))}
            {monthGrid(month).map((date) => {
              const day = byDate.get(date);
              const notes = day?.notes.length ?? 0;
              const decisions = day?.decisions.length ?? 0;
              const todos = day?.todos.length ?? 0;
              const title = firstTitle(day);
              const outside = !date.startsWith(month);
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={`${monthDay(date)}, 노트 ${notes}, 결정 ${decisions}, 할 일 ${todos}`}
                  className={`flex min-h-12 min-w-0 flex-col items-start gap-1 rounded-md p-1 text-left lg:min-h-24 ${
                    date === selected ? "bg-accent" : ""
                  } ${outside ? "text-muted-foreground/50" : ""}`}
                  onClick={() => {
                    if (outside) {
                      goMonth(date.slice(0, 7), date);
                    } else {
                      setSelected(date);
                    }
                  }}
                >
                  <span
                    className={`text-sm ${
                      date === today ? "bg-primary text-primary-foreground rounded-full px-1.5" : ""
                    }`}
                  >
                    {Number(date.slice(8, 10))}
                  </span>
                  <span className="flex gap-1">
                    {notes > 0 && <span className="size-1.5 rounded-full bg-primary" />}
                    {decisions > 0 && (
                      <span className="size-1.5 rounded-full bg-muted-foreground" />
                    )}
                    {todos > 0 && <span className="size-1.5 rounded-full border border-primary" />}
                  </span>
                  {title !== null && (
                    <span className="hidden w-full truncate text-xs lg:block">{title}</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
        <Card className="lg:w-72">
          <CardHeader>
            <h3 className="text-base font-semibold">{`${monthDay(selected)} (${weekdayOf(selected)})`}</h3>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            {isEmptyDay || selectedDay === undefined ? (
              <div className="mx-6 border border-dashed rounded-lg p-8 text-center">
                이 날짜에 기록이 없습니다
              </div>
            ) : (
              <>
                <section aria-label="노트">
                  <h4 className="px-4 text-sm font-medium">노트</h4>
                  {selectedDay.notes.length === 0
                    ? none
                    : selectedDay.notes.map((note) => (
                        <Button
                          key={note.id}
                          type="button"
                          variant="ghost"
                          className={ROW_CLASS}
                          onClick={() => onOpenNote(note.id)}
                        >
                          {note.title}
                        </Button>
                      ))}
                </section>
                <section aria-label="결정 사항">
                  <h4 className="px-4 text-sm font-medium">결정 사항</h4>
                  {selectedDay.decisions.length === 0
                    ? none
                    : selectedDay.decisions.map((decision, index) => (
                        <Button
                          key={`${decision.note_id}-${index}`}
                          type="button"
                          variant="ghost"
                          className={ROW_CLASS}
                          onClick={() => onOpenNote(decision.note_id)}
                        >
                          {decision.text}
                        </Button>
                      ))}
                </section>
                <section aria-label="기한인 할 일">
                  <h4 className="px-4 text-sm font-medium">기한인 할 일</h4>
                  {selectedDay.todos.length === 0
                    ? none
                    : selectedDay.todos.map((todo) => (
                        <Button
                          key={todo.id}
                          type="button"
                          variant="ghost"
                          className={ROW_CLASS}
                          onClick={() => onOpenNote(todo.note_id)}
                        >
                          <span className={todo.done ? "line-through text-muted-foreground" : ""}>
                            {todo.task}
                          </span>
                        </Button>
                      ))}
                </section>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
