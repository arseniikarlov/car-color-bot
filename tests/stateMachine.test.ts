import { describe, expect, it } from "vitest";

import { defaultSession, markAwaitingPhoto, markCompleted, markFailed, markProcessing, resetSession, selectColor, startSearch } from "../src/state/stateMachine.js";

describe("state machine", () => {
  it("moves through search, select, processing and completion", () => {
    const initial = defaultSession(42);
    const searching = startSearch(initial);
    const selected = selectColor(searching, "color-1");
    const processing = markProcessing(selected, "file-1");
    const completed = markCompleted(processing, "file-1");

    expect(searching.state).toBe("awaiting_search_query");
    expect(selected.selected_color_id).toBe("color-1");
    expect(selected.state).toBe("awaiting_photo");
    expect(processing.state).toBe("processing");
    expect(completed.state).toBe("awaiting_photo");
    expect(completed.job_status).toBe("completed");
  });

  it("supports retries and reset", () => {
    const selected = selectColor(defaultSession(1), "c-2");
    const failed = markFailed(markProcessing(selected, "file-2"), "file-2");
    const retry = markAwaitingPhoto(failed, "file-3");
    const reset = resetSession(retry);

    expect(failed.job_status).toBe("failed");
    expect(retry.state).toBe("awaiting_photo");
    expect(reset.selected_color_id).toBeNull();
    expect(reset.state).toBe("idle");
  });
});
