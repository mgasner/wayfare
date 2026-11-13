import { z } from "zod";
import { db, mutation, person, query, sql } from "../lib/nexus.js";
import { Me } from "../shared/records.js";

const MeRow = Me.extend({ passport_on_file: z.number().int().transform((n) => n !== 0) });

/** The signed-in user, or null. */
export const get = query({
  input: z.object({}),
  async handler(_, { auth }): Promise<Me | null> {
    if (auth?.actor.kind !== "person") return null;
    const [{ rows }] = await db.execute(sql(MeRow)`
      SELECT app_user.id, app_user.email, app_user.name, app_user.picture,
             user_private.passport IS NOT NULL AS passport_on_file
      FROM app_user LEFT JOIN user_private ON user_private.owner = app_user.id
      WHERE app_user.id = ${auth.actor.id}`);
    return rows[0] ?? null;
  },
});

// Letters and digits only, as printed on the data page; 6 to 12 covers ICAO document numbers.
const PassportNumber = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6,12}$/, "6 to 12 letters and digits"));

/** Stores the signed-in user's passport number in user_private; it is never returned. */
export const setPassport = mutation({
  input: z.object({ number: PassportNumber }),
  async handler({ number }, context): Promise<{ passport_on_file: true }> {
    const me = person(context);
    const now = new Date().toISOString();
    await db.execute(sql`
      INSERT INTO user_private (owner, passport, updated_at) VALUES (${me.id}, ${number}, ${now})
      ON CONFLICT (owner) DO UPDATE SET passport = excluded.passport, updated_at = excluded.updated_at`);
    return { passport_on_file: true };
  },
});

export const clearPassport = mutation({
  input: z.object({}),
  async handler(_, context): Promise<{ passport_on_file: false }> {
    const me = person(context);
    await db.execute(sql`UPDATE user_private SET passport = NULL, updated_at = ${new Date().toISOString()} WHERE owner = ${me.id}`);
    return { passport_on_file: false };
  },
});
