/**
 * Creating an attendee into an org unit that was created moments ago.
 *
 * `orgunits.insert` returning does not make the OU usable: for a few seconds,
 * `users.insert` naming it answers 403 "Not Authorized to access this
 * resource/api". Three 1-seat workshops failed on that in one morning — a
 * 1-seat run reaches its first insert about half a second after creating the
 * OU, where a 30-seat run spends long enough checking addresses to miss the
 * window entirely, which is why it went unseen for as long as it did.
 *
 * What must hold: 403 is waited out, every other status still comes straight
 * back (the 409 that means "address taken" is adopted by the caller and a
 * swallowed one would hand two attendees the same account), and a 403 that
 * outlives the window is reported as a possible permissions problem rather
 * than retried forever.
 *
 * Real sleeping is injected away — the schedule is asserted through the pauses
 * the loop asks for, not by waiting for them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { deleteUserOnceCreated, insertIntoNewOrgUnit } from "../src/directory.js";

/** The shape gaxios hands back; `directory.ts` reads the status off `code`. */
const gaxiosError = (status: number, message = "request failed") =>
  Object.assign(new Error(message), { code: status, status });

const CTX = { email: "bouncypenguin@example.com", orgUnitPath: "/Workshop" };

/** Collects the delays asked for instead of serving them. */
function recordingPause() {
  const delays: number[] = [];
  return {
    delays,
    pause: async (ms: number) => {
      delays.push(ms);
    },
  };
}

describe("insertIntoNewOrgUnit", () => {
  test("waits out the 403 a just-created OU produces", async () => {
    let calls = 0;
    const { delays, pause } = recordingPause();

    const result = await insertIntoNewOrgUnit(
      async () => {
        calls++;
        // Two refusals, then the OU becomes visible — the observed shape.
        if (calls < 3) throw gaxiosError(403, "Not Authorized to access this resource/api");
        return "created";
      },
      CTX,
      pause,
    );

    assert.equal(result, "created");
    assert.equal(calls, 3);
    assert.deepEqual(delays, [5000, 5000], "one pause per refusal, no more");
  });

  test("succeeds without pausing when the OU is already visible", async () => {
    const { delays, pause } = recordingPause();
    const result = await insertIntoNewOrgUnit(async () => "created", CTX, pause);
    assert.equal(result, "created");
    assert.deepEqual(delays, [], "the common case costs nothing");
  });

  test("re-throws any other status on the first attempt, unchanged", async () => {
    // 409 above all: `createAccount` reads it to decide whether the address
    // belongs to an earlier attempt of this same run or to a real person.
    for (const status of [400, 401, 404, 409, 412, 500]) {
      let calls = 0;
      const { delays, pause } = recordingPause();
      const thrown = gaxiosError(status);

      await assert.rejects(
        () =>
          insertIntoNewOrgUnit(
            async () => {
              calls++;
              throw thrown;
            },
            CTX,
            pause,
          ),
        (err) => err === thrown,
        `HTTP ${status} must arrive at the caller as itself`,
      );
      assert.equal(calls, 1, `HTTP ${status} must not be retried`);
      assert.deepEqual(delays, [], `HTTP ${status} must not be waited on`);
    }
  });

  test("names the permissions cause when the 403 outlives the window", async () => {
    // The message names the impersonated admin, so the config it comes from has
    // to be readable. In the runner it always is — `createAccount` reads the
    // same config before it gets here.
    process.env.GOOGLE_WORKSPACE_DOMAIN ??= "example.com";
    process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL ??= "admin@example.com";
    let calls = 0;
    const { delays, pause } = recordingPause();

    await assert.rejects(
      () =>
        insertIntoNewOrgUnit(
          async () => {
            calls++;
            throw gaxiosError(403, "Not Authorized to access this resource/api");
          },
          CTX,
          pause,
        ),
      (err: Error) => {
        // The operator's next move is a role check, so the message has to say
        // so; the bare Google wording sent three runs looking at the wrong
        // thing.
        assert.match(err.message, /Admin roles/);
        assert.match(err.message, /not allowed to create users/);
        assert.match(err.message, /bouncypenguin@example\.com/);
        return true;
      },
    );

    assert.equal(calls, 8, "gives up rather than waiting forever");
    assert.equal(delays.length, 7);
  });
});

/**
 * The other end of the same window: an account created seconds ago cannot be
 * deleted yet (412 "User creation is not complete."). Teardown meets this when a
 * failed run is deleted immediately, which is exactly when it is deleted.
 */
describe("deleteUserOnceCreated", () => {
  test("waits out a 412 from an account created moments ago", async () => {
    let calls = 0;
    const { delays, pause } = recordingPause();

    await deleteUserOnceCreated(
      async () => {
        calls++;
        if (calls === 1) throw gaxiosError(412, "User creation is not complete.");
      },
      CTX.email,
      pause,
    );

    assert.equal(calls, 2);
    assert.deepEqual(delays, [5000]);
  });

  test("treats an already-deleted account as done", async () => {
    let calls = 0;
    await deleteUserOnceCreated(
      async () => {
        calls++;
        throw gaxiosError(404, "Resource Not Found: userKey");
      },
      CTX.email,
      async () => assert.fail("a 404 must not be waited on"),
    );
    assert.equal(calls, 1, "teardown is idempotent, so gone is success");
  });

  test("surfaces a real failure instead of waiting on it", async () => {
    const thrown = gaxiosError(403, "Not Authorized to access this resource/api");
    let calls = 0;
    await assert.rejects(
      () =>
        deleteUserOnceCreated(
          async () => {
            calls++;
            throw thrown;
          },
          CTX.email,
          async () => assert.fail("only a 412 is waited on"),
        ),
      (err) => err === thrown,
    );
    assert.equal(calls, 1);
  });

  test("gives up on a 412 that never clears", async () => {
    let calls = 0;
    const { delays, pause } = recordingPause();
    await assert.rejects(
      () =>
        deleteUserOnceCreated(
          async () => {
            calls++;
            throw gaxiosError(412, "User creation is not complete.");
          },
          CTX.email,
          pause,
        ),
      /User creation is not complete/,
    );
    assert.equal(calls, 6);
    assert.equal(delays.length, 5);
  });
});
