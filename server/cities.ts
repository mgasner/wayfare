import { z } from "zod";
import { db, query, sql, toolError } from "../lib/nexus.js";
import type { Area, City } from "../shared/records.js";
import { AreaRow, CityRow } from "./tables.js";

/** A city with its areas, by name. */
export const get = query({
  input: z.object({ id: z.string() }),
  async handler({ id }): Promise<{ city: City; areas: Area[] }> {
    const [cities, areas] = await db.execute(
      sql(CityRow)`SELECT * FROM city WHERE id = ${id}`,
      sql(AreaRow)`SELECT * FROM area WHERE city = ${id} ORDER BY name`,
    );
    const city = cities.rows[0];
    if (!city) throw toolError("not_found", `No city ${id}`);
    return { city, areas: areas.rows };
  },
});
