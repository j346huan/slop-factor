import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latestSubmittedDateFromAtom } from "../../admin-worker/src/index.ts";

describe("administrator arXiv availability", () => {
  it("reads the submitted date from the newest API entry", () => {
    const atom = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <updated>2026-08-22T05:00:00Z</updated>
        <entry>
          <id>oai:arXiv.org:2608.00001v1</id>
          <published>2026-08-21T00:00:00-04:00</published>
        </entry>
      </feed>`;

    assert.equal(latestSubmittedDateFromAtom(atom), "2026-08-21");
  });

  it("rejects an empty feed instead of inventing a date", () => {
    assert.throws(
      () =>
        latestSubmittedDateFromAtom(
          "<feed><updated>2026-08-22</updated></feed>",
        ),
      /no mathematics papers/,
    );
  });
});
