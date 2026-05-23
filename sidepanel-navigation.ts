type NavigableIssue = {
  id?: string;
};

const ISSUE_NAVIGATION_KEYDOWN_HANDLED = Symbol.for(
  "linearTicketSidepanel.issueNavigationKeydownHandled",
);

export function getIssueNavigationDelta(key: string): number {
  if (key === "ArrowDown") {
    return 1;
  }

  if (key === "ArrowUp") {
    return -1;
  }

  return 0;
}

export function claimIssueNavigationKeydown(event: object): boolean {
  const eventWithClaim = event as { [ISSUE_NAVIGATION_KEYDOWN_HANDLED]?: boolean };
  if (eventWithClaim[ISSUE_NAVIGATION_KEYDOWN_HANDLED]) {
    return false;
  }

  eventWithClaim[ISSUE_NAVIGATION_KEYDOWN_HANDLED] = true;
  return true;
}

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
