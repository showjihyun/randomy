function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function dueStatus(
  dueDate: string | null,
  done: boolean,
  today: string,
): "overdue" | "today" | "soon" | null {
  if (done || dueDate === null || dueDate === undefined) {
    return null;
  }
  const days = dayNumber(dueDate) - dayNumber(today);
  if (days < 0) {
    return "overdue";
  }
  if (days === 0) {
    return "today";
  }
  if (days <= 3) {
    return "soon";
  }
  return null;
}
