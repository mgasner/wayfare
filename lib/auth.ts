import { z } from "zod";
import { Auth, db, sql } from "./nexus.js";

/** The DEV_USER bypass: signs in as `email`, creating the app_user on first use. */
export async function devAuth(email: string): Promise<Auth> {
  const name = email.split("@")[0] ?? email;
  const [, { rows }] = await db.execute(
    sql`INSERT INTO app_user (id, email, name, created_at) VALUES (${crypto.randomUUID()}, ${email}, ${name}, ${new Date().toISOString()})
        ON CONFLICT (email) DO NOTHING`,
    sql(z.object({ id: z.string(), name: z.string() }))`SELECT id, name FROM app_user WHERE email = ${email}`,
  );
  const user = rows[0];
  if (!user) throw new Error(`Could not create app_user ${email}`);
  return Auth.create({ kind: "person", id: user.id, name: user.name, email });
}
