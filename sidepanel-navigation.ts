type NavigableIssue = {
  id?: string;
};

export function getNextIssueSelectionId(
  issues: NavigableIssue[],
  selectedIssueId: string,
  delta: number,
): string {
  if (issues.length === 0) {
    return "";
  }

  const step = delta > 0 ? 1 : -1;
  const currentIndex = issues.findIndex((issue) => issue.id === selectedIssueId);
  if (currentIndex === -1) {
    return issues[0]?.id || "";
  }

  const nextIndex = Math.min(Math.max(currentIndex + step, 0), issues.length - 1);
  return issues[nextIndex]?.id || "";
}
