import { z } from "zod";
import { AreasFile, CityFile, PlaceFile } from "../shared/research.js";

// What a city research pass produces: the files under data/cities/<city>/, as one object.
// Each place file is a PlaceFile; fact values have the shapes in shared/facts.ts.
// bin/check-city validates a city directory and prints coverage and gaps.

export const CityResearch = z.object({
  city: CityFile,
  areas: AreasFile,
  places: z.array(PlaceFile),
});
export type CityResearch = z.infer<typeof CityResearch>;

/** The research segments, each run by one subagent; a sixth writes city.json. */
export const Segment = z.enum(["reserve_ahead", "bookable", "walk_in_classics", "informal_and_markets", "areas"]);
export type Segment = z.infer<typeof Segment>;
