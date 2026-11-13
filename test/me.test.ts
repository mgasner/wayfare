import { beforeEach, describe, expect, it } from "vitest";
import type { FileDatabase } from "../lib/db.js";
import type { Auth } from "../lib/nexus.js";
import { createTrip, PASSPORTS } from "./fixtures.js";
import { addUser, callAs, personalDataInInteractions, seededDb } from "./helpers.js";

let database: FileDatabase;
let max: Auth;
let other: Auth;

beforeEach(async () => {
  database = await seededDb();
  max = await addUser(database, "max@example.com");
  other = await addUser(database, "other@example.com");
});

/** Every text value in the database except user_private, joined. */
async function everythingButUserPrivate(): Promise<string> {
  const tables = await database.run((s) =>
    s.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('user_private') AND name NOT LIKE 'sqlite_%'").all(),
  );
  const out: string[] = [];
  for (const { name } of tables) {
    const rows = await database.run((s) => s.prepare(`SELECT * FROM "${String(name)}"`).all());
    out.push(JSON.stringify(rows));
  }
  return out.join("\n");
}

describe("passport in user_private", () => {
  it("stores the number privately and shows only that it is on file", async () => {
    await createTrip(max);
    expect((await callAs(max, "me.get")).body.passport_on_file).toBe(false);
    for (const number of PASSPORTS) {
      const set = await callAs(max, "me.setPassport", { number });
      expect(set.body, number).toEqual({ passport_on_file: true });
      expect(JSON.stringify(set.body)).not.toContain(number);
      const me = await callAs(max, "me.get");
      expect(me.body).toMatchObject({ email: "max@example.com", passport_on_file: true });
      expect(JSON.stringify(me.body)).not.toContain(number);
      const stored = await database.run((s) => s.prepare("SELECT owner, passport FROM user_private").all());
      expect(stored).toEqual([{ owner: max.actor.kind === "person" ? max.actor.id : "", passport: number }]);
      expect(await everythingButUserPrivate()).not.toContain(number);
    }
    expect((await callAs(other, "me.get")).body.passport_on_file).toBe(false);
    expect(await personalDataInInteractions(database)).toEqual([]);
  });

  it("normalizes spaces, dashes and case, and rejects what isn't a document number", async () => {
    await callAs(max, "me.setPassport", { number: "ab 123-4567" });
    expect(await database.run((s) => s.prepare("SELECT passport FROM user_private").all())).toEqual([{ passport: "AB1234567" }]);
    expect((await callAs(max, "me.setPassport", { number: "12" })).status).toBe(400);
    expect((await callAs(max, "me.setPassport", { number: "AB12345!" })).status).toBe(400);
  });

  it("clears the number", async () => {
    await callAs(max, "me.setPassport", { number: PASSPORTS[0] });
    expect((await callAs(max, "me.clearPassport", {})).body).toEqual({ passport_on_file: false });
    expect((await callAs(max, "me.get")).body.passport_on_file).toBe(false);
    expect(await database.run((s) => s.prepare("SELECT passport FROM user_private").all())).toEqual([{ passport: null }]);
  });

  it("needs a signed-in user", async () => {
    expect((await callAs(null, "me.setPassport", { number: PASSPORTS[0] })).status).toBe(401);
    expect((await callAs(null, "me.clearPassport", {})).status).toBe(401);
  });
});
