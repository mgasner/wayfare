import { z } from "zod";
import { db, query, sql } from "../lib/nexus.js";
import type { User } from "../shared/records.js";
import { UserRow } from "./tables.js";

/** The signed-in user, or null. */
export const get = query({
  input: z.object({}),
  async handler(_, { auth }): Promise<User | null> {
    if (auth?.actor.kind !== "person") return null;
    const [{ rows }] = await db.execute(sql(UserRow)`SELECT id, email, name, picture FROM app_user WHERE id = ${auth.actor.id}`);
    return rows[0] ?? null;
  },
});
